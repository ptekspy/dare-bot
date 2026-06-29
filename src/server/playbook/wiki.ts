import { reddit, redis } from "@devvit/web/server";
import {
  PLAYBOOK_SUBREDDIT,
  PLAYBOOK_WIKI_PAGE,
  REDIS_NAMESPACE,
} from "./config.ts";
import { parsePlaybookDares } from "./dare-matching.ts";
import type { Dare } from "./types.ts";

export async function fetchPlaybookDares(): Promise<Dare[]> {
  const cached = await redis.get(`${REDIS_NAMESPACE}:dares`);
  if (cached) {
    const parsed = JSON.parse(cached) as Dare[];
    if (parsed.length > 0) return parsed;
  }

  const wiki = await reddit.getWikiPage(PLAYBOOK_SUBREDDIT, PLAYBOOK_WIKI_PAGE);
  const dares = parsePlaybookDares(wiki.content);

  if (dares.length === 0) {
    throw Error("No Playbook dares were parsed from the wiki");
  }

  await redis.set(`${REDIS_NAMESPACE}:dares`, JSON.stringify(dares), {
    expiration: new Date(Date.now() + 60 * 60 * 1000),
  });
  return dares;
}
