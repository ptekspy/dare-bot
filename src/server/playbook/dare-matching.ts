import type { Dare } from "./types.ts";
import { isCommunityDareFlair, isPlaybookFlair } from "./flair.ts";
import {
  communityDareNameFromTitle,
  nameAliases,
  normalizeText,
} from "./text.ts";

function extractDareName(line: string): string | undefined {
  const match = line.match(/^\s*\*\s+\*\*(.+?)\*\*\s+-\s+/);
  if (!match) return undefined;

  return match[1]?.replace(/^[^\w]+/u, "").trim() || undefined;
}

export function parsePlaybookDares(markdown: string): Dare[] {
  const dares: Dare[] = [];
  const seen = new Set<string>();
  let currentLevel = "Uncategorized";

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      currentLevel = heading[1].trim();
      continue;
    }

    const name = extractDareName(line);
    if (!name) continue;

    const normalizedName = normalizeText(name);
    if (seen.has(normalizedName)) continue;

    seen.add(normalizedName);
    dares.push({
      name,
      level: currentLevel,
      aliases: nameAliases(name),
    });
  }

  return dares;
}

export function matchDareFromTitle(
  title: string,
  dares: Dare[],
): Dare | undefined {
  const normalizedTitle = ` ${normalizeText(title)} `;
  const matches: { dare: Dare; length: number }[] = [];

  for (const dare of dares) {
    for (const alias of dare.aliases) {
      if (normalizedTitle.includes(` ${alias} `)) {
        matches.push({ dare, length: alias.length });
        break;
      }
    }
  }

  return matches.sort((a, b) => b.length - a.length)[0]?.dare;
}

export function resolveDareFromTitleAndFlair(
  title: string,
  flair: string | undefined,
  playbookDares: Dare[],
): Dare | undefined {
  if (isPlaybookFlair(flair)) {
    return matchDareFromTitle(title, playbookDares);
  }

  if (isCommunityDareFlair(flair)) {
    return {
      name: communityDareNameFromTitle(title),
      level: "Community Dare",
      aliases: [],
    };
  }

  return undefined;
}
