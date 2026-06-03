import type { Ad, ProgressEvent, Scraper, ScraperOptions } from "./types";

export interface OrchestratorOptions extends ScraperOptions {
  scrapers: Scraper[];
}

export interface OrchestratorResult {
  ads: Ad[];
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
  results.forEach((res, idx) => {
    const name = scrapers[idx]?.name ?? "unknown";
    if (res.status === "fulfilled") {
      ads.push(...res.value);
    } else {
      const msg =
        res.reason instanceof Error ? res.reason.message : String(res.reason);
      errors.push({ source: name, message: msg });
    }
  });

  const limit = opts.limit ?? 0;
  const capped = limit > 0 ? ads.slice(0, limit) : ads;
  return { ads: capped, errors };
}
