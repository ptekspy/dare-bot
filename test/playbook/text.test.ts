import { describe, expect, it } from "vitest";
import {
  communityDareNameFromTitle,
  extractDaredBy,
  hasDaredByUser,
  normalizeText,
} from "../../src/server/playbook/text.ts";

describe("Playbook text helpers", () => {
  it("normalizes text for forgiving matching", () => {
    expect(normalizeText("Truth & Dare by u/Someone!!!")).toBe("truth and dare by");
  });

  it("extracts dared-by users from supported title and body variants", () => {
    expect(
      extractDaredBy(
        "Sunny daredby u/Alice",
        "also dared by /u/Bob and dared-by `u/Alice`",
      ),
    ).toEqual(["Alice", "Bob"]);
  });

  it("detects whether a DARED BY post has a user mention", () => {
    expect(hasDaredByUser("dared by u/example")).toBe(true);
    expect(hasDaredByUser("dared by nobody in particular")).toBe(false);
  });

  it("strips dared-by text from community dare names", () => {
    expect(communityDareNameFromTitle("Sunny day - dared by /u/example"))
      .toBe("Sunny day");
    expect(communityDareNameFromTitle("daredby u/example")).toBe("daredby u/example");
  });
});
