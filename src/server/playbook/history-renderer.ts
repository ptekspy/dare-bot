import { HISTORY_TABLE_LIMIT } from "./config.ts";
import { isCommunityDareFlair, isPlaybookFlair } from "./flair.ts";
import type { CompletedDare } from "./types.ts";

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || "-";
}

function escapeLinkText(value: string): string {
  return escapeTableCell(value).replace(/\]/g, "\\]");
}

function formatUserLinks(usernames: string[]): string {
  if (usernames.length === 0) return "-";

  return usernames.map((username) => `u/${username}`).join(", ");
}

function formatDate(createdUtc: number): string {
  return new Date(createdUtc * 1000).toISOString().slice(0, 10);
}

function postTitleLink(dare: CompletedDare): string {
  return `[${escapeLinkText(dare.title)}](${dare.url})`;
}

function newestFirst(dares: CompletedDare[]): CompletedDare[] {
  return [...dares].sort(
    (a, b) => b.createdUtc - a.createdUtc || a.name.localeCompare(b.name),
  );
}

export function renderPlaybookTable(
  title: string,
  dares: CompletedDare[],
): string[] {
  const sorted = newestFirst(dares);
  const visible = sorted.slice(0, HISTORY_TABLE_LIMIT);
  const older = sorted.slice(HISTORY_TABLE_LIMIT);
  const lines = [
    `## ${title}`,
    "",
    "| Date | Dare | Post |",
    "|---|---|---|",
  ];

  if (visible.length === 0) {
    lines.push("| - | No dares found yet | - |");
  }

  for (const dare of visible) {
    const cells = [
      formatDate(dare.createdUtc),
      escapeTableCell(dare.name),
      postTitleLink(dare),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (older.length > 0) {
    lines.push("", `Older ${title.toLowerCase()}: ${older.length} more stored.`);
  }

  return lines;
}

export function renderCommunityTable(
  title: string,
  dares: CompletedDare[],
): string[] {
  const sorted = newestFirst(dares);
  const visible = sorted.slice(0, HISTORY_TABLE_LIMIT);
  const older = sorted.slice(HISTORY_TABLE_LIMIT);
  const lines = [
    `## ${title}`,
    "",
    "| Date | Dare | Dared by | Post |",
    "|---|---|---|---|",
  ];

  if (visible.length === 0) {
    lines.push("| - | No dares found yet | - | - |");
  }

  for (const dare of visible) {
    const cells = [
      formatDate(dare.createdUtc),
      escapeTableCell(dare.name),
      escapeTableCell(formatUserLinks(dare.daredBy ?? [])),
      postTitleLink(dare),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  if (older.length > 0) {
    lines.push("", `Older ${title.toLowerCase()}: ${older.length} more stored.`);
  }

  return lines;
}

export function buildHistoryComment(
  username: string,
  completed: CompletedDare[],
): string {
  const playbookDares = completed.filter((dare) => isPlaybookFlair(dare.flair));
  const communityDares = completed.filter((dare) =>
    isCommunityDareFlair(dare.flair),
  );
  const lines = [
    `Playbook history for u/${username}`,
    "",
    ...renderPlaybookTable("Playbook Dares", playbookDares),
    "",
    ...renderCommunityTable("Community Dares", communityDares),
    "",
    "Mods can use the post menu to accept or reject a dare. I update this table when tracked dare posts are detected or reviewed.",
  ];

  return lines.join("\n");
}
