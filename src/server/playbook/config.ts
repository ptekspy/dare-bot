export const PLAYBOOK_SUBREDDIT = "daresgonewild";
export const PLAYBOOK_WIKI_PAGE = "dares";
export const PLAYBOOK_FLAIR = "playbook";
export const COMMUNITY_DARE_FLAIR = "dared by";
export const REDIS_NAMESPACE = "playbook:v3";
export const DEFAULT_SCAN_LIMIT = 5000;
export const BACKFILL_CHUNK_SIZE = 100;
export const HISTORY_TABLE_LIMIT = 5;
export const MAX_HISTORY_COMMENT_UPDATES_PER_RUN = 25;
export const HISTORY_COMMENT_UPDATE_CONCURRENCY = 5;
export const USER_BACKFILL_LOCK_MS: number = 5 * 60 * 1000;
export const USER_BACKFILL_REFRESH_MS: number = 7 * 24 * 60 * 60 * 1000;
export const MISSING_DARED_BY_REASON =
  "DARED BY flair requires a daredby u/username mention in the title or body.";

export function isTargetSubreddit(subredditName: string | undefined): boolean {
  return subredditName?.toLowerCase() === PLAYBOOK_SUBREDDIT;
}
