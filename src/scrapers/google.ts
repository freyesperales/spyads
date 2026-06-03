/**
 * Google Ad Transparency Center scraper (Playwright + DOM).
 *
 * URL: https://adstransparency.google.com/
 *
 * MAINTENANCE NOTES
 * -----------------
 * Google has no public API; the internal endpoints are GRPC-Web binary
 * protobuf, so we scrape the rendered DOM. **Google reshuffles class names
 * and section labels frequently.** When this scraper breaks, the culprit is
 * almost always one of the strings in `SELECTORS` below — patch there first
 * before touching the navigation flow.
 *
 * Order of fragility (most → least likely to break):
 *   1. `adCard` — Google rotates the URL fragment scheme (creative_id=, /ad/, etc.)
 *   2. `formatChip`, `firstShownLabel`, `lastShownLabel`, `regionsLabel` — labels
 *      can be re-translated or moved into an "info" sidebar.
 *   3. `rateLimitMarker` — wording changes per locale.
 *   4. `advertiserLink` — the most stable, but the path could change from
 *      `/advertiser/` to e.g. `/profile/`.
 *
 * Politeness: a `minDelayMs` gate sits between every page nav. Default 2s.
 * Per-advertiser scan typically takes 15–30s depending on `limit`.
 *
 * NOT YET IMPLEMENTED (v0.2):
 *   - Iterating multiple `countries` (we use the first one only).
 *   - Logged-in scraping for full political-ad spend ranges.
 *   - Variation extraction (an ad with multiple creatives).
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Ad, Scraper, ScraperOptions } from "../lib/types";
import { buildAd, type RawGoogleAd } from "./google_parser";

export interface GoogleScraperOptions {
  /** Reuse a long-lived browser across calls. Recommended in long-running servers. */
  browser?: Browser;
  /** Headless. Default true. */
  headless?: boolean;
  /** Politeness delay between page navigations (ms). Default 2000. */
  minDelayMs?: number;
  /** Per-page navigation timeout (ms). Default 30000. */
  timeoutMs?: number;
}

/** Thrown when Google shows a rate-limit / anti-bot interstitial. */
export class GoogleRateLimitedError extends Error {
  constructor(message = "Google Ad Transparency Center rate-limited the scraper") {
    super(message);
    this.name = "GoogleRateLimitedError";
  }
}

/**
 * Single source of truth for DOM selectors. **Patch here first** when the UI
 * changes — every other function reads through this object.
 */
const SELECTORS = {
  advertiserLink: 'a[href*="/advertiser/"]',
  advertiserHeader: 'h1, [role="heading"][aria-level="1"]',
  adCard: 'a[href*="creative_id="]',
  formatChip: '[class*="format"], [aria-label*="format" i]',
  firstShownLabel: 'text=/first shown/i',
  lastShownLabel: 'text=/last shown/i',
  regionsLabel: 'text=/region|countries/i',
  creativeImage: 'img[src]',
  creativeVideo: 'video source, video[src]',
  landingLink: 'a[href^="http"]:not([href*="adstransparency.google.com"])',
  rateLimitMarker: 'text=/unusual traffic|verify you|are you a robot/i',
} as const;

const DEFAULT_HEADLESS = true;
const DEFAULT_MIN_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export class GoogleScraper implements Scraper {
  readonly name = "google" as const;

  private readonly externalBrowser: Browser | undefined;
  private readonly headless: boolean;
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;

  private ownedBrowser: Browser | undefined;

  constructor(options?: GoogleScraperOptions) {
    this.externalBrowser = options?.browser;
    this.headless = options?.headless ?? DEFAULT_HEADLESS;
    this.minDelayMs = options?.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async scrape(options: ScraperOptions): Promise<Ad[]> {
    const { brand, countries, limit = 25, onProgress } = options;

    onProgress?.({
      source: "google",
      phase: "starting",
      message: `Google ATC scan for "${brand}"`,
    });

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      const region = countries?.[0];
      const searchUrl = buildSearchUrl(brand, region);

      onProgress?.({
        source: "google",
        phase: "fetching",
        message: `Loading search results${region ? ` (region ${region})` : ""}`,
      });

      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      await this.guardRateLimit(page);

      // Wait for at least one advertiser link to appear.
      try {
        await page.waitForSelector(SELECTORS.advertiserLink, {
          timeout: this.timeoutMs,
        });
      } catch {
        onProgress?.({
          source: "google",
          phase: "complete",
          message: `No advertisers found for "${brand}"`,
          count: 0,
        });
        return [];
      }

      // Open the first advertiser profile.
      const firstAdvertiserHref = await page
        .locator(SELECTORS.advertiserLink)
        .first()
        .getAttribute("href");

      if (!firstAdvertiserHref) {
        onProgress?.({
          source: "google",
          phase: "complete",
          message: `No advertiser link found`,
          count: 0,
        });
        return [];
      }

      const advertiserUrl = new URL(firstAdvertiserHref, "https://adstransparency.google.com")
        .toString();

      await this.delay();
      await page.goto(advertiserUrl, { waitUntil: "domcontentloaded" });
      await this.guardRateLimit(page);

      const advertiserName = await this.readAdvertiserName(page, brand);

      onProgress?.({
        source: "google",
        phase: "fetching",
        message: `Loading ads for "${advertiserName}"`,
      });

      // Scroll-load until we have `limit` cards or growth stops.
      const cardHrefs = await this.collectAdCardHrefs(page, limit);

      onProgress?.({
        source: "google",
        phase: "parsing",
        message: `Found ${cardHrefs.length} ad cards — extracting`,
        count: cardHrefs.length,
      });

      const ads: Ad[] = [];
      for (let i = 0; i < cardHrefs.length && ads.length < limit; i++) {
        const href = cardHrefs[i];
        if (!href) continue;
        try {
          await this.delay();
          const detailUrl = new URL(href, "https://adstransparency.google.com").toString();
          const raw = await this.scrapeAdDetail(page, detailUrl, advertiserName);
          if (raw) {
            ads.push(buildAd(raw));
            if (ads.length % 5 === 0) {
              onProgress?.({
                source: "google",
                phase: "parsing",
                message: `Parsed ${ads.length}/${cardHrefs.length}`,
                count: ads.length,
              });
            }
          }
        } catch (err) {
          if (err instanceof GoogleRateLimitedError) throw err;
          console.warn(`[google] Failed to scrape ad ${href}:`, err);
        }
      }

      onProgress?.({
        source: "google",
        phase: "complete",
        message: `Scraped ${ads.length} ads`,
        count: ads.length,
      });

      return ads;
    } finally {
      await context.close().catch((err: unknown) => {
        console.warn("[google] context.close failed:", err);
      });
    }
  }

  async close(): Promise<void> {
    if (this.ownedBrowser) {
      await this.ownedBrowser.close().catch((err: unknown) => {
        console.warn("[google] browser.close failed:", err);
      });
      this.ownedBrowser = undefined;
    }
  }

  // --- internals ------------------------------------------------------------

  private async getBrowser(): Promise<Browser> {
    if (this.externalBrowser) return this.externalBrowser;
    if (!this.ownedBrowser) {
      this.ownedBrowser = await chromium.launch({ headless: this.headless });
    }
    return this.ownedBrowser;
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.minDelayMs));
  }

  private async guardRateLimit(page: Page): Promise<void> {
    const marker = page.locator(SELECTORS.rateLimitMarker);
    if (await marker.count()) {
      throw new GoogleRateLimitedError();
    }
  }

  private async readAdvertiserName(page: Page, fallback: string): Promise<string> {
    try {
      const header = page.locator(SELECTORS.advertiserHeader).first();
      const text = (await header.textContent({ timeout: 5000 }))?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Repeatedly scroll the advertiser ads grid until we have `limit` distinct
   * card hrefs or three consecutive scrolls fail to add anything.
   */
  private async collectAdCardHrefs(page: Page, limit: number): Promise<string[]> {
    const seen = new Set<string>();
    let stalledScrolls = 0;

    for (let pass = 0; pass < 30; pass++) {
      const hrefs = await page
        .locator(SELECTORS.adCard)
        .evaluateAll((nodes) =>
          nodes
            .map((n) => (n instanceof HTMLAnchorElement ? n.href : null))
            .filter((h): h is string => typeof h === "string" && h.length > 0),
        );

      const before = seen.size;
      for (const h of hrefs) seen.add(h);

      if (seen.size >= limit) break;
      if (seen.size === before) {
        stalledScrolls++;
        if (stalledScrolls >= 3) break;
      } else {
        stalledScrolls = 0;
      }

      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(750);
    }

    return Array.from(seen).slice(0, limit);
  }

  /**
   * Navigate to an ad's detail page and harvest raw fields. Returns null if
   * we can't even extract a creative_id.
   */
  private async scrapeAdDetail(
    page: Page,
    detailUrl: string,
    advertiser: string,
  ): Promise<RawGoogleAd | null> {
    await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
    await this.guardRateLimit(page);

    const id = extractCreativeId(detailUrl);
    if (!id) return null;

    const formatChip = await safeText(page, SELECTORS.formatChip);
    const firstShownRaw = await readLabeledValue(page, SELECTORS.firstShownLabel);
    const lastShownRaw = await readLabeledValue(page, SELECTORS.lastShownLabel);
    const regionsRaw = await readLabeledValue(page, SELECTORS.regionsLabel);

    const creativeUrl =
      (await safeAttr(page, SELECTORS.creativeVideo, "src")) ??
      (await safeAttr(page, SELECTORS.creativeImage, "src"));

    const landingUrl = await safeAttr(page, SELECTORS.landingLink, "href");

    const raw: RawGoogleAd = {
      id,
      advertiser,
      sourceUrl: detailUrl,
    };
    if (formatChip) raw.formatChip = formatChip;
    if (firstShownRaw) raw.firstShownRaw = firstShownRaw;
    if (lastShownRaw) raw.lastShownRaw = lastShownRaw;
    if (regionsRaw) raw.regionsRaw = regionsRaw;
    if (creativeUrl) raw.creativeUrl = creativeUrl;
    if (landingUrl) raw.landingUrl = landingUrl;

    return raw;
  }
}

// --- module-level helpers ---------------------------------------------------

function buildSearchUrl(brand: string, region: string | undefined): string {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  params.set("q", brand);
  return `https://adstransparency.google.com/?${params.toString()}`;
}

function extractCreativeId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("creative_id");
    return id ?? undefined;
  } catch {
    return undefined;
  }
}

async function safeText(page: Page, selector: string): Promise<string | undefined> {
  try {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) return undefined;
    const t = (await loc.textContent({ timeout: 2000 }))?.trim();
    return t && t.length > 0 ? t : undefined;
  } catch (err) {
    console.warn(`[google] safeText("${selector}") failed:`, err);
    return undefined;
  }
}

async function safeAttr(
  page: Page,
  selector: string,
  attr: string,
): Promise<string | undefined> {
  try {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) return undefined;
    const v = await loc.getAttribute(attr, { timeout: 2000 });
    return v && v.length > 0 ? v : undefined;
  } catch (err) {
    console.warn(`[google] safeAttr("${selector}", "${attr}") failed:`, err);
    return undefined;
  }
}

/**
 * Locate a label cell (e.g. "First shown") and read the sibling/following
 * text node that holds the value. Google's ad detail panel uses several
 * layouts, so we try a couple of strategies.
 */
async function readLabeledValue(page: Page, labelSelector: string): Promise<string | undefined> {
  try {
    const label = page.locator(labelSelector).first();
    if (!(await label.count())) return undefined;

    // Strategy 1: parent block contains both label + value; strip the label.
    const parentText = await label
      .locator("xpath=..")
      .first()
      .textContent({ timeout: 2000 });
    if (parentText) {
      const labelText = (await label.textContent({ timeout: 2000 }))?.trim() ?? "";
      const value = parentText.replace(labelText, "").trim();
      if (value.length > 0) return value;
    }

    // Strategy 2: next sibling.
    const sibling = label.locator("xpath=following-sibling::*[1]");
    if (await sibling.count()) {
      const t = (await sibling.textContent({ timeout: 2000 }))?.trim();
      if (t && t.length > 0) return t;
    }
  } catch (err) {
    console.warn(`[google] readLabeledValue("${labelSelector}") failed:`, err);
  }
  return undefined;
}

// Silence unused-import warning for BrowserContext (referenced via Playwright types).
export type { BrowserContext };
