import type { Post } from "@devvit/reddit";
import type { PostV2 } from "@devvit/shared";
import type { CompletedDare, Dare } from "./types.ts";
import { permalinkUrl } from "./ids.ts";
import { extractDaredBy } from "./text.ts";

export function completionFromTriggerPost(
  post: PostV2,
  authorName: string,
  dare: Dare,
): CompletedDare {
  return {
    name: dare.name,
    level: dare.level,
    postId: post.id,
    title: post.title,
    url: permalinkUrl(post.permalink),
    createdUtc: Math.floor(post.createdAt / 1000),
    flair: post.linkFlair?.text ?? "",
    author: authorName,
    daredBy: extractDaredBy(post.title, post.selftext),
    status: "pending",
  };
}

export function completionFromPost(post: Post, dare: Dare): CompletedDare {
  return {
    name: dare.name,
    level: dare.level,
    postId: post.id,
    title: post.title,
    url: permalinkUrl(post.permalink),
    createdUtc: Math.floor(post.createdAt.getTime() / 1000),
    flair: post.flair?.text ?? "",
    author: post.authorName,
    daredBy: extractDaredBy(post.title, post.body),
    status: "pending",
  };
}
