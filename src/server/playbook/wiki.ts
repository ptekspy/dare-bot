import { reddit, redis } from "@devvit/web/server";
import {
  PLAYBOOK_WIKI_SUBREDDIT,
  PLAYBOOK_WIKI_PAGE,
  REDIS_NAMESPACE,
} from "./config.ts";
import { parsePlaybookDares } from "./dare-matching.ts";
import type { Dare } from "./types.ts";

function isWikiNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("404") && message.includes("not found");
}

export async function fetchPlaybookDares(): Promise<Dare[]> {
  const cached = await redis.get(`${REDIS_NAMESPACE}:dares`);
  if (cached) {
    const parsed = JSON.parse(cached) as Dare[];
    if (parsed.length > 0) return parsed;
  }

  let wikiContent: string;
  try {
    const wiki = await reddit.getWikiPage(PLAYBOOK_WIKI_SUBREDDIT, PLAYBOOK_WIKI_PAGE);
    wikiContent = wiki.content;
  } catch (err) {
    if (isWikiNotFoundError(err)) {
      console.warn(
        `Playbook wiki page r/${PLAYBOOK_WIKI_SUBREDDIT}/wiki/${PLAYBOOK_WIKI_PAGE} was not found; continuing without wiki-backed dare matching.`,
      );
      return [];
    }
    throw err;
  }
  const dares = parsePlaybookDares(wikiContent);

  if (dares.length === 0) {
    console.warn(
      `Playbook wiki page r/${PLAYBOOK_WIKI_SUBREDDIT}/wiki/${PLAYBOOK_WIKI_PAGE} contained no parseable dares; continuing without wiki-backed dare matching.`,
    );
    return [];
  }

  await redis.set(`${REDIS_NAMESPACE}:dares`, JSON.stringify(dares), {
    expiration: new Date(Date.now() + 60 * 60 * 1000),
  });
  return dares;
}
