import { completeScan, failScan } from "./db";
import { emit } from "./events";
import { runScan } from "./orchestrator";
import { loadScrapers } from "../scrapers";
import type { CreateScanInput } from "./schemas";

/**
 * Fire-and-forget background scan. Persists results when done and emits
 * all progress events to the in-memory bus for the SSE route.
 */
export function launchScan(scanId: string, input: CreateScanInput): void {
  void (async () => {
    try {
      const scrapers = await loadScrapers();
      const result = await runScan({
        brand: input.brand,
        countries: input.countries,
        limit: 60,
        sinceDays: 30,
        scrapers,
        onProgress: (ev) => emit(scanId, { kind: "progress", data: ev }),
      });
      completeScan(scanId, JSON.stringify(result.ads), result.ads.length);
      emit(scanId, { kind: "done", data: { resultCount: result.ads.length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failScan(scanId, message);
      emit(scanId, { kind: "error", data: { message } });
    }
  })();
}
