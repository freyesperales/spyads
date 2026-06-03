/**
 * Meta (Facebook + Instagram) Ad Library scraper.
 *
 * Two paths:
 *   1. Graph API — `https://graph.facebook.com/v18.0/ads_archive`.
 *      Official, structured, but requires an access token AND most fields
 *      are only populated for political/issue ads or EU advertisers (DSA).
 *   2. Public web search — `https://www.facebook.com/ads/library/async/search_ads/`.
 *      No auth. Returns HTML with embedded JSON. Default for public web tool.
 *
 * Decision: if `accessToken` is set AND `preferApi !== false`, use API.
 * Otherwise scrape. This keeps the lead-magnet shipping path zero-config
 * while letting power users plug their token in for richer data.
 */

import * as cheerio from "cheerio";
import type {
  Ad,
  AdFormat,
  ProgressEvent,
  Scraper,
  ScraperOptions,
} from "../lib/types.js";

export interface MetaScraperOptions {
  /** Graph API token. When set + preferApi, uses official API. */
  accessToken?: string;
  /** Default true — prefer API when a token is available. */
  preferApi?: boolean;
  /** Minimum delay between page requests (ms). Default 1000. */
  minDelayMs?: number;
  /** Override fetch — handy for tests. */
  fetchImpl?: typeof fetch;
}

interface GraphImpressions {
  lower_bound?: string;
  upper_bound?: string;
}

interface GraphSpend {
  lower_bound?: string;
  upper_bound?: string;
}

interface GraphAd {
  id?: string;
  page_name?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_link_titles?: string[];
  ad_creative_bodies?: string[];
  ad_snapshot_url?: string;
  impressions?: GraphImpressions;
  spend?: GraphSpend;
  currency?: string;
  ad_reached_countries?: string[];
}

interface GraphPaging {
  next?: string;
}

interface GraphResponse {
  data?: GraphAd[];
  paging?: GraphPaging;
}

interface ScrapedAdLike {
  id?: string | number;
  ad_archive_id?: string | number;
  page_name?: string;
  page?: { name?: string };
  advertiser?: string;
  start_date?: string | number;
  end_date?: string | number;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  is_active?: boolean;
  title?: string;
  body?: string | { text?: string };
  link_url?: string;
  landing_url?: string;
  snapshot_url?: string;
  ad_snapshot_url?: string;
  images?: string[];
  videos?: string[];
  countries?: string[];
}

const GRAPH_URL = "https://graph.facebook.com/v18.0/ads_archive";
const SEARCH_URL = "https://www.facebook.com/ads/library/async/search_ads/";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 " +
  "spyads/0.1 (+https://github.com/freyesperales/spyads)";

const GRAPH_FIELDS = [
  "id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_link_titles",
  "ad_creative_bodies",
  "ad_snapshot_url",
  "impressions",
  "spend",
  "currency",
  "ad_reached_countries",
].join(",");

export class MetaScraper implements Scraper {
  readonly name = "meta" as const;

  private readonly accessToken?: string;
  private readonly preferApi: boolean;
  private readonly minDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaScraperOptions = {}) {
    this.accessToken = options.accessToken;
    this.preferApi = options.preferApi ?? true;
    this.minDelayMs = options.minDelayMs ?? 1000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async scrape(options: ScraperOptions): Promise<Ad[]> {
    const emit = (
      phase: ProgressEvent["phase"],
      message: string,
      count?: number,
    ): void => {
      options.onProgress?.({ source: "meta", phase, message, count });
    };

    emit("starting", `Starting Meta scan for "${options.brand}"`);

    const useApi = this.preferApi && !!this.accessToken;
    try {
      const ads = useApi
        ? await this._scrapeViaApi(options, emit)
        : await this._scrapeViaWeb(options, emit);
      emit("complete", `Meta scan complete (${ads.length} ads)`, ads.length);
      return ads;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit("error", `Meta scan failed: ${msg}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // API path
  // -----------------------------------------------------------------------

  private async _scrapeViaApi(
    options: ScraperOptions,
    emit: (
      phase: ProgressEvent["phase"],
      message: string,
      count?: number,
    ) => void,
  ): Promise<Ad[]> {
    const token = this.accessToken;
    if (!token) {
      // Shouldn't happen — gated above — but be defensive.
      return [];
    }

    const limit = options.limit ?? 100;
    const perPage = Math.min(limit, 50);

    const params = new URLSearchParams();
    params.set("search_terms", options.brand);
    params.set("ad_active_status", "ALL");
    params.set("ad_type", "ALL");
    params.set("fields", GRAPH_FIELDS);
    params.set("limit", String(perPage));
    params.set("access_token", token);

    if (options.countries && options.countries.length > 0) {
      params.set("ad_reached_countries", options.countries.join(","));
    }
    if (typeof options.sinceDays === "number" && options.sinceDays > 0) {
      const since = new Date(
        Date.now() - options.sinceDays * 24 * 60 * 60 * 1000,
      );
      params.set("ad_delivery_date_min", since.toISOString().slice(0, 10));
    }

    let url: string | null = `${GRAPH_URL}?${params.toString()}`;
    const ads: Ad[] = [];
    let page = 0;

    while (url && ads.length < limit) {
      page += 1;
      emit("fetching", `Meta API page ${page}`, ads.length);
      const res = await this._fetchWithRetry(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Meta Graph API ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as GraphResponse;
      emit("parsing", `Meta API page ${page} parsing`, ads.length);
      const batch = (json.data ?? []).map((raw) => this._mapGraphAd(raw));
      for (const ad of batch) {
        if (ads.length >= limit) break;
        ads.push(ad);
      }

      url = json.paging?.next ?? null;
      if (url && ads.length < limit) {
        await this._delay(this.minDelayMs);
      }
    }

    return ads;
  }

  private _mapGraphAd(raw: GraphAd): Ad {
    const headline = raw.ad_creative_link_titles?.[0];
    const body = raw.ad_creative_bodies?.[0];
    const firstSeen = this._safeIso(raw.ad_delivery_start_time);
    const lastSeen = this._safeIso(raw.ad_delivery_stop_time);

    const adFormat: AdFormat = this._inferFormat(
      raw.ad_creative_link_titles,
      raw.ad_snapshot_url,
    );

    const id =
      raw.id ?? `${raw.page_name ?? "unknown"}-${raw.ad_snapshot_url ?? ""}`;

    const impressionsLow = this._safeInt(raw.impressions?.lower_bound);
    const impressionsHigh = this._safeInt(raw.impressions?.upper_bound);
    const spendLow = this._safeNumber(raw.spend?.lower_bound);
    const spendHigh = this._safeNumber(raw.spend?.upper_bound);

    let isActive: boolean | undefined;
    if (firstSeen && !lastSeen) isActive = true;
    else if (lastSeen) isActive = false;

    return {
      id: String(id),
      platform: "meta",
      advertiser: raw.page_name ?? "Unknown",
      seenAt: new Date().toISOString(),
      firstSeen,
      lastSeen,
      isActive,
      headline,
      body,
      sourceUrl: raw.ad_snapshot_url,
      impressionsLow,
      impressionsHigh,
      spendLow,
      spendHigh,
      currency: raw.currency,
      countries: raw.ad_reached_countries,
      adFormat,
    };
  }

  // -----------------------------------------------------------------------
  // Scrape path
  // -----------------------------------------------------------------------

  private async _scrapeViaWeb(
    options: ScraperOptions,
    emit: (
      phase: ProgressEvent["phase"],
      message: string,
      count?: number,
    ) => void,
  ): Promise<Ad[]> {
    const limit = options.limit ?? 100;
    const country = options.countries?.[0] ?? "ALL";

    const params = new URLSearchParams();
    params.set("q", options.brand);
    params.set("ad_type", "all");
    params.set("active_status", "all");
    params.set("country", country);
    if (options.countries && options.countries.length > 0) {
      params.set("countries", options.countries.join(","));
    }

    const url = `${SEARCH_URL}?${params.toString()}`;
    emit("fetching", `Meta web search for "${options.brand}"`);
    const res = await this._fetchWithRetry(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!res.ok) {
      throw new Error(`Meta web ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    emit("parsing", "Meta web response parsing");

    const raw = this._extractAds(html);
    const ads = raw
      .map((r) => this._mapScrapedAd(r))
      .filter((a): a is Ad => a !== null);
    return ads.slice(0, limit);
  }

  /**
   * Extracts the ads array from a Meta Ad Library async-search HTML response.
   *
   * Meta embeds JSON in inline <script> tags. The exact shape changes,
   * so we hunt for any array of objects that look like ads (has either
   * `ad_archive_id` or a page/start-date combo).
   *
   * Isolated here so future markup churn touches one function.
   */
  _extractAds(html: string): ScrapedAdLike[] {
    const $ = cheerio.load(html);
    const scripts: string[] = [];
    $("script").each((_, el) => {
      const content = $(el).contents().text();
      if (content) scripts.push(content);
    });
    scripts.push(html); // also scan raw HTML — sometimes JSON sits outside <script>

    const found: ScrapedAdLike[] = [];
    const seenIds = new Set<string>();

    for (const blob of scripts) {
      // Strategy 1: look for "ad_archive_id":"123..." patterns and pull the
      // smallest enclosing JSON object.
      const reArchive = /"ad_archive_id"\s*:\s*"?(\d+)"?/g;
      let m: RegExpExecArray | null;
      while ((m = reArchive.exec(blob)) !== null) {
        const obj = this._extractEnclosingObject(blob, m.index);
        if (!obj) continue;
        try {
          const parsed = JSON.parse(obj) as ScrapedAdLike;
          const id = String(parsed.ad_archive_id ?? parsed.id ?? "");
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            found.push(parsed);
          }
        } catch {
          // not valid JSON — skip
        }
      }

      // Strategy 2: top-level "results":[...] arrays.
      const reResults = /"results"\s*:\s*(\[)/g;
      while ((m = reResults.exec(blob)) !== null) {
        const arr = this._extractEnclosingArray(blob, m.index + m[0].length - 1);
        if (!arr) continue;
        try {
          const parsed = JSON.parse(arr) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === "object") {
                const ad = item as ScrapedAdLike;
                const id = String(ad.ad_archive_id ?? ad.id ?? "");
                if (id && !seenIds.has(id)) {
                  seenIds.add(id);
                  found.push(ad);
                }
              }
            }
          }
        } catch {
          // skip
        }
      }
    }

    if (found.length === 0) {
      console.warn(
        "[meta] _extractAds: no ads found in HTML response — Meta markup may have changed",
      );
    }

    return found;
  }

  private _extractEnclosingObject(s: string, anchor: number): string | null {
    // Walk left until we find the matching '{' that opens the object the
    // anchor sits inside, then walk right to its matching '}'.
    let depth = 0;
    let start = -1;
    for (let i = anchor; i >= 0; i--) {
      const ch = s[i];
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth -= 1;
      }
    }
    if (start < 0) return null;

    depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  }

  private _extractEnclosingArray(s: string, openIdx: number): string | null {
    if (s[openIdx] !== "[") return null;
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      const ch = s[i];
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) return s.slice(openIdx, i + 1);
      }
    }
    return null;
  }

  private _mapScrapedAd(raw: ScrapedAdLike): Ad | null {
    const id = raw.ad_archive_id ?? raw.id;
    if (id === undefined || id === null) return null;

    const advertiser =
      raw.advertiser ?? raw.page_name ?? raw.page?.name ?? "Unknown";

    const firstSeen =
      this._safeIso(raw.ad_delivery_start_time) ??
      this._epochToIso(raw.start_date);
    const lastSeen =
      this._safeIso(raw.ad_delivery_stop_time) ??
      this._epochToIso(raw.end_date);

    const bodyText =
      typeof raw.body === "string" ? raw.body : raw.body?.text ?? undefined;

    const sourceUrl = raw.snapshot_url ?? raw.ad_snapshot_url;
    const landingUrl = raw.link_url ?? raw.landing_url;

    const creativeUrls: string[] = [];
    if (Array.isArray(raw.images)) creativeUrls.push(...raw.images);
    if (Array.isArray(raw.videos)) creativeUrls.push(...raw.videos);

    let adFormat: AdFormat = "unknown";
    if (Array.isArray(raw.videos) && raw.videos.length > 0) adFormat = "video";
    else if (Array.isArray(raw.images) && raw.images.length > 1)
      adFormat = "carousel";
    else if (Array.isArray(raw.images) && raw.images.length === 1)
      adFormat = "image";

    let isActive: boolean | undefined = raw.is_active;
    if (isActive === undefined) {
      if (firstSeen && !lastSeen) isActive = true;
      else if (lastSeen) isActive = false;
    }

    return {
      id: String(id),
      platform: "meta",
      advertiser,
      seenAt: new Date().toISOString(),
      firstSeen,
      lastSeen,
      isActive,
      headline: raw.title,
      body: bodyText,
      landingUrl,
      sourceUrl,
      creativeUrls: creativeUrls.length > 0 ? creativeUrls.slice(0, 5) : undefined,
      adFormat,
      countries: raw.countries,
    };
  }

  // -----------------------------------------------------------------------
  // HTTP + helpers
  // -----------------------------------------------------------------------

  private async _fetchWithRetry(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const maxAttempts = 4; // 1 try + 3 retries
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, init);
        if (res.status === 429 && attempt < maxAttempts) {
          const backoff = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s
          console.warn(
            `[meta] 429 received, backing off ${backoff}ms (attempt ${attempt}/${maxAttempts})`,
          );
          await this._delay(backoff);
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxAttempts) break;
        const backoff = 1000 * Math.pow(2, attempt);
        console.error(
          `[meta] fetch error (attempt ${attempt}/${maxAttempts}): ${
            err instanceof Error ? err.message : String(err)
          } — retrying in ${backoff}ms`,
        );
        await this._delay(backoff);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Meta fetch failed after retries");
  }

  private _delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _safeIso(input: string | undefined): string | undefined {
    if (!input) return undefined;
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  private _epochToIso(
    input: string | number | undefined,
  ): string | undefined {
    if (input === undefined || input === null || input === "") return undefined;
    const n = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(n)) return undefined;
    // Meta epoch fields are usually seconds, not ms.
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  private _safeInt(input: string | undefined): number | undefined {
    if (input === undefined) return undefined;
    const n = parseInt(input, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  private _safeNumber(input: string | undefined): number | undefined {
    if (input === undefined) return undefined;
    const n = Number(input);
    return Number.isFinite(n) ? n : undefined;
  }

  private _inferFormat(
    titles: string[] | undefined,
    snapshotUrl: string | undefined,
  ): AdFormat {
    if (titles && titles.length > 1) return "carousel";
    if (snapshotUrl && /video/i.test(snapshotUrl)) return "video";
    if (titles && titles.length === 1) return "image";
    return "unknown";
  }
}
