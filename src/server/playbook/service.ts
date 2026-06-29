import { reddit, redis } from "@devvit/web/server";
import type { PostV2 } from "@devvit/shared";
import type { T3 } from "@devvit/web/shared";
import {
  DEFAULT_SCAN_LIMIT,
  PLAYBOOK_SUBREDDIT,
  isTargetSubreddit,
} from "./config.ts";
import { runBackfillChunk } from "./backfill.ts";
import { completionFromPost } from "./completion-factory.ts";
import {
  clearPostAuthor,
  deleteCompletionEntries,
  getCompletedDares,
  getCompletionEntries,
  getStoredPostAuthor,
  saveCompletion,
  saveReviewedCompletion,
} from "./completion-store.ts";
import {
  matchDareFromTitle,
  resolveDareFromTitleAndFlair,
} from "./dare-matching.ts";
import {
  isCommunityDareFlair,
  isPlaybookFlair,
  isTrackedDareFlair,
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
import { hasDaredByUser } from "./text.ts";
import type {
  BackfillTaskData,
  CompletedDare,
  ReviewStatus,
  ScanUserResult,
  TrackPostResult,
  UntrackPostResult,
} from "./types.ts";
import { fetchPlaybookDares } from "./wiki.ts";
import { startBackfillUser } from "./backfill.ts";

async function resolveDareForPost(
  title: string,
  flair: string | undefined,
): Promise<ReturnType<typeof resolveDareFromTitleAndFlair>> {
  const dares = await fetchPlaybookDares();
  return resolveDareFromTitleAndFlair(title, flair, dares);
}

async function refreshKnownHistoryComments(
  username: string,
): Promise<string> {
  const allCompleted = await getCompletedDares(username);
  const body = buildHistoryComment(username, allCompleted);
  await updateExistingHistoryCommentsForUser(allCompleted, body);
  return body;
}

async function isModerator(username: string | undefined): Promise<boolean> {
  if (!username) return false;

  const moderators = await reddit
    .getModerators({
      subredditName: PLAYBOOK_SUBREDDIT,
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

async function removeCompletionForPost(postId: string): Promise<UntrackPostResult> {
  const barePostId = bareThingId(postId);
  const post = await reddit.getPostById(thingId(barePostId, "t3") as T3);
  const entries = await getCompletionEntries(post.authorName);
  const removed = entries.filter(
    ({ dare }) => bareThingId(dare.postId) === barePostId,
  );
  const affectedPostIds = new Set<string>([
    barePostId,
    ...entries.map(({ dare }) => bareThingId(dare.postId)),
  ]);

  if (removed.length === 0) {
    const completed = await getCompletedDares(post.authorName);
    const body = buildHistoryComment(post.authorName, completed);
    await updateExistingHistoryComment(barePostId, body);
    return { untracked: false, reason: "post was not tracked as a dare" };
  }

  await deleteCompletionEntries(post.authorName, removed.map(({ key }) => key));
  await clearPostAuthor(barePostId);

  const completed = await getCompletedDares(post.authorName);
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
    ({ dare }) => bareThingId(dare.postId) === barePostId,
  );

  if (removed.length === 0) {
    const completed = await getCompletedDares(storedAuthorName);
    const body = buildHistoryComment(storedAuthorName, completed);
    await updateExistingHistoryComment(barePostId, body);
    return { untracked: false, reason: "deleted post was not tracked as a dare" };
  }

  await deleteCompletionEntries(storedAuthorName, removed.map(({ key }) => key));
  await clearPostAuthor(barePostId);

  const affectedPostIds = new Set<string>([
    barePostId,
    ...entries.map(({ dare }) => bareThingId(dare.postId)),
  ]);
  const completed = await getCompletedDares(storedAuthorName);
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
  if (canonicalPost.subredditName.toLowerCase() !== PLAYBOOK_SUBREDDIT) {
    return { tracked: false, reason: "ignored non-target subreddit" };
  }
  if (
    authorName &&
    normalizeUsername(canonicalPost.authorName) !== normalizeUsername(authorName)
  ) {
    return { tracked: false, reason: "post author did not match event author" };
  }
  if (!isTrackedDareFlair(canonicalPost.flair?.text)) {
    return { tracked: false, reason: "not tracked dare flair" };
  }

  if (
    isCommunityDareFlair(canonicalPost.flair?.text) &&
    !hasDaredByUser(canonicalPost.title, canonicalPost.body)
  ) {
    await queuePostForMissingDaredBy(canonicalPost.id);
    return {
      tracked: false,
      reason: "DARED BY flair missing daredby u/username; queued for mod review",
    };
  }

  const dare = await resolveDareForPost(
    canonicalPost.title,
    canonicalPost.flair?.text,
  );
  if (!dare) {
    return { tracked: false, reason: "title did not match a tracked dare" };
  }

  const completed = completionFromPost(canonicalPost, dare);
  await saveCompletion(completed);

  await addPendingHistoryPost(canonicalPost.authorName, canonicalPost.id, subredditName);
  const backfillRunning = await startBackfillUser(
    canonicalPost.authorName,
    subredditName,
  );
  if (backfillRunning) {
    return { tracked: true, dare: completed };
  }

  const body = await refreshKnownHistoryComments(canonicalPost.authorName);
  await upsertHistoryComment(canonicalPost.id, body);

  return { tracked: true, dare: completed };
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

  if (isTrackedDareFlair(post.linkFlair?.text)) {
    return trackTriggerPostAndComment(post, undefined, subredditName);
  }

  if (!post.linkFlair?.text) {
    const canonicalPost = await reddit.getPostById(thingId(post.id, "t3") as T3);
    if (canonicalPost.subredditName.toLowerCase() !== PLAYBOOK_SUBREDDIT) {
      return { untracked: false, reason: "ignored non-target subreddit" };
    }
    if (isTrackedDareFlair(canonicalPost.flair?.text)) {
      return trackTriggerPostAndComment(post, undefined, canonicalPost.subredditName);
    }
  }

  return removeCompletionForPost(post.id);
}

export async function reviewPlaybookDare(
  targetId: string,
  status: Exclude<ReviewStatus, "pending">,
  reviewedBy?: string,
): Promise<TrackPostResult> {
  if (!(await isModerator(reviewedBy))) {
    return { tracked: false, reason: "review action is moderator-only" };
  }

  let postId = targetId;

  if (targetId.startsWith("t1_")) {
    const mappedPostId = await redis.get(historyCommentPostKey(targetId));
    if (!mappedPostId) {
      return { tracked: false, reason: "comment is not a Playbook history comment" };
    }
    postId = mappedPostId;
  }

  const post = await reddit.getPostById(thingId(postId, "t3") as T3);
  if (post.subredditName.toLowerCase() !== PLAYBOOK_SUBREDDIT) {
    return { tracked: false, reason: "ignored non-target subreddit" };
  }
  if (!isTrackedDareFlair(post.flair?.text)) {
    return { tracked: false, reason: "not tracked dare flair" };
  }
  if (
    isCommunityDareFlair(post.flair?.text) &&
    !hasDaredByUser(post.title, post.body)
  ) {
    await queuePostForMissingDaredBy(post.id);
    return {
      tracked: false,
      reason: "DARED BY flair missing daredby u/username; queued for mod review",
    };
  }

  const dare = await resolveDareForPost(post.title, post.flair?.text);
  if (!dare) {
    return { tracked: false, reason: "title did not match a tracked dare" };
  }

  const completed: CompletedDare = {
    ...completionFromPost(post, dare),
    status,
    reviewedBy,
    reviewedAtUtc: Math.floor(Date.now() / 1000),
  };

  await saveReviewedCompletion(completed);

  const body = await refreshKnownHistoryComments(completed.author);
  await upsertHistoryComment(post.id, body);

  return { tracked: true, dare: completed };
}

export async function scanUserDares(
  username: string,
  limit: number = DEFAULT_SCAN_LIMIT,
  subredditName?: string,
): Promise<ScanUserResult> {
  const cleanUsername = normalizeUsername(username);
  const cleanSubredditName = (subredditName ?? PLAYBOOK_SUBREDDIT).toLowerCase();
  const dares = await fetchPlaybookDares();
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
    if (!isTrackedDareFlair(post.flair?.text)) continue;
    if (
      isCommunityDareFlair(post.flair?.text) &&
      !hasDaredByUser(post.title, post.body)
    ) {
      continue;
    }

    const dare = isPlaybookFlair(post.flair?.text)
      ? matchDareFromTitle(post.title, dares)
      : resolveDareFromTitleAndFlair(post.title, post.flair?.text, dares);
    if (!dare) continue;

    await saveCompletion(completionFromPost(post, dare));
  }

  const completed = await getCompletedDares(cleanUsername);
  await setUserSyncMeta(
    cleanUsername,
    subredditName,
    limit,
    completed.length,
  );

  return {
    type: "userDares",
    username: cleanUsername,
    count: completed.length,
    dares: completed,
  };
}

export async function getUserDares(
  username: string,
  refresh: boolean,
  limit?: number,
): Promise<ScanUserResult> {
  if (refresh) {
    return scanUserDares(username, limit);
  }

  const cleanUsername = normalizeUsername(username);
  const completed = await getCompletedDares(cleanUsername);
  return {
    type: "userDares",
    username: cleanUsername,
    count: completed.length,
    dares: completed,
  };
}

export { runBackfillChunk };
export type { BackfillTaskData };
