import { describe, expect, it } from "vitest";
import { htmlToText } from "./text";
import { orgNameKey } from "./orgs";
import { trigramSimilarity } from "./similarity";
import { parseRemoteType } from "./location";

describe("htmlToText", () => {
  it("keeps paragraphs, list items, and line breaks readable", () => {
    expect(
      htmlToText(
        "<h2>About &amp; us</h2><p>We build <b>tools</b>.</p><ul><li><p>One</p></li><li>Two</li></ul><p>A<br/>B<br /><br />C</p><script>x()</script>",
      ),
    ).toBe("About & us\n\nWe build tools.\n\n• One\n• Two\nA\nB\n\nC");
  });
});

describe("orgNameKey", () => {
  it("matches differently written names of one employer", () => {
    expect(orgNameKey("The Raft, LLC")).toBe(orgNameKey("raft"));
    expect(orgNameKey("Code for America")).toBe("code for america");
    expect(orgNameKey("Partners & Advocates")).toBe("partners and advocates");
  });
});

describe("trigramSimilarity", () => {
  it("scores near-identical titles high and different ones low", () => {
    expect(trigramSimilarity("Senior Software Engineer", "Senior Software Engineer")).toBe(1);
    expect(trigramSimilarity("Sr. Software Engineer, Backend", "Software Engineer - Backend")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("Data Scientist", "Program Manager")).toBeLessThan(0.2);
  });
});

describe("parseRemoteType", () => {
  it.each([
    ["Alameda, CA (Hybrid)", "hybrid"],
    ["Remote - US", "remote"],
    ["In-office", "onsite"],
    ["On site (Cambridge, MA)", "onsite"],
    ["Philadelphia, PA, USA", null],
  ])("reads %s", (text, expected) => {
    expect(parseRemoteType(text)).toBe(expected);
  });
});
