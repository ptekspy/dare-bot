import { describe, expect, it } from "vitest";
import { mergeCompletion } from "../../src/server/tracking/completion-domain.ts";
import { completionRecordKey } from "../../src/server/tracking/redis-keys.ts";
import type { CompletedDare } from "../../src/server/tracking/types.ts";

function completed(overrides: Partial<CompletedDare> = {}): CompletedDare {
  return {
    name: "Heartboob",
    level: "Beginner",
    postId: "t3_abc123",
    title: "Original title",
    url: "https://www.reddit.com/r/test/comments/abc123/title/",
    createdUtc: 1_700_000_000,
    flair: "Playbook",
    author: "example",
    contributors: [],
    status: "pending",
    ...overrides,
  };
}

describe("completion records", () => {
  it("keys completions by post id", () => {
    expect(completionRecordKey(completed())).toBe("abc123");
  });

  it("preserves accepted/rejected review state when a post is re-saved", () => {
    const merged = mergeCompletion(
      completed({
        status: "accepted",
        reviewedBy: "mod",
        reviewedAtUtc: 1_700_000_100,
      }),
      completed({
        title: "Updated title",
        status: "pending",
      }),
    );

    expect(merged).toMatchObject({
      title: "Updated title",
      status: "accepted",
      reviewedBy: "mod",
      reviewedAtUtc: 1_700_000_100,
    });
  });

  it("uses incoming status when there is no completed review", () => {
    expect(
      mergeCompletion(completed({ status: "pending" }), completed({ status: "rejected" }))
        .status,
    ).toBe("rejected");
  });
});
