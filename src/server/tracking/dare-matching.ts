import type { TrackedItem, TrackedFlairRule } from "./types.ts";
import {
  communityDareNameFromTitle,
  nameAliases,
  normalizeText,
} from "./text.ts";

function extractTrackedItemName(line: string): string | undefined {
  const match = line.match(/^\s*\*\s+\*\*(.+?)\*\*\s+-\s+/);
  if (!match) return undefined;

  return match[1]?.replace(/^[^\w]+/u, "").trim() || undefined;
}

export function parseTrackedItemsFromWiki(markdown: string): TrackedItem[] {
  const trackedItems: TrackedItem[] = [];
  const seen = new Set<string>();
  let currentLevel = "Uncategorized";

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      currentLevel = heading[1].trim();
      continue;
    }

    const name = extractTrackedItemName(line);
    if (!name) continue;

    const normalizedName = normalizeText(name);
    if (seen.has(normalizedName)) continue;

    seen.add(normalizedName);
    trackedItems.push({
      name,
      level: currentLevel,
      aliases: nameAliases(name),
    });
  }

  return trackedItems;
}

export function matchTrackedItemFromTitle(
  title: string,
  trackedItems: TrackedItem[],
): TrackedItem | undefined {
  const normalizedTitle = ` ${normalizeText(title)} `;
  const matches: { item: TrackedItem; length: number }[] = [];

  for (const item of trackedItems) {
    for (const alias of item.aliases) {
      if (normalizedTitle.includes(` ${alias} `)) {
        matches.push({ item, length: alias.length });
        break;
      }
    }
  }

  return matches.sort((a, b) => b.length - a.length)[0]?.item;
}

export function resolveTrackedItemFromTitleAndFlair(
  title: string,
  flair: string | undefined,
  trackedWikiItems: TrackedItem[],
): TrackedItem | undefined {
  const normalizedFlair = (flair ?? "").toLowerCase();
  if (normalizedFlair.includes("playbook")) {
    return matchTrackedItemFromTitle(title, trackedWikiItems);
  }

  if (normalizedFlair.includes("dared by")) {
    return {
      name: communityDareNameFromTitle(title),
      level: "Community Dare",
      aliases: [],
    };
  }

  return undefined;
}

export function resolveTrackedItemFromTitle(
  title: string,
  trackingRule: TrackedFlairRule,
  wikiItems: TrackedItem[],
): TrackedItem | undefined {
  if (trackingRule.wikiLink) {
    return matchTrackedItemFromTitle(title, wikiItems);
  }

  return {
    name: communityDareNameFromTitle(title),
    level: trackingRule.flairText,
    aliases: [],
  };
}

// Compatibility aliases while callsites/tests finish migration to neutral names.
export const parsePlaybookDares = parseTrackedItemsFromWiki;
export const resolveDareFromTitleAndFlair = resolveTrackedItemFromTitleAndFlair;

