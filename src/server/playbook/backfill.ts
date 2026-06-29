import { reddit, scheduler } from "@devvit/web/server";
import { BACKFILL_CHUNK_SIZE } from "./config.ts";
import { isCommunityDareFlair, isPlaybookFlair, isTrackedDareFlair } from "./flair.ts";
import { bareThingId, normalizeUsername } from "./ids.ts";
import { matchDareFromTitle, resolveDareFromTitleAndFlair } from "./dare-matching.ts";
import { completionFromPost } from "./completion-factory.ts";
import { getCompletedDares, saveCompletion } from "./completion-store.ts";
import {
  acquireUserBackfillLock,
  clearBackfillState,
  clearPendingHistoryPosts,
  createBackfillState,
  getBackfillState,
  getPendingHistoryPostIds,
  releaseUserBackfillLock,
  setBackfillState,
  setUserSyncMeta,
  shouldBackfillUser,
} from "./sync-store.ts";
import { buildHistoryComment } from "./history-renderer.ts";
import {
  updateExistingHistoryComment,
  upsertHistoryComment,
} from "./history-comments.ts";
import { fetchPlaybookDares } from "./wiki.ts";
import { hasDaredByUser } from "./text.ts";
import type { BackfillTaskData, Dare } from "./types.ts";
import type { Post } from "@devvit/reddit";

export async function scheduleBackfillJob(
  data: BackfillTaskData,
  delayMs = 1000,
): Promise<void> {
  await scheduler.runJob({
    name: "playbookBackfill",
    data,
    runAt: new Date(Date.now() + delayMs),
  });
}

export async function startBackfillUser(
  username: string,
  subredditName?: string,
): Promise<boolean> {
  if (!(await shouldBackfillUser(username, subredditName))) return false;
  if (!(await acquireUserBackfillLock(username, subredditName))) return true;

  const data: BackfillTaskData = {
    username: normalizeUsername(username),
    ...(subredditName ? { subredditName } : {}),
  };

  await createBackfillState(username, subredditName);
  await scheduleBackfillJob(data);
  return true;
}

async function saveCompletionFromHistoricalPost(
  post: Post,
  dares: Dare[],
): Promise<void> {
  if (!isTrackedDareFlair(post.flair?.text)) return;
  if (
    isCommunityDareFlair(post.flair?.text) &&
    !hasDaredByUser(post.title, post.body)
  ) {
    return;
  }

  const dare = isPlaybookFlair(post.flair?.text)
    ? matchDareFromTitle(post.title, dares)
    : resolveDareFromTitleAndFlair(post.title, post.flair?.text, dares);
  if (!dare) return;

  await saveCompletion(completionFromPost(post, dare));
}

async function updateHistoryTablesAfterBackfill(
  username: string,
  subredditName?: string,
): Promise<void> {
  const completed = await getCompletedDares(username);
  const body = buildHistoryComment(username, completed);
  const pendingPostIds = await getPendingHistoryPostIds(username, subredditName);
  const postIds = new Set<string>([
    ...completed.map((dare) => bareThingId(dare.postId)),
    ...pendingPostIds.map(bareThingId),
  ]);

  await Promise.allSettled(
    [...postIds].map((postId) => updateExistingHistoryComment(postId, body)),
  );
  await Promise.allSettled(
    pendingPostIds.map((postId) => upsertHistoryComment(postId, body)),
  );
  await clearPendingHistoryPosts(username, subredditName);
}

async function finishBackfill(
  username: string,
  subredditName: string | undefined,
  limit: number,
): Promise<void> {
  const completed = await getCompletedDares(username);
  await setUserSyncMeta(username, subredditName, limit, completed.length);
  await updateHistoryTablesAfterBackfill(username, subredditName);
  await clearBackfillState(username, subredditName);
  await releaseUserBackfillLock(username, subredditName);
}

export async function runBackfillChunk(data: BackfillTaskData): Promise<void> {
  const username = normalizeUsername(data.username);
  const subredditName = data.subredditName;
  const state = await getBackfillState(username, subredditName);
  if (!state) return;

  const cleanSubredditName = subredditName?.toLowerCase();
  const remaining = Math.max(state.limit - state.processed, 0);
  if (remaining === 0) {
    await finishBackfill(username, subredditName, state.limit);
    return;
  }

  const pageSize = Math.min(BACKFILL_CHUNK_SIZE, remaining);
  const posts = await reddit
    .getPostsByUser({
      username,
      sort: "new",
      timeframe: "all",
      limit: pageSize,
      pageSize,
      ...(state.after ? { after: state.after } : {}),
    })
    .all();
  const dares = await fetchPlaybookDares();

  for (const post of posts) {
    if (
      cleanSubredditName &&
      post.subredditName.toLowerCase() !== cleanSubredditName
    ) {
      continue;
    }

    await saveCompletionFromHistoricalPost(post, dares);
  }

  const processed = state.processed + posts.length;
  const lastPost = posts.at(-1);
  if (posts.length < pageSize || !lastPost) {
    await finishBackfill(username, subredditName, state.limit);
    return;
  }

  await setBackfillState(username, subredditName, {
    ...state,
    after: lastPost.id,
    processed,
  });
  await scheduleBackfillJob({ username, ...(subredditName ? { subredditName } : {}) });
}
