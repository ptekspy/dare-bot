import { reddit, redis } from "@devvit/web/server";
import {
  DEFAULT_TRACKED_FLAIR_RULES,
  TARGET_SUBREDDIT,
  TRACKING_WIKI_SUBREDDIT,
  TRACKING_WIKI_PAGE,
  REDIS_NAMESPACE,
  TRACKING_RULES_CACHE_MS,
  TRACKING_RULES_TABLE_HEADER,
  WIKI_ITEMS_CACHE_MS,
} from "./config.ts";
import { listManualTrackedFlairRules } from "./flair-rule-store.ts";
import { trackedFlairRulesCacheKey, wikiTrackedItemsCacheKey } from "./redis-keys.ts";
import { parseTrackedItemsFromWiki } from "./dare-matching.ts";
import type { TrackedItem, TrackedFlairRule } from "./types.ts";

function isWikiNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("404") && message.includes("not found");
}

function normalizeFlairText(value: string): string {
  return value.trim().toLowerCase();
}

function parseTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseWikiTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseTrackedFlairRulesFromWiki(markdown: string): TrackedFlairRule[] {
  const lines = markdown.split(/\r?\n/);
  const headerNeedle = TRACKING_RULES_TABLE_HEADER.map((header) => header.toLowerCase());

  for (let index = 0; index < lines.length; index++) {
    const headerLine = lines[index]?.trim();
    if (!headerLine?.startsWith("|")) continue;

    const headerCells = parseWikiTableCells(headerLine).map((cell) => cell.toLowerCase());
    if (
      headerCells.length < headerNeedle.length
      || headerNeedle.some((header, column) => headerCells[column] !== header)
    ) {
      continue;
    }

    const rules: TrackedFlairRule[] = [];
    for (let row = index + 2; row < lines.length; row++) {
      const rowLine = lines[row]?.trim();
      if (!rowLine?.startsWith("|")) break;

      const cells = parseWikiTableCells(rowLine);
      const flairText = (cells[0] ?? "").trim();
      if (!flairText) continue;

      const wikiLinkRaw = (cells[2] ?? "").trim();
      rules.push({
        flairText,
        normalizedFlairText: normalizeFlairText(flairText),
        trackContributors: parseTruthy(cells[1] ?? ""),
        wikiLink: wikiLinkRaw || undefined,
        source: "wiki",
      });
    }

    return rules;
  }

  return [];
}

async function fetchWikiPageContent(
  subreddit: string,
  page: string,
): Promise<string | undefined> {
  try {
    const wiki = await reddit.getWikiPage(subreddit, page);
    return wiki.content;
  } catch (err) {
    if (isWikiNotFoundError(err)) {
      console.warn(
        `Wiki page r/${subreddit}/wiki/${page} was not found; continuing without wiki-backed matching for that page.`,
      );
      return undefined;
    }
    throw err;
  }
}

function defaultTrackedRules(): TrackedFlairRule[] {
  return DEFAULT_TRACKED_FLAIR_RULES.map((rule) => ({
    flairText: rule.flairText,
    normalizedFlairText: normalizeFlairText(rule.flairText),
    trackContributors: rule.trackContributors,
    wikiLink: rule.wikiLink,
    source: "default",
  }));
}

export async function fetchTrackedFlairRules(
  subredditName: string = TARGET_SUBREDDIT,
): Promise<TrackedFlairRule[]> {
  const cacheKey = trackedFlairRulesCacheKey(subredditName);
  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as TrackedFlairRule[];
    if (parsed.length > 0) return parsed;
  }

  const defaults = defaultTrackedRules();
  const wikiContent = await fetchWikiPageContent(TRACKING_WIKI_SUBREDDIT, TRACKING_WIKI_PAGE);
  if (!wikiContent) {
    return defaults;
  }

  const wikiRules = parseTrackedFlairRulesFromWiki(wikiContent);
  const merged = new Map<string, TrackedFlairRule>(
    defaults.map((rule) => [rule.normalizedFlairText, rule]),
  );

  for (const rule of wikiRules) {
    merged.set(rule.normalizedFlairText, rule);
  }

  const manualRules = await listManualTrackedFlairRules(subredditName);
  for (const rule of manualRules) {
    merged.set(rule.normalizedFlairText, rule);
  }

  const result = [...merged.values()];
  await redis.set(cacheKey, JSON.stringify(result), {
    expiration: new Date(Date.now() + TRACKING_RULES_CACHE_MS),
  });

  return result;
}

function parseWikiLink(wikiLink: string): { subreddit: string; page: string } | undefined {
  const normalized = wikiLink.trim();
  if (!normalized) return undefined;

  const fullUrl = normalized.match(/reddit\.com\/r\/([^/]+)\/wiki\/([^/?#]+)/i);
  if (fullUrl?.[1] && fullUrl[2]) {
    return { subreddit: fullUrl[1], page: fullUrl[2] };
  }

  const shortPath = normalized.match(/^\/?r\/([^/]+)\/wiki\/([^/?#]+)$/i);
  if (shortPath?.[1] && shortPath[2]) {
    return { subreddit: shortPath[1], page: shortPath[2] };
  }

  if (!normalized.includes("/")) {
    return { subreddit: TRACKING_WIKI_SUBREDDIT, page: normalized };
  }

  return undefined;
}

export async function fetchWikiTrackedItems(wikiLink: string): Promise<TrackedItem[]> {
  const wiki = parseWikiLink(wikiLink);
  if (!wiki) {
    console.warn(`Ignoring invalid wiki link: ${wikiLink}`);
    return [];
  }

  const cacheKey = wikiTrackedItemsCacheKey(wiki.subreddit, wiki.page);
  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as TrackedItem[];
    if (parsed.length > 0) return parsed;
  }

  const wikiContent = await fetchWikiPageContent(wiki.subreddit, wiki.page);
  if (!wikiContent) return [];

  const trackedItems = parseTrackedItemsFromWiki(wikiContent);
  if (trackedItems.length === 0) {
    return [];
  }

  await redis.set(cacheKey, JSON.stringify(trackedItems), {
    expiration: new Date(Date.now() + WIKI_ITEMS_CACHE_MS),
  });
  return trackedItems;
}

export async function fetchDefaultWikiItems(): Promise<TrackedItem[]> {
  return fetchWikiTrackedItems(`r/${TRACKING_WIKI_SUBREDDIT}/wiki/${TRACKING_WIKI_PAGE}`);
}
