/**
 * Shared types. Every scraper produces `Ad[]`; the UI consumes `Ad[]`;
 * SQLite persists `Ad[]` as JSON in a single column.
 *
 * This file is the SOURCE OF TRUTH for the schema. If a scraper needs an
 * extra field, add it here first (Optional with a sensible default) so
 * downstream UI and DB don't break.
 */

export type Platform = "meta" | "google" | "tiktok" | "linkedin";

export type AdFormat = "image" | "video" | "carousel" | "text" | "unknown";

export interface Ad {
  /** Platform-native ad ID. Unique within a platform. */
  id: string;
  platform: Platform;
  /** Advertiser / page name as the platform displays it. */
  advertiser: string;
  /** When THIS run saw the ad — ISO 8601. */
  seenAt: string;

  // Strongly recommended
  /** "Started running" date per the platform — ISO date. */
  firstSeen?: string;
  /** "Stopped running" date per the platform — ISO date. */
  lastSeen?: string;
  /** Platform reports this ad as currently delivering. */
  isActive?: boolean;

  // Creative
  headline?: string;
  body?: string;
  cta?: string;
  landingUrl?: string;
  /** URLs of images / videos. Limit to ~3 in UI to avoid heavy pages. */
  creativeUrls?: string[];
  adFormat?: AdFormat;

  // Reach / spend (rare; only present for political/issue ads in most countries)
  impressionsLow?: number;
  impressionsHigh?: number;
  spendLow?: number;
  spendHigh?: number;
  /** ISO 4217. */
  currency?: string;

  // Targeting (rare; usually country only)
  countries?: string[];

  /** Link back to the platform's ad page for verification. */
  sourceUrl?: string;
}

export interface ScraperOptions {
  brand: string;
  /** ISO 3166-1 codes. Empty / undefined = no filter (when supported). */
  countries?: string[];
  /** Soft cap. Scrapers may slightly overshoot to finish a page. */
  limit?: number;
  /** How far back to look — number of days. */
  sinceDays?: number;
  /** Callback for progress UI. Idempotent for repeats. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  source: Platform;
  phase: "starting" | "fetching" | "parsing" | "complete" | "error";
  message: string;
  count?: number;
}

/**
 * Every scraper implements this. The orchestrator runs them in parallel
 * and collates results, catching per-scraper errors so one outage doesn't
 * kill the whole scan.
 */
export interface Scraper {
  /** Short identifier — also used as `platform` value on emitted Ads. */
  readonly name: Platform;
  scrape(options: ScraperOptions): Promise<Ad[]>;
}

/** Stored lead row — populated when a visitor submits the scan form. */
export interface Lead {
  id: string;
  email: string;
  company?: string;
  brand: string;
  countries?: string[];
  /** Source UTM (e.g. "twitter", "linkedin", "direct"). */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** How many ads were found for this scan. */
  resultCount: number;
  createdAt: string;
  /** Stored as JSON for export — full Ads list for the lead's scan. */
  resultsJson: string;
}
