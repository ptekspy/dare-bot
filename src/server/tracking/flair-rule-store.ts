import { redis } from "@devvit/web/server";
import {
  trackedFlairRulesCacheKey,
  trackedFlairRulesOverridesKey,
} from "./redis-keys.ts";
import type { TrackedFlairRule } from "./types.ts";

function normalizeFlairText(flairText: string): string {
  return flairText.trim().toLowerCase();
}

export function makeManualTrackedFlairRule(input: {
  flairText: string;
  trackContributors: boolean;
  wikiLink?: string;
}): TrackedFlairRule {
  return {
    flairText: input.flairText.trim(),
    normalizedFlairText: normalizeFlairText(input.flairText),
    trackContributors: input.trackContributors,
    wikiLink: input.wikiLink?.trim() || undefined,
    source: "manual",
  };
}

export async function listManualTrackedFlairRules(
  subredditName?: string,
): Promise<TrackedFlairRule[]> {
  const records = await redis.hGetAll(trackedFlairRulesOverridesKey(subredditName));
  return Object.values(records)
    .map((value) => JSON.parse(value) as TrackedFlairRule)
    .sort((a, b) => a.flairText.localeCompare(b.flairText));
}

export async function upsertManualTrackedFlairRule(
  rule: TrackedFlairRule,
  subredditName?: string,
): Promise<void> {
  await redis.hSet(trackedFlairRulesOverridesKey(subredditName), {
    [rule.normalizedFlairText]: JSON.stringify({ ...rule, source: "manual" }),
  });
  await redis.del(trackedFlairRulesCacheKey(subredditName));
}

export async function removeManualTrackedFlairRule(
  flairText: string,
  subredditName?: string,
): Promise<boolean> {
  const normalized = normalizeFlairText(flairText);
  if (!normalized) return false;

  const removed = await redis.hDel(trackedFlairRulesOverridesKey(subredditName), [normalized]);
  await redis.del(trackedFlairRulesCacheKey(subredditName));
  return removed > 0;
}

export async function clearTrackedFlairRulesCache(
  subredditName?: string,
): Promise<void> {
  await redis.del(trackedFlairRulesCacheKey(subredditName));
}
