import { describe, expect, it, vi } from "vitest";
import { MetaScraper } from "../src/scrapers/meta.js";
import type { Ad } from "../src/lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function makeGraphAd(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "1234567890",
    page_name: "Acme Co",
    ad_creation_time: "2024-01-15T00:00:00+0000",
    ad_delivery_start_time: "2024-01-20T00:00:00+0000",
    ad_creative_link_titles: ["Buy our widget"],
    ad_creative_bodies: ["Best widgets in town"],
    ad_snapshot_url: "https://www.facebook.com/ads/library/?id=1234567890",
    impressions: { lower_bound: "1000", upper_bound: "5000" },
    spend: { lower_bound: "100", upper_bound: "499" },
    currency: "USD",
    ad_reached_countries: ["US", "CA"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constructor behaviour
// ---------------------------------------------------------------------------

describe("MetaScraper constructor", () => {
  it("with no token defaults to scrape mode (hits public web URL)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      // Should be the public web search endpoint, NOT graph.facebook.com.
      expect(u).toContain("facebook.com/ads/library/async/search_ads/");
      expect(u).not.toContain("graph.facebook.com");
      return htmlResponse("<html><body>no results</body></html>");
    });

    const scraper = new MetaScraper({ fetchImpl, minDelayMs: 0 });
    const ads = await scraper.scrape({ brand: "acme", limit: 5 });
    expect(ads).toEqual([]);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("with token + preferApi=true uses the Graph API", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      expect(u).toContain("graph.facebook.com/v18.0/ads_archive");
      expect(u).toContain("access_token=test-token");
      return jsonResponse({ data: [], paging: {} });
    });

    const scraper = new MetaScraper({
      accessToken: "test-token",
      preferApi: true,
      fetchImpl,
      minDelayMs: 0,
    });
    const ads = await scraper.scrape({ brand: "acme", limit: 5 });
    expect(ads).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// API path
// ---------------------------------------------------------------------------

describe("MetaScraper API path", () => {
  it("single page of results maps to expected Ad[]", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [makeGraphAd(), makeGraphAd({ id: "2", page_name: "Beta Inc" })],
        paging: {},
      }),
    );

    const scraper = new MetaScraper({
      accessToken: "tok",
      fetchImpl,
      minDelayMs: 0,
    });
    const ads = await scraper.scrape({ brand: "acme", limit: 50 });

    expect(ads).toHaveLength(2);
    const first = ads[0] as Ad;
    expect(first.id).toBe("1234567890");
    expect(first.platform).toBe("meta");
    expect(first.advertiser).toBe("Acme Co");
    expect(first.headline).toBe("Buy our widget");
    expect(first.body).toBe("Best widgets in town");
    expect(first.sourceUrl).toBe(
      "https://www.facebook.com/ads/library/?id=1234567890",
    );
    expect(first.impressionsLow).toBe(1000);
    expect(first.impressionsHigh).toBe(5000);
    expect(first.spendLow).toBe(100);
    expect(first.spendHigh).toBe(499);
    expect(first.currency).toBe("USD");
    expect(first.countries).toEqual(["US", "CA"]);
    expect(first.adFormat).toBe("image");
    // delivery_start present + no stop_time → likely active.
    expect(first.isActive).toBe(true);
    expect(first.seenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("follows paging.next until limit is reached", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          data: [makeGraphAd({ id: "a" }), makeGraphAd({ id: "b" })],
          paging: { next: "https://graph.facebook.com/v18.0/ads_archive?after=2" },
        });
      }
      if (call === 2) {
        return jsonResponse({
          data: [makeGraphAd({ id: "c" }), makeGraphAd({ id: "d" })],
          paging: { next: "https://graph.facebook.com/v18.0/ads_archive?after=4" },
        });
      }
      return jsonResponse({
        data: [makeGraphAd({ id: "e" })],
        paging: {},
      });
    });

    const scraper = new MetaScraper({
      accessToken: "tok",
      fetchImpl,
      minDelayMs: 0,
    });
    const ads = await scraper.scrape({ brand: "acme", limit: 4 });

    // Should stop once we have 4 ads — but the page that pushed us over
    // was still fetched, so call count = 2.
    expect(ads).toHaveLength(4);
    expect(ads.map((a) => a.id)).toEqual(["a", "b", "c", "d"]);
    expect(call).toBe(2);
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return jsonResponse({ data: [makeGraphAd()], paging: {} });
    });

    const scraper = new MetaScraper({
      accessToken: "tok",
      fetchImpl,
      // Keep delays microscopic so the test stays fast — the retry path is
      // exercised regardless of the wait magnitude.
      minDelayMs: 0,
    });
    // Stub _delay through the fetch path: hot-patch setTimeout via vi.useFakeTimers.
    vi.useFakeTimers();
    const promise = scraper.scrape({ brand: "acme", limit: 5 });
    // Advance through any pending backoff timers.
    await vi.runAllTimersAsync();
    const ads = await promise;
    vi.useRealTimers();

    expect(call).toBe(2);
    expect(ads).toHaveLength(1);
    expect((ads[0] as Ad).id).toBe("1234567890");
  });

  it("malformed ad_delivery_start_time leaves firstSeen undefined but still emits record", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          makeGraphAd({
            id: "bad-date",
            ad_delivery_start_time: "not-a-real-date",
          }),
        ],
        paging: {},
      }),
    );

    const scraper = new MetaScraper({
      accessToken: "tok",
      fetchImpl,
      minDelayMs: 0,
    });
    const ads = await scraper.scrape({ brand: "acme", limit: 5 });
    expect(ads).toHaveLength(1);
    const ad = ads[0] as Ad;
    expect(ad.id).toBe("bad-date");
    expect(ad.firstSeen).toBeUndefined();
    expect(ad.advertiser).toBe("Acme Co");
  });
});

// ---------------------------------------------------------------------------
// Scrape (web) path
// ---------------------------------------------------------------------------

describe("MetaScraper web scrape path", () => {
  it("synthetic HTML with embedded JSON yields expected Ad[]", async () => {
    const embeddedJson = JSON.stringify({
      results: [
        {
          ad_archive_id: "999111222",
          page_name: "Synthetic Brand",
          start_date: 1705708800, // 2024-01-20 UTC (epoch seconds)
          end_date: null,
          title: "Synthetic headline",
          body: { text: "Synthetic body text" },
          snapshot_url: "https://www.facebook.com/ads/library/?id=999111222",
          link_url: "https://example.com/lp",
          images: ["https://cdn/img1.jpg"],
          videos: [],
          is_active: true,
          countries: ["US"],
        },
      ],
    });
    const html = `<!doctype html><html><body>
      <script type="application/json">${embeddedJson}</script>
    </body></html>`;

    const fetchImpl = vi.fn(async () => htmlResponse(html));

    const scraper = new MetaScraper({ fetchImpl, minDelayMs: 0 });
    const ads = await scraper.scrape({ brand: "synthetic", limit: 10 });

    expect(ads).toHaveLength(1);
    const ad = ads[0] as Ad;
    expect(ad.id).toBe("999111222");
    expect(ad.platform).toBe("meta");
    expect(ad.advertiser).toBe("Synthetic Brand");
    expect(ad.headline).toBe("Synthetic headline");
    expect(ad.body).toBe("Synthetic body text");
    expect(ad.sourceUrl).toBe(
      "https://www.facebook.com/ads/library/?id=999111222",
    );
    expect(ad.landingUrl).toBe("https://example.com/lp");
    expect(ad.creativeUrls).toEqual(["https://cdn/img1.jpg"]);
    expect(ad.isActive).toBe(true);
    expect(ad.adFormat).toBe("image");
    expect(ad.countries).toEqual(["US"]);
    expect(ad.firstSeen).toMatch(/^2024-01-20T/);
  });

  it("includes countries filter in the URL when set (API path)", async () => {
    const capturedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      return jsonResponse({ data: [], paging: {} });
    });

    const scraper = new MetaScraper({
      accessToken: "tok",
      fetchImpl,
      minDelayMs: 0,
    });
    await scraper.scrape({
      brand: "acme",
      countries: ["US", "MX", "CL"],
      limit: 5,
    });

    expect(capturedUrls).toHaveLength(1);
    const url = capturedUrls[0] as string;
    expect(url).toContain("ad_reached_countries=");
    // URLSearchParams encodes commas as %2C
    expect(url).toMatch(/ad_reached_countries=US%2CMX%2CCL/);
  });
});
