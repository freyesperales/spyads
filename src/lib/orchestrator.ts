import type { Ad, Platform, ProgressEvent, Scraper, ScraperOptions } from "./types";

export interface OrchestratorOptions extends ScraperOptions {
  scrapers: Scraper[];
}

/**
 * Per-source outcome. The UI uses this to show users WHY a scan returned
 * what it did — silent zeros are the #1 cause of "this tool sucks" emails.
 *
 * - `ok`: scraper finished and returned ads (count > 0)
 * - `empty`: scraper finished but found nothing — could be legitimate
 *   (small brand) or anti-bot stealth-block. The hint string explains.
 * - `error`: scraper threw. message is the exception text.
 */
export interface SourceStatus {
  name: Platform | string;
  status: "ok" | "empty" | "error";
  count: number;
  /** Human-readable explanation. ALWAYS populated when status != "ok". */
  message?: string;
  /** Machine-readable hint code for UI to show specific guidance. */
  hint?: "needs_token" | "rate_limited" | "no_results" | "blocked" | "config";
}

export interface OrchestratorResult {
  ads: Ad[];
  sources: SourceStatus[];
  /** @deprecated use `sources` filtered to status==='error' */
  errors: { source: string; message: string }[];
}

/**
 * Run every scraper in parallel via Promise.allSettled.
 *
 * - Forwards each scraper's progress callback through the unified `onProgress`
 *   in `opts` so the SSE layer can broadcast it.
 * - A single scraper failure does NOT kill the run; it's collected in `errors`.
 * - The `limit` from `ScraperOptions` is treated as a soft cap PER scraper
 *   (each scraper enforces its own); the orchestrator also enforces it on
 *   the merged result as a hard cap, in case a scraper overshoots.
 */
export async function runScan(
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { scrapers, onProgress, ...scraperOpts } = opts;
  const errors: { source: string; message: string }[] = [];

  const wrappedProgress = (ev: ProgressEvent): void => {
    try {
      onProgress?.(ev);
    } catch {
      // never let a UI callback take down the orchestrator
    }
  };

  const results = await Promise.allSettled(
    scrapers.map(async (s) => {
      try {
        const ads = await s.scrape({ ...scraperOpts, onProgress: wrappedProgress });
        wrappedProgress({
          source: s.name,
          phase: "complete",
          message: `${s.name} returned ${ads.length} ads`,
          count: ads.length,
        });
        return ads;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        wrappedProgress({
          source: s.name,
          phase: "error",
          message,
        });
        throw new Error(`${s.name}: ${message}`);
      }
    }),
  );

  const ads: Ad[] = [];
  const sources: SourceStatus[] = [];
  results.forEach((res, idx) => {
    const name = scrapers[idx]?.name ?? "unknown";
    if (res.status === "fulfilled") {
      ads.push(...res.value);
      if (res.value.length > 0) {
        sources.push({ name, status: "ok", count: res.value.length });
      } else {
        sources.push({
          name,
          status: "empty",
          count: 0,
          message: emptyMessage(name),
          hint: emptyHint(name),
        });
      }
    } else {
      const msg =
        res.reason instanceof Error ? res.reason.message : String(res.reason);
      errors.push({ source: name, message: msg });
      sources.push({
        name,
        status: "error",
        count: 0,
        message: msg,
        hint: hintFromError(name, msg),
      });
    }
  });

  const limit = opts.limit ?? 0;
  const capped = limit > 0 ? ads.slice(0, limit) : ads;
  return { ads: capped, sources, errors };
}

// --- diagnostic helpers ----------------------------------------------------

/**
 * Pick the message we show when a scraper returns zero ads without
 * throwing. The most common case is "no token / anti-bot block" rather
 * than "this brand truly has no public ads", so we lead with that.
 */
function emptyMessage(name: string): string {
  if (name === "meta") {
    if (!process.env.META_ACCESS_TOKEN) {
      return (
        "Meta returned 0 ads. Without a Graph API token, Meta's anti-bot " +
        "defences usually block web scraping silently. Set META_ACCESS_TOKEN " +
        "for reliable results — Meta provides it free under DSA transparency."
      );
    }
    return (
      "Meta returned 0 ads for this brand. Try a broader country selection " +
      "or check the brand name spelling on facebook.com/ads/library."
    );
  }
  if (name === "google") {
    return (
      "Google Ad Transparency returned 0 ads. Either this brand isn't " +
      "running disclosed ads in your region, or Google's anti-bot challenge " +
      "stopped us silently. Try again in a few minutes."
    );
  }
  return "No ads found.";
}

/**
 * Same logic as `hintFromError` but for the empty-but-no-error case.
 * Meta returning empty without a token is the single most common failure
 * mode and the only one with a user-actionable fix.
 */

function emptyHint(name: string): SourceStatus["hint"] {
  if (name === "meta" && !process.env.META_ACCESS_TOKEN) return "needs_token";
  return "no_results";
}

function hintFromError(name: string, msg: string): SourceStatus["hint"] {
  const m = msg.toLowerCase();
  // Meta errors when no token is set are almost always anti-bot challenges
  // (403/401/captcha walls). The user-facing fix is "get a token", not
  // "we'll retry". Bias the hint toward needs_token so the UI shows the
  // actionable callout instead of a vague "blocked" badge.
  if (name === "meta" && !process.env.META_ACCESS_TOKEN) {
    return "needs_token";
  }
  if (m.includes("rate") || m.includes("429") || m.includes("unusual"))
    return "rate_limited";
  if (m.includes("block") || m.includes("captcha") || m.includes("403"))
    return "blocked";
  if (m.includes("missing") && m.includes("token")) return "needs_token";
  if (name === "google" && m.includes("executable doesn't exist")) return "config";
  return "blocked";
}
