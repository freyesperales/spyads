import type { Scraper } from "../lib/types";
import { MetaScraper } from "./meta";
import { GoogleScraper } from "./google";
import { StubScraper } from "./stub";

/**
 * Returns the scrapers the orchestrator will run.
 *
 * Behaviour:
 *
 *   - With `SPYADS_USE_STUBS=1` we return synthetic StubScrapers. Useful
 *     in CI, during landing-page design, or hosts without Chromium.
 *   - Otherwise we run the real Meta + Google scrapers. Google needs
 *     `npx playwright install chromium` once on the host.
 *
 * The orchestrator only depends on the `Scraper` interface, so swapping
 * implementations here is the single integration point.
 */
export async function loadScrapers(): Promise<Scraper[]> {
  if (process.env.SPYADS_USE_STUBS === "1") {
    return [new StubScraper("meta"), new StubScraper("google")];
  }
  return [
    new MetaScraper({
      accessToken: process.env.META_ACCESS_TOKEN,
    }),
    new GoogleScraper({
      headless: true,
    }),
  ];
}
