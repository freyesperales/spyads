import type { Ad, Platform, Scraper, ScraperOptions } from "../lib/types";

/**
 * Fallback scraper so the orchestrator + UI can ship even before the real
 * Meta / Google scrapers are wired in. Returns 3 synthetic Ads that look
 * realistic enough to render in the report grid.
 */
export class StubScraper implements Scraper {
  readonly name: Platform;

  constructor(name: Platform) {
    this.name = name;
  }

  async scrape(opts: ScraperOptions): Promise<Ad[]> {
    opts.onProgress?.({
      source: this.name,
      phase: "starting",
      message: `[stub] resolving ${opts.brand}`,
    });
    await new Promise((r) => setTimeout(r, 400));
    opts.onProgress?.({
      source: this.name,
      phase: "fetching",
      message: `[stub] scanning ${this.name} library`,
    });
    await new Promise((r) => setTimeout(r, 600));

    const now = new Date().toISOString();
    const brand = opts.brand;
    const ads: Ad[] = [
      {
        id: `${this.name}-${brand.toLowerCase()}-1`,
        platform: this.name,
        advertiser: brand,
        seenAt: now,
        firstSeen: new Date(Date.now() - 14 * 86400000).toISOString(),
        isActive: true,
        headline: `${brand}: limited spring offer`,
        body: `Try ${brand} today and save 20% on your first order.`,
        cta: "Shop now",
        landingUrl: `https://example.com/${brand.toLowerCase()}/spring`,
        adFormat: "image",
        sourceUrl: `https://${this.name}.example/${brand.toLowerCase()}/1`,
        creativeUrls: ["https://placehold.co/600x400/4f46e5/ffffff?text=Ad+1"],
        countries: opts.countries?.length ? opts.countries : ["US"],
      },
      {
        id: `${this.name}-${brand.toLowerCase()}-2`,
        platform: this.name,
        advertiser: brand,
        seenAt: now,
        firstSeen: new Date(Date.now() - 3 * 86400000).toISOString(),
        isActive: true,
        headline: `${brand} — why creators choose us`,
        body: "Watch the 30-second demo and see for yourself.",
        cta: "Watch demo",
        landingUrl: `https://example.com/${brand.toLowerCase()}/demo`,
        adFormat: "video",
        sourceUrl: `https://${this.name}.example/${brand.toLowerCase()}/2`,
        creativeUrls: ["https://placehold.co/600x400/ec4899/ffffff?text=Ad+2"],
        countries: opts.countries?.length ? opts.countries : ["US"],
      },
      {
        id: `${this.name}-${brand.toLowerCase()}-3`,
        platform: this.name,
        advertiser: brand,
        seenAt: now,
        firstSeen: new Date(Date.now() - 30 * 86400000).toISOString(),
        lastSeen: new Date(Date.now() - 1 * 86400000).toISOString(),
        isActive: false,
        headline: `${brand} — the engineer's choice`,
        body: "Three reasons teams switch to us this quarter.",
        cta: "Read case study",
        landingUrl: `https://example.com/${brand.toLowerCase()}/case`,
        adFormat: "carousel",
        sourceUrl: `https://${this.name}.example/${brand.toLowerCase()}/3`,
        creativeUrls: [
          "https://placehold.co/600x400/1f2937/ffffff?text=Ad+3a",
          "https://placehold.co/600x400/4f46e5/ffffff?text=Ad+3b",
        ],
        countries: opts.countries?.length ? opts.countries : ["US"],
      },
    ];

    opts.onProgress?.({
      source: this.name,
      phase: "parsing",
      message: `[stub] parsed ${ads.length} ads`,
      count: ads.length,
    });

    const limit = opts.limit ?? ads.length;
    return ads.slice(0, limit);
  }
}
