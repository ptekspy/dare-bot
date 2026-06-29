import { describe, expect, it } from "vitest";
import { parseTrackedFlairRulesFromWiki } from "../../src/server/tracking/wiki.ts";

describe("tracked flair rules wiki table", () => {
  it("parses required and optional columns", () => {
    const markdown = [
      "# Tracking Rules",
      "",
      "|Flair to track|Track contributors|wiki link|",
      "|---|---|---|",
      "|Playbook|false|r/daresgonewild/wiki/dares|",
      "|DARED BY|true||",
      "|Challenge||https://reddit.com/r/daresgonewild/wiki/custom|",
    ].join("\n");

    const rules = parseTrackedFlairRulesFromWiki(markdown);
    expect(rules).toEqual([
      {
        flairText: "Playbook",
        normalizedFlairText: "playbook",
        trackContributors: false,
        wikiLink: "r/daresgonewild/wiki/dares",
        source: "wiki",
      },
      {
        flairText: "DARED BY",
        normalizedFlairText: "dared by",
        trackContributors: true,
        wikiLink: undefined,
        source: "wiki",
      },
      {
        flairText: "Challenge",
        normalizedFlairText: "challenge",
        trackContributors: false,
        wikiLink: "https://reddit.com/r/daresgonewild/wiki/custom",
        source: "wiki",
      },
    ]);
  });

  it("skips rows missing flair text", () => {
    const markdown = [
      "|Flair to track|Track contributors|wiki link|",
      "|---|---|---|",
      "|||",
      "|   |yes|r/daresgonewild/wiki/dares|",
      "|Valid|1||",
    ].join("\n");

    const rules = parseTrackedFlairRulesFromWiki(markdown);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.flairText).toBe("Valid");
    expect(rules[0]?.trackContributors).toBe(true);
  });
});
