import { redis } from "@devvit/web/server";
import {
  completedDaresKey,
  completionRecordKey,
  postAuthorKey,
} from "./redis-keys.ts";
import { normalizeUsername } from "./ids.ts";
import type { CompletedDare, CompletionEntry } from "./types.ts";
import { mergeCompletion } from "./completion-domain.ts";

export async function saveCompletion(completed: CompletedDare): Promise<void> {
  const recordKey = completionRecordKey(completed);
  const existingValue = await redis.hGet(completedDaresKey(completed.author), recordKey);
  const existing = existingValue
    ? (JSON.parse(existingValue) as CompletedDare)
    : undefined;
  const merged = mergeCompletion(existing, completed);

  await redis.hSet(completedDaresKey(completed.author), {
    [recordKey]: JSON.stringify(merged),
  });
  await redis.set(postAuthorKey(completed.postId), normalizeUsername(completed.author));
}

export async function saveReviewedCompletion(
  completed: CompletedDare,
): Promise<void> {
  await redis.hSet(completedDaresKey(completed.author), {
    [completionRecordKey(completed)]: JSON.stringify(completed),
  });
  await redis.set(postAuthorKey(completed.postId), normalizeUsername(completed.author));
}

export async function getCompletedDares(
  username: string,
): Promise<CompletedDare[]> {
  const records = await redis.hGetAll(completedDaresKey(username));

  return Object.values(records)
    .map((value) => JSON.parse(value) as CompletedDare)
    .sort((a, b) => a.createdUtc - b.createdUtc || a.name.localeCompare(b.name));
}

export async function getCompletionEntries(
  username: string,
): Promise<CompletionEntry[]> {
  const records = await redis.hGetAll(completedDaresKey(username));

  return Object.entries(records).map(([key, value]) => ({
    key,
    dare: JSON.parse(value) as CompletedDare,
  }));
}

export async function deleteCompletionEntries(
  username: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await redis.hDel(completedDaresKey(username), keys);
}

export async function getStoredPostAuthor(
  postId: string,
): Promise<string | undefined> {
  return (await redis.get(postAuthorKey(postId))) ?? undefined;
}

export async function clearPostAuthor(postId: string): Promise<void> {
  await redis.del(postAuthorKey(postId));
}
