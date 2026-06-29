import { reddit, redis } from "@devvit/web/server";
import type { T3 } from "@devvit/web/shared";
import { MISSING_CONTRIBUTOR_REASON } from "./config.ts";
import { missingDaredByQueueKey } from "./redis-keys.ts";
import { thingId } from "./ids.ts";

export async function queuePostForMissingDaredBy(postId: string): Promise<void> {
  const key = missingDaredByQueueKey(postId);
  const alreadyQueued = await redis.get(key);
  if (alreadyQueued) return;

  const post = await reddit.getPostById(thingId(postId, "t3") as T3);
  await post.filter(MISSING_CONTRIBUTOR_REASON, true);
  await redis.set(key, "1", {
    expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}
