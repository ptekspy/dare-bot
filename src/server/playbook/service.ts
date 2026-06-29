import { reddit, redis } from "@devvit/web/server";
import type { PostV2 } from "@devvit/shared";
import type { T3 } from "@devvit/web/shared";
import { DEFAULT_SCAN_LIMIT } from "./config.ts";
import { runBackfillChunk } from "./backfill.ts";
import { completionFromPost, completionFromTriggerPost } from "./completion-factory.ts";
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
): Promise<UntrackPostResult> {
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
  if (!authorName) return { tracked: false, reason: "missing author payload" };
  if (!isTrackedDareFlair(post.linkFlair?.text)) {
    return { tracked: false, reason: "not tracked dare flair" };
  }

  if (
    isCommunityDareFlair(post.linkFlair?.text) &&
    !hasDaredByUser(post.title, post.selftext)
  ) {
    await queuePostForMissingDaredBy(post.id);
    return {
      tracked: false,
      reason: "DARED BY flair missing daredby u/username; queued for mod review",
    };
  }

  const dare = await resolveDareForPost(post.title, post.linkFlair?.text);
  if (!dare) {
    return { tracked: false, reason: "title did not match a tracked dare" };
  }

  const completed = completionFromTriggerPost(post, authorName, dare);
  await saveCompletion(completed);

  await addPendingHistoryPost(authorName, post.id, subredditName);
  const backfillRunning = await startBackfillUser(authorName, subredditName);
  if (backfillRunning) {
    return { tracked: true, dare: completed };
  }

  const body = await refreshKnownHistoryComments(authorName);
  await upsertHistoryComment(post.id, body);

  return { tracked: true, dare: completed };
}

export async function handleTriggerPostFlairUpdate(
  post: PostV2 | undefined,
  authorName: string | undefined,
  subredditName: string | undefined,
): Promise<TrackPostResult | UntrackPostResult> {
  if (!post) return { untracked: false, reason: "missing post payload" };

  if (isTrackedDareFlair(post.linkFlair?.text)) {
    return trackTriggerPostAndComment(post, authorName, subredditName);
  }

  return removeCompletionForPost(post.id);
}

export async function reviewPlaybookDare(
  targetId: string,
  status: Exclude<ReviewStatus, "pending">,
  reviewedBy?: string,
): Promise<TrackPostResult> {
  let postId = targetId;

  if (targetId.startsWith("t1_")) {
    const mappedPostId = await redis.get(historyCommentPostKey(targetId));
    if (!mappedPostId) {
      return { tracked: false, reason: "comment is not a Playbook history comment" };
    }
    postId = mappedPostId;
  }

  const post = await reddit.getPostById(thingId(postId, "t3") as T3);
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
  const cleanSubredditName = subredditName?.toLowerCase();
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
