import { describe, expect, it, vi } from "vitest";
import { runScan } from "../src/lib/orchestrator";
import type { Ad, Platform, ProgressEvent, Scraper, ScraperOptions } from "../src/lib/types";

function makeAd(platform: Platform, id: string): Ad {
  return {
    id,
    platform,
    advertiser: "Acme",
    seenAt: new Date().toISOString(),
  };
}

class FakeScraper implements Scraper {
  readonly name: Platform;
  constructor(name: Platform, private ads: Ad[], private emit: ProgressEvent[] = []) {
    this.name = name;
  }
  async scrape(opts: ScraperOptions): Promise<Ad[]> {
    for (const e of this.emit) opts.onProgress?.(e);
    return this.ads;
  }
}

class BoomScraper implements Scraper {
  readonly name: Platform;
  constructor(name: Platform, private err: string) {
    this.name = name;
  }
  async scrape(): Promise<Ad[]> {
    throw new Error(this.err);
  }
}

describe("orchestrator.runScan", () => {
  it("merges results from every scraper (happy path)", async () => {
    const a = new FakeScraper("meta", [makeAd("meta", "m1"), makeAd("meta", "m2")]);
    const b = new FakeScraper("google", [makeAd("google", "g1")]);
    const res = await runScan({ brand: "X", scrapers: [a, b] });
    expect(res.ads).toHaveLength(3);
    expect(res.errors).toHaveLength(0);
    expect(res.ads.map((x) => x.id).sort()).toEqual(["g1", "m1", "m2"]);
  });

  it("collects errors when one scraper fails — does not kill the run", async () => {
    const ok = new FakeScraper("meta", [makeAd("meta", "ok1")]);
    const bad = new BoomScraper("google", "rate limited");
    const res = await runScan({ brand: "X", scrapers: [ok, bad] });
    expect(res.ads).toHaveLength(1);
    expect(res.ads[0]?.id).toBe("ok1");
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.source).toBe("google");
    expect(res.errors[0]?.message).toContain("rate limited");
  });

  it("forwards progress events from scrapers to the unified callback", async () => {
    const onProgress = vi.fn();
    const a = new FakeScraper(
      "meta",
      [makeAd("meta", "m1")],
      [
        { source: "meta", phase: "starting", message: "go" },
        { source: "meta", phase: "fetching", message: "page 1" },
      ],
    );
    const res = await runScan({ brand: "X", scrapers: [a], onProgress });
    expect(res.ads).toHaveLength(1);
    // 2 forwarded + 1 final "complete" emitted by the orchestrator
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "meta", phase: "complete", count: 1 }),
    );
  });

  it("emits an 'error' progress event when a scraper throws", async () => {
    const onProgress = vi.fn();
    const bad = new BoomScraper("meta", "boom");
    const res = await runScan({ brand: "X", scrapers: [bad], onProgress });
    expect(res.ads).toEqual([]);
    expect(res.errors).toHaveLength(1);
    const calls = onProgress.mock.calls.map((c) => c[0] as ProgressEvent);
    expect(calls.some((e) => e.phase === "error" && e.source === "meta")).toBe(true);
  });

  it("respects the soft limit by capping the merged result", async () => {
    const a = new FakeScraper("meta", [
      makeAd("meta", "1"),
      makeAd("meta", "2"),
      makeAd("meta", "3"),
    ]);
    const b = new FakeScraper("google", [
      makeAd("google", "4"),
      makeAd("google", "5"),
    ]);
    const res = await runScan({ brand: "X", scrapers: [a, b], limit: 2 });
    expect(res.ads).toHaveLength(2);
  });

  it("returns an empty array when every scraper returns nothing", async () => {
    const a = new FakeScraper("meta", []);
    const b = new FakeScraper("google", []);
    const res = await runScan({ brand: "X", scrapers: [a, b] });
    expect(res.ads).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it("works with zero scrapers (defensive)", async () => {
    const res = await runScan({ brand: "X", scrapers: [] });
    expect(res.ads).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it("does not crash when the onProgress callback throws", async () => {
    const onProgress = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const a = new FakeScraper("meta", [makeAd("meta", "m1")], [
      { source: "meta", phase: "starting", message: "go" },
    ]);
    const res = await runScan({ brand: "X", scrapers: [a], onProgress });
    expect(res.ads).toHaveLength(1);
    expect(onProgress).toHaveBeenCalled();
  });
});
