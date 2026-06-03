import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseDate,
  parseFormat,
  parseCountries,
  buildAd,
} from "../src/scrapers/google_parser.js";

beforeEach(() => {
  // Parsers warn on bad input — silence to keep test output clean.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseDate", () => {
  it("parses US format 'Sep 15, 2024'", () => {
    expect(parseDate("Sep 15, 2024")).toBe("2024-09-15");
  });

  it("parses long US format 'September 5, 2023'", () => {
    expect(parseDate("September 5, 2023")).toBe("2023-09-05");
  });

  it("parses EU format '15 Sep 2024'", () => {
    expect(parseDate("15 Sep 2024")).toBe("2024-09-15");
  });

  it("parses range ending in 'present' by taking the first date", () => {
    expect(parseDate("Sep 15, 2024 — present")).toBe("2024-09-15");
  });

  it("returns undefined for malformed input", () => {
    expect(parseDate("not a date")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseDate("")).toBeUndefined();
  });

  it("returns undefined for implausible year", () => {
    expect(parseDate("Sep 15, 1800")).toBeUndefined();
  });
});

describe("parseFormat", () => {
  it("maps 'Image' to 'image'", () => {
    expect(parseFormat("Image")).toBe("image");
  });

  it("maps 'Video' to 'video'", () => {
    expect(parseFormat("Video")).toBe("video");
  });

  it("maps 'Text' to 'text'", () => {
    expect(parseFormat("Text")).toBe("text");
  });

  it("maps 'Search' to 'text'", () => {
    expect(parseFormat("Search")).toBe("text");
  });

  it("maps unknown chip to 'unknown'", () => {
    expect(parseFormat("Hologram")).toBe("unknown");
  });

  it("handles empty input as 'unknown'", () => {
    expect(parseFormat("")).toBe("unknown");
  });
});

describe("parseCountries", () => {
  it("parses a single country", () => {
    expect(parseCountries("United States")).toEqual(["US"]);
  });

  it("parses a comma-separated list", () => {
    expect(parseCountries("United States, Germany, Chile")).toEqual(["US", "DE", "CL"]);
  });

  it("drops unknown country names silently", () => {
    expect(parseCountries("United States, Atlantis, Germany")).toEqual(["US", "DE"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCountries("")).toEqual([]);
  });
});

describe("buildAd", () => {
  it("produces a typical Ad with platform and seenAt set", () => {
    const ad = buildAd({
      id: "CR12345",
      advertiser: "Acme Corp",
      formatChip: "Image",
      firstShownRaw: "Sep 15, 2024",
      lastShownRaw: "Oct 1, 2024",
      regionsRaw: "United States, Germany",
      creativeUrl: "https://example.com/img.jpg",
      landingUrl: "https://acme.example/landing",
      headline: "Best widgets",
      body: "Buy now",
      sourceUrl: "https://adstransparency.google.com/advertiser/X/creative/Y",
    });

    expect(ad.id).toBe("CR12345");
    expect(ad.platform).toBe("google");
    expect(ad.advertiser).toBe("Acme Corp");
    expect(ad.adFormat).toBe("image");
    expect(ad.firstSeen).toBe("2024-09-15");
    expect(ad.lastSeen).toBe("2024-10-01");
    expect(ad.countries).toEqual(["US", "DE"]);
    expect(ad.creativeUrls).toEqual(["https://example.com/img.jpg"]);
    expect(ad.landingUrl).toBe("https://acme.example/landing");
    expect(ad.headline).toBe("Best widgets");
    expect(ad.body).toBe("Buy now");
    expect(ad.sourceUrl).toBe("https://adstransparency.google.com/advertiser/X/creative/Y");
    expect(typeof ad.seenAt).toBe("string");
    expect(() => new Date(ad.seenAt).toISOString()).not.toThrow();
  });

  it("omits optional fields (no nulls, no empty strings) when source missing", () => {
    const ad = buildAd({ id: "CR1", advertiser: "X" });
    expect(ad.firstSeen).toBeUndefined();
    expect(ad.lastSeen).toBeUndefined();
    expect(ad.countries).toBeUndefined();
    expect(ad.creativeUrls).toBeUndefined();
    expect(ad.landingUrl).toBeUndefined();
    expect(ad.headline).toBeUndefined();
    expect(ad.body).toBeUndefined();
    expect(ad.adFormat).toBeUndefined();
    expect(ad.sourceUrl).toBeUndefined();
    // not null, not ""
    expect(ad.firstSeen).not.toBeNull();
    expect(ad.headline).not.toBe("");
  });

  it("leaves date fields undefined when raw date is malformed but keeps the rest", () => {
    const ad = buildAd({
      id: "CR2",
      advertiser: "X",
      formatChip: "Video",
      firstShownRaw: "garbage",
      lastShownRaw: "Oct 1, 2024",
      headline: "hi",
    });
    expect(ad.firstSeen).toBeUndefined();
    expect(ad.lastSeen).toBe("2024-10-01");
    expect(ad.adFormat).toBe("video");
    expect(ad.headline).toBe("hi");
  });

  it("throws when id is missing", () => {
    expect(() => buildAd({ id: "", advertiser: "X" })).toThrow(/id required/);
  });
});
