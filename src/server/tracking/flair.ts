import { DEFAULT_TRACKED_FLAIR_RULES } from "./config.ts";
import { fetchTrackedFlairRules } from "./wiki.ts";
import type { TrackedFlairRule } from "./types.ts";

export function normalizeFlairText(flair: string | undefined): string {
  return (flair ?? "").trim().toLowerCase();
}

export async function trackedFlairRuleForText(
  flair: string | undefined,
): Promise<TrackedFlairRule | undefined> {
  const normalized = normalizeFlairText(flair);
  if (!normalized) return undefined;

  const rules = await fetchTrackedFlairRules();
  return rules.find((rule) => normalized.includes(rule.normalizedFlairText));
}

export async function isTrackedFlair(flair: string | undefined): Promise<boolean> {
  return (await trackedFlairRuleForText(flair)) !== undefined;
}

function hasDefaultRule(
  flair: string | undefined,
  predicate: (rule: { flairText: string; wikiLink?: string }) => boolean,
): boolean {
  const normalized = normalizeFlairText(flair);
  return DEFAULT_TRACKED_FLAIR_RULES
    .filter(predicate)
    .some((rule) => normalized.includes(rule.flairText.toLowerCase()));
}

export function isPlaybookFlair(flair: string | undefined): boolean {
  return hasDefaultRule(flair, (rule) => Boolean(rule.wikiLink));
}

export function isCommunityDareFlair(flair: string | undefined): boolean {
  return hasDefaultRule(flair, (rule) => !rule.wikiLink);
}

export function isTrackedDareFlair(flair: string | undefined): boolean {
  return isPlaybookFlair(flair) || isCommunityDareFlair(flair);
}
