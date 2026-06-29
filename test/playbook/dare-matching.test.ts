import { describe, expect, it } from "vitest";
import {
  matchDareFromTitle,
  parsePlaybookDares,
  resolveDareFromTitleAndFlair,
} from "../../src/server/playbook/dare-matching.ts";

const wikiMarkdown = `
# Dares

## BEGINNER LEVEL - Easy First Steps

* **💖 Heartboob** - Make a heart shape.
* **The Door Sign** - Wear a sign.
* **Heartboob** - Duplicate entry should be ignored.

## ADVANCED LEVEL

* **Truth & Dare** - Ampersand alias.
* **Truth Dare Deluxe** - Longer match wins.
`;

describe("Playbook dare matching", () => {
  it("parses dare names and levels from wiki markdown", () => {
    const dares = parsePlaybookDares(wikiMarkdown);

    expect(dares).toHaveLength(4);
    expect(dares[0]).toMatchObject({
      name: "Heartboob",
      level: "BEGINNER LEVEL - Easy First Steps",
    });
    expect(dares[1]?.aliases).toContain("door sign");
    expect(dares[2]?.aliases).toContain("truth dare");
  });

  it("matches normalized title aliases", () => {
    const dares = parsePlaybookDares(wikiMarkdown);

    expect(matchDareFromTitle("[Playbook] doing THE door sign!", dares)?.name)
      .toBe("The Door Sign");
    expect(matchDareFromTitle("Truth and Dare tonight", dares)?.name)
      .toBe("Truth & Dare");
  });

  it("chooses the longest matching dare name", () => {
    const dares = parsePlaybookDares(wikiMarkdown);

    expect(matchDareFromTitle("Truth Dare Deluxe attempt", dares)?.name)
      .toBe("Truth Dare Deluxe");
  });

  it("resolves community dares from DARED BY flair without wiki matching", () => {
    const dares = parsePlaybookDares(wikiMarkdown);

    expect(
      resolveDareFromTitleAndFlair(
        "Sunny day daredby u/example",
        "DARED BY",
        dares,
      ),
    ).toMatchObject({
      name: "Sunny day",
      level: "Community Dare",
    });
  });
});
