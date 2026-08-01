import { describe, expect, it } from "vitest";
import {
  classifyPhoneType,
  isPersonName,
  matchTitle,
  pairPeopleWithTitles,
} from "./website-scraper";

describe("isPersonName", () => {
  it("accepts 2–4 capitalized words", () => {
    expect(isPersonName("Jane Smith")).toBe(true);
    expect(isPersonName("Ahmed Al Rashid")).toBe(true);
    expect(isPersonName("Mary Jane van der Berg")).toBe(true);
  });

  it("accepts accented capitals and hyphens/apostrophes", () => {
    expect(isPersonName("José García")).toBe(true);
    expect(isPersonName("Anne-Marie O'Neil")).toBe(true);
  });

  it("rejects single words, long runs and non-name text", () => {
    expect(isPersonName("Plumbing")).toBe(false);
    expect(isPersonName("Best plumbing services in town today")).toBe(false);
    expect(isPersonName("Call us now")).toBe(false); // "us" lowercase
    expect(isPersonName("Open 24 Hours")).toBe(false); // digit
    expect(isPersonName("")).toBe(false);
  });
});

describe("matchTitle", () => {
  it("finds title keywords case-insensitively", () => {
    expect(matchTitle("CEO & Founder")).toBe("CEO");
    expect(matchTitle("managing director")).toBe("Director");
    expect(matchTitle("Co-Founder")).toBe("Co-Founder");
  });

  it("prefers multi-word titles over substrings", () => {
    expect(matchTitle("General Manager")).toBe("General Manager");
  });

  it("returns null when no keyword matches", () => {
    expect(matchTitle("Reception")).toBeNull();
    expect(matchTitle("")).toBeNull();
  });
});

describe("pairPeopleWithTitles", () => {
  it("pairs each name with its nearest title", () => {
    const names = [
      { text: "Jane Smith", position: 1 },
      { text: "John Doe", position: 5 },
    ];
    const titles = [
      { text: "CEO", position: 2 },
      { text: "Director", position: 6 },
    ];
    expect(pairPeopleWithTitles(names, titles)).toEqual([
      { name: "Jane Smith", title: "CEO" },
      { name: "John Doe", title: "Director" },
    ]);
  });

  it("drops names with no title within range", () => {
    const names = [{ text: "Jane Smith", position: 1 }];
    const titles = [{ text: "CEO", position: 50 }];
    expect(pairPeopleWithTitles(names, titles)).toEqual([]);
    expect(pairPeopleWithTitles(names, [])).toEqual([]);
  });

  it("caps results at 5 and dedupes by name", () => {
    const names = [
      { text: "A One", position: 1 },
      { text: "A One", position: 2 },
      { text: "B Two", position: 3 },
      { text: "C Three", position: 4 },
      { text: "D Four", position: 5 },
      { text: "E Five", position: 6 },
      { text: "F Six", position: 7 },
    ];
    const titles = [{ text: "Owner", position: 1 }];
    const result = pairPeopleWithTitles(names, titles);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ name: "A One", title: "Owner" });
    expect(result.map((p) => p.name)).not.toContain("F Six");
  });

  it("returns empty for empty input", () => {
    expect(pairPeopleWithTitles([], [])).toEqual([]);
  });
});

describe("classifyPhoneType", () => {
  it("detects mobile numbers by country prefix", () => {
    expect(classifyPhoneType("+44 7911 123456")).toBe("mobile");
    expect(classifyPhoneType("+971 50 123 4567")).toBe("mobile");
    expect(classifyPhoneType("+91 98765 43210")).toBe("mobile");
    expect(classifyPhoneType("+49 151 12345678")).toBe("mobile");
    expect(classifyPhoneType("+33 6 12 34 56 78")).toBe("mobile");
  });

  it("detects landline numbers by country prefix", () => {
    expect(classifyPhoneType("+44 20 7946 0958")).toBe("landline");
    expect(classifyPhoneType("+971 4 123 4567")).toBe("landline");
    expect(classifyPhoneType("+33 1 23 45 67 89")).toBe("landline");
  });

  it("returns unknown when mobile and landline ranges overlap", () => {
    // NANP (+1) has no prefix split between mobile and landline.
    expect(classifyPhoneType("+1 (555) 123-4567")).toBe("unknown");
  });

  it("returns unknown for empty or invalid input", () => {
    expect(classifyPhoneType("")).toBe("unknown");
    expect(classifyPhoneType("123")).toBe("unknown");
    expect(classifyPhoneType("not a phone")).toBe("unknown");
  });
});
