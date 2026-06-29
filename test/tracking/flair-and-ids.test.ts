import { describe, expect, it } from "vitest";
import {
  isCommunityDareFlair,
  isPlaybookFlair,
  isTrackedDareFlair,
} from "../../src/server/tracking/flair.ts";
import {
  bareThingId,
  normalizeUsername,
  permalinkUrl,
  thingId,
} from "../../src/server/tracking/ids.ts";

describe("flair helpers", () => {
  it("recognizes tracked flair text case-insensitively", () => {
    expect(isPlaybookFlair("Official Playbook")).toBe(true);
    expect(isCommunityDareFlair("DARED BY")).toBe(true);
    expect(isTrackedDareFlair("Question")).toBe(false);
  });
});

describe("id helpers", () => {
  it("normalizes usernames and thing ids", () => {
    expect(normalizeUsername(" u/Some_User ")).toBe("some_user");
    expect(bareThingId("t3_abc123")).toBe("abc123");
    expect(thingId("abc123", "t3")).toBe("t3_abc123");
    expect(thingId("t1_def456", "t1")).toBe("t1_def456");
  });

  it("formats reddit permalinks", () => {
    expect(permalinkUrl("/r/test/comments/abc/title/"))
      .toBe("https://www.reddit.com/r/test/comments/abc/title/");
    expect(permalinkUrl("https://reddit.com/r/test/comments/abc/title/"))
      .toBe("https://reddit.com/r/test/comments/abc/title/");
  });
});
