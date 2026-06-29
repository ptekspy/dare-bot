import { reddit, redis } from "@devvit/web/server";
import type { PostV2 } from "@devvit/shared";
import type { T3 } from "@devvit/web/shared";
import {
  DEFAULT_SCAN_LIMIT,
  TARGET_SUBREDDIT,
  isTargetSubreddit,
} from "./config.ts";
import { runBackfillChunk } from "./backfill.ts";
import { completionFromPost } from "./completion-factory.ts";
import {
  clearPostAuthor,
  deleteCompletionEntries,
  getCompletedItems,
  getCompletionEntries,
  getStoredPostAuthor,
  saveCompletion,
  saveReviewedCompletion,
} from "./completion-store.ts";
import {
  matchTrackedItemFromTitle,
  resolveTrackedItemFromTitle,
} from "./dare-matching.ts";
import {
  trackedFlairRuleForText,
} from "./flair.ts";
import {
  updateExistingHistoryComment,
  updateExistingHistoryCommentsForUser,
  upsertHistoryComment,
} from "./history-comments.ts";
import { buildHistoryComment } from "./history-renderer.ts";
import { bareThingId, normalizeUsername, thingId } from "./ids.ts";
import { queuePostForMissingDaredBy } from "./mod-queue.ts";
import { historyCommentPostKey } from "./redis-keys.ts";
import { addPendingHistoryPost, setUserSyncMeta } from "./sync-store.ts";
import { hasContributorUser } from "./text.ts";
import {
  clearTrackedFlairRulesCache,
  makeManualTrackedFlairRule,
  removeManualTrackedFlairRule,
  upsertManualTrackedFlairRule,
} from "./flair-rule-store.ts";
import type {
  BackfillTaskData,
  TrackedItemRecord,
  ItemReviewStatus,
  UserItemsResult,
  TrackPostResult,
  UntrackPostResult,
} from "./types.ts";
import {
  fetchDefaultWikiItems,
  fetchTrackedFlairRules,
  fetchWikiTrackedItems,
} from "./wiki.ts";
import { startBackfillUser } from "./backfill.ts";

async function resolveTrackedItemForPost(
  title: string,
  trackingRule: {
    flairText: string;
    wikiLink?: string;
  },
) {
  const wikiItems = trackingRule.wikiLink
    ? await fetchWikiTrackedItems(trackingRule.wikiLink)
    : [];
  return resolveTrackedItemFromTitle(title, trackingRule, wikiItems);
}

async function refreshKnownHistoryComments(
  username: string,
): Promise<string> {
  const allCompleted = await getCompletedItems(username);
  const body = buildHistoryComment(username, allCompleted);
  await updateExistingHistoryCommentsForUser(allCompleted, body);
  return body;
}

async function isModerator(username: string | undefined): Promise<boolean> {
  if (!username) return false;

  const moderators = await reddit
    .getModerators({
      subredditName: TARGET_SUBREDDIT,
      username: normalizeUsername(username),
      limit: 1,
      pageSize: 1,
    })
    .all();

  return moderators.some(
    (moderator) =>
      moderator.username?.toLowerCase() === normalizeUsername(username),
  );
}

async function getTrackedPostForMenuAction(targetId: string) {
  if (!targetId.startsWith("t3_")) {
    return { reason: "This action currently supports posts only." };
  }

  const post = await reddit.getPostById(targetId as T3);
  if (!isTargetSubreddit(post.subredditName)) {
    return { reason: "ignored non-target subreddit" };
  }

  const flairText = post.flair?.text?.trim();
  if (!flairText) {
    return { reason: "Selected post has no flair." };
  }

  return { post, flairText };
}

async function removeCompletionForPost(postId: string): Promise<UntrackPostResult> {
  const barePostId = bareThingId(postId);
  const post = await reddit.getPostById(thingId(barePostId, "t3") as T3);
  const entries = await getCompletionEntries(post.authorName);
  const removed = entries.filter(
    ({ item }) => bareThingId(item.postId) === barePostId,
  );
  const affectedPostIds = new Set<string>([
    barePostId,
    ...entries.map(({ item }) => bareThingId(item.postId)),
  ]);

  if (removed.length === 0) {
    const completed = await getCompletedItems(post.authorName);
    const body = buildHistoryComment(post.authorName, completed);
    await updateExistingHistoryComment(barePostId, body);
    return { untracked: false, reason: "post was not tracked as an item" };
  }

  await deleteCompletionEntries(post.authorName, removed.map(({ key }) => key));
  await clearPostAuthor(barePostId);

  const completed = await getCompletedItems(post.authorName);
  const body = buildHistoryComment(post.authorName, completed);
  await Promise.all(
    [...affectedPostIds].map((affectedPostId) =>
      updateExistingHistoryComment(affectedPostId, body),
    ),
  );

  return { untracked: true };
}

export async function removeCompletionForDeletedPost(
  postId: string,
  authorName?: string,
  subredditName?: string,
): Promise<UntrackPostResult> {
  if (!isTargetSubreddit(subredditName)) {
    return { untracked: false, reason: "ignored non-target subreddit" };
  }

  const barePostId = bareThingId(postId);
  const storedAuthorName = authorName ?? (await getStoredPostAuthor(barePostId));

  if (!storedAuthorName) {
    return {
      untracked: false,
      reason: "missing author payload for deleted post",
    };
  }

  const entries = await getCompletionEntries(storedAuthorName);
  const removed = entries.filter(
    ({ item }) => bareThingId(item.postId) === barePostId,
  );

  if (removed.length === 0) {
    const completed = await getCompletedItems(storedAuthorName);
    const body = buildHistoryComment(storedAuthorName, completed);
    await updateExistingHistoryComment(barePostId, body);
    return { untracked: false, reason: "deleted post was not tracked as an item" };
  }

  await deleteCompletionEntries(storedAuthorName, removed.map(({ key }) => key));
  await clearPostAuthor(barePostId);

  const affectedPostIds = new Set<string>([
    barePostId,
    ...entries.map(({ item }) => bareThingId(item.postId)),
  ]);
  const completed = await getCompletedItems(storedAuthorName);
  const body = buildHistoryComment(storedAuthorName, completed);

  await Promise.all(
    [...affectedPostIds].map((affectedPostId) =>
      updateExistingHistoryComment(affectedPostId, body),
    ),
  );

  return { untracked: true };
}

export async function trackTriggerPostAndComment(
  post: PostV2 | undefined,
  authorName: string | undefined,
  subredditName: string | undefined,
): Promise<TrackPostResult> {
  if (!post) return { tracked: false, reason: "missing post payload" };
  if (subredditName && !isTargetSubreddit(subredditName)) {
    return { tracked: false, reason: "ignored non-target subreddit" };
  }

  const canonicalPost = await reddit.getPostById(thingId(post.id, "t3") as T3);
  if (!isTargetSubreddit(canonicalPost.subredditName)) {
    return { tracked: false, reason: "ignored non-target subreddit" };
  }
  if (
    authorName &&
    normalizeUsername(canonicalPost.authorName) !== normalizeUsername(authorName)
  ) {
    return { tracked: false, reason: "post author did not match event author" };
  }
  const trackingRule = await trackedFlairRuleForText(canonicalPost.flair?.text);
  if (!trackingRule) {
    return { tracked: false, reason: "flair is not configured for tracking" };
  }

  if (
    trackingRule.trackContributors
    && !hasContributorUser(canonicalPost.title, canonicalPost.body)
  ) {
    await queuePostForMissingDaredBy(canonicalPost.id);
    return {
      tracked: false,
      reason: "Tracked flair missing contributor mention; queued for mod review",
    };
  }

  const trackedItem = await resolveTrackedItemForPost(
    canonicalPost.title,
    trackingRule,
  );
  if (!trackedItem) {
    return { tracked: false, reason: "title did not match a tracked item" };
  }

  const completed = completionFromPost(
    canonicalPost,
    trackedItem,
    trackingRule.trackContributors,
  );
  await saveCompletion(completed);

  await addPendingHistoryPost(canonicalPost.authorName, canonicalPost.id, subredditName);
  const backfillRunning = await startBackfillUser(
    canonicalPost.authorName,
    subredditName,
  );
  if (backfillRunning) {
    return { tracked: true, item: completed };
  }

  const body = await refreshKnownHistoryComments(canonicalPost.authorName);
  await upsertHistoryComment(canonicalPost.id, body);

  return { tracked: true, item: completed };
}

export async function handleTriggerPostFlairUpdate(
  post: PostV2 | undefined,
  authorName: string | undefined,
  subredditName: string | undefined,
): Promise<TrackPostResult | UntrackPostResult> {
  if (!post) return { untracked: false, reason: "missing post payload" };
  if (subredditName && !isTargetSubreddit(subredditName)) {
    return { untracked: false, reason: "ignored non-target subreddit" };
  }

  if (await trackedFlairRuleForText(post.linkFlair?.text)) {
    return trackTriggerPostAndComment(post, undefined, subredditName);
  }

  if (!post.linkFlair?.text) {
    const canonicalPost = await reddit.getPostById(thingId(post.id, "t3") as T3);
    if (!isTargetSubreddit(canonicalPost.subredditName)) {
      return { untracked: false, reason: "ignored non-target subreddit" };
    }
    if (await trackedFlairRuleForText(canonicalPost.flair?.text)) {
      return trackTriggerPostAndComment(post, undefined, canonicalPost.subredditName);
    }
  }

  return removeCompletionForPost(post.id);
}

export async function reviewTrackedItem(
  targetId: string,
  status: Exclude<ItemReviewStatus, "pending">,
  reviewedBy?: string,
): Promise<TrackPostResult> {
  if (!(await isModerator(reviewedBy))) {
    return { tracked: false, reason: "review action is moderator-only" };
  }

  let postId = targetId;

  if (targetId.startsWith("t1_")) {
    const mappedPostId = await redis.get(historyCommentPostKey(targetId));
    if (!mappedPostId) {
      return { tracked: false, reason: "comment is not a tracked history comment" };
    }
    postId = mappedPostId;
  }

  const post = await reddit.getPostById(thingId(postId, "t3") as T3);
  if (!isTargetSubreddit(post.subredditName)) {
    return { tracked: false, reason: "ignored non-target subreddit" };
  }
  const trackingRule = await trackedFlairRuleForText(post.flair?.text);
  if (!trackingRule) {
    return { tracked: false, reason: "flair is not configured for tracking" };
  }
  if (
    trackingRule.trackContributors
    && !hasContributorUser(post.title, post.body)
  ) {
    await queuePostForMissingDaredBy(post.id);
    return {
      tracked: false,
      reason: "Tracked flair missing contributor mention; queued for mod review",
    };
  }

  const trackedItem = await resolveTrackedItemForPost(post.title, trackingRule);
  if (!trackedItem) {
    return { tracked: false, reason: "title did not match a tracked item" };
  }

  const completed: TrackedItemRecord = {
    ...completionFromPost(post, trackedItem, trackingRule.trackContributors),
    status,
    reviewedBy,
    reviewedAtUtc: Math.floor(Date.now() / 1000),
  };

  await saveReviewedCompletion(completed);

  const body = await refreshKnownHistoryComments(completed.author);
  await upsertHistoryComment(post.id, body);

  return { tracked: true, item: completed };
}

export async function configureTrackedFlairFromPost(
  targetId: string,
  trackContributors: boolean,
  wikiLink: string | undefined,
  configuredBy?: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!(await isModerator(configuredBy))) {
    return { ok: false, reason: "configuration action is moderator-only" };
  }

  const trackedPost = await getTrackedPostForMenuAction(targetId);
  if (!("post" in trackedPost)) {
    return { ok: false, reason: trackedPost.reason };
  }

  const rule = makeManualTrackedFlairRule({
    flairText: trackedPost.flairText,
    trackContributors,
    wikiLink,
  });
  await upsertManualTrackedFlairRule(rule, trackedPost.post.subredditName);

  return {
    ok: true,
    reason: `Tracking updated for flair \"${rule.flairText}\" (contributors: ${rule.trackContributors ? "on" : "off"}).`,
  };
}

export async function removeTrackedFlairFromPost(
  targetId: string,
  configuredBy?: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!(await isModerator(configuredBy))) {
    return { ok: false, reason: "configuration action is moderator-only" };
  }

  const trackedPost = await getTrackedPostForMenuAction(targetId);
  if (!("post" in trackedPost)) {
    return { ok: false, reason: trackedPost.reason };
  }

  const removed = await removeManualTrackedFlairRule(
    trackedPost.flairText,
    trackedPost.post.subredditName,
  );
  if (!removed) {
    return { ok: false, reason: `No manual tracking rule exists for flair \"${trackedPost.flairText}\".` };
  }

  return { ok: true, reason: `Tracking removed for flair \"${trackedPost.flairText}\".` };
}

export async function syncTrackedFlairRules(
  requestedBy?: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!(await isModerator(requestedBy))) {
    return { ok: false, reason: "sync action is moderator-only" };
  }

  await clearTrackedFlairRulesCache(TARGET_SUBREDDIT);
  const rules = await fetchTrackedFlairRules(TARGET_SUBREDDIT);
  return {
    ok: true,
    reason: `Tracking rules synced. Loaded ${rules.length} flair rule(s).`,
  };
}

export async function scanUserItems(
  username: string,
  limit: number = DEFAULT_SCAN_LIMIT,
  subredditName?: string,
): Promise<UserItemsResult> {
  const cleanUsername = normalizeUsername(username);
  const cleanSubredditName = (subredditName ?? TARGET_SUBREDDIT).toLowerCase();
  const defaultWikiItems = await fetchDefaultWikiItems();
  const posts = await reddit
    .getPostsByUser({
      username: cleanUsername,
      sort: "new",
      timeframe: "all",
      limit,
      pageSize: 100,
    })
    .all();

  for (const post of posts) {
    if (
      cleanSubredditName &&
      post.subredditName.toLowerCase() !== cleanSubredditName
    ) {
      continue;
    }
    const trackingRule = await trackedFlairRuleForText(post.flair?.text);
    if (!trackingRule) continue;
    if (
      trackingRule.trackContributors
      && !hasContributorUser(post.title, post.body)
    ) {
      continue;
    }

    const wikiItems = trackingRule.wikiLink
      ? (trackingRule.wikiLink.toLowerCase() === `r/${TARGET_SUBREDDIT}/wiki/dares`
        ? defaultWikiItems
        : await fetchWikiTrackedItems(trackingRule.wikiLink))
      : [];
    const trackedItem = trackingRule.wikiLink
      ? matchTrackedItemFromTitle(post.title, wikiItems)
      : resolveTrackedItemFromTitle(post.title, trackingRule, wikiItems);
    if (!trackedItem) continue;

    await saveCompletion(completionFromPost(post, trackedItem, trackingRule.trackContributors));
  }

  const completed = await getCompletedItems(cleanUsername);
  await setUserSyncMeta(
    cleanUsername,
    subredditName,
    limit,
    completed.length,
  );

  return {
    type: "userItems",
    username: cleanUsername,
    count: completed.length,
    items: completed,
  };
}

export async function getUserItems(
  username: string,
  refresh: boolean,
  limit?: number,
): Promise<UserItemsResult> {
  if (refresh) {
    return scanUserItems(username, limit);
  }

  const cleanUsername = normalizeUsername(username);
  const completed = await getCompletedItems(cleanUsername);
  return {
    type: "userItems",
    username: cleanUsername,
    count: completed.length,
    items: completed,
  };
}

export { runBackfillChunk };
export type { BackfillTaskData };
