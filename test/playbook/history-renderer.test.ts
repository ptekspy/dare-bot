import { describe, expect, it } from "vitest";
import { buildHistoryComment } from "../../src/server/playbook/history-renderer.ts";
import type { CompletedDare } from "../../src/server/playbook/types.ts";

function completed(overrides: Partial<CompletedDare>): CompletedDare {
  return {
    name: "Heartboob",
    level: "Beginner",
    postId: "abc123",
    title: "Heartboob",
    url: "https://www.reddit.com/r/test/comments/abc123/title/",
    createdUtc: 1_700_000_000,
    flair: "Playbook",
    author: "example",
    daredBy: [],
    status: "pending",
    ...overrides,
  };
}

describe("history comment rendering", () => {
  it("renders separate Playbook and Community tables", () => {
    const body = buildHistoryComment("example", [
      completed({ name: "Heartboob", flair: "Playbook" }),
      completed({
        name: "Sunny day",
        title: "Sunny day daredby u/Alice",
        flair: "DARED BY",
        daredBy: ["Alice"],
        postId: "community1",
      }),
    ]);

    expect(body).toContain("## Playbook Dares");
    expect(body).toContain("## Community Dares");
    expect(body).toContain("| Date | Dare | Dared by | Post |");
    expect(body).toContain("u/Alice");
  });

  it("links post titles and hides internal review status", () => {
    const body = buildHistoryComment("example", [
      completed({
        title: "Title with | pipe",
        status: "accepted",
      }),
    ]);

    expect(body).toContain("[Title with \\| pipe](https://www.reddit.com/r/test/comments/abc123/title/)");
    expect(body).not.toContain("accepted");
  });

  it("shows five newest rows and puts older rows below", () => {
    const body = buildHistoryComment(
      "example",
      Array.from({ length: 6 }, (_, index) =>
        completed({
          name: `Dare ${index + 1}`,
          title: `Post ${index + 1}`,
          postId: `post${index + 1}`,
          createdUtc: 1_700_000_000 + index,
        }),
      ),
    );

    expect(body).toContain("Older playbook dares: 1 more stored.");
    expect(body).not.toContain(">!2023-11-14 - Dare 1 - [Post 1]");
    expect(body).toContain("| 2023-11-14 | Dare 6 | [Post 6]");
  });
});
