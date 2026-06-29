export const TARGET_SUBREDDIT = "daresgonewild";
export const PLAYTEST_SUBREDDIT = "dare_bot_dev";
export const TRACKING_WIKI_SUBREDDIT = "daresgonewild";
export const TRACKING_WIKI_PAGE = "dares";
export const REDIS_NAMESPACE = "tracking:v3";
export const DEFAULT_SCAN_LIMIT = 5000;
export const BACKFILL_CHUNK_SIZE = 100;
export const HISTORY_TABLE_LIMIT = 5;
export const MAX_HISTORY_COMMENT_UPDATES_PER_RUN = 25;
export const HISTORY_COMMENT_UPDATE_CONCURRENCY = 5;
export const USER_BACKFILL_LOCK_MS: number = 5 * 60 * 1000;
export const USER_BACKFILL_REFRESH_MS: number = 7 * 24 * 60 * 60 * 1000;
export const TRACKING_RULES_TABLE_HEADER = [
  "Flair to track",
  "Track contributors",
  "wiki link",
] as const;
export const TRACKING_RULES_CACHE_MS = 60 * 60 * 1000;
export const WIKI_ITEMS_CACHE_MS = 60 * 60 * 1000;
export const DEFAULT_TRACKED_FLAIR_RULES = [
  {
    flairText: "Playbook",
    trackContributors: false,
    wikiLink: `r/${TRACKING_WIKI_SUBREDDIT}/wiki/${TRACKING_WIKI_PAGE}`,
  },
  {
    flairText: "DARED BY",
    trackContributors: true,
  },
] as const;
export const MISSING_CONTRIBUTOR_REASON =
  "Tracked flair requires a contributor mention like u/username in the title or body.";

export function isTargetSubreddit(subredditName: string | undefined): boolean {
  const normalized = subredditName?.toLowerCase();
  return normalized === TARGET_SUBREDDIT || normalized === PLAYTEST_SUBREDDIT;
}
