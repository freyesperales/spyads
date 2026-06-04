import { completeScan, failScan, getScan } from "./db";
import { sendScanReport } from "./email";
import { emit } from "./events";
import { runScan } from "./orchestrator";
import { renderScanPdf } from "./pdf";
import { loadScrapers } from "../scrapers";
import type { CreateScanInput } from "./schemas";

/**
 * Fire-and-forget background scan. Persists results when done and emits
 * all progress events to the in-memory bus for the SSE route. When the
 * scan succeeds, we kick off the email step in another fire-and-forget
 * branch so a slow PDF render doesn't keep the SSE stream open longer
 * than needed.
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

      // Email is best-effort and runs detached.
      void deliverScanEmail(scanId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failScan(scanId, message);
      emit(scanId, { kind: "error", data: { message } });
    }
  })();
}

/**
 * Render PDF + send via Resend. Detached from the scan promise so the
 * UI receives `done` immediately — the email arrives a few seconds later.
 * Failures are logged and surfaced via `event` bus but never break the
 * scan flow (the user already has the on-screen report).
 */
async function deliverScanEmail(scanId: string): Promise<void> {
  const scan = getScan(scanId);
  if (!scan) {
    console.warn("[email] scan not found for delivery:", scanId);
    return;
  }
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://127.0.0.1:3000";
  const reportUrl = new URL(`/scan/${scanId}`, siteUrl).toString();

  let pdf: Buffer | undefined;
  try {
    pdf = await renderScanPdf(scanId, siteUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[email] PDF render failed for %s: %s", scanId, message);
    // Fall through and email a link-only report rather than blocking.
  }

  await sendScanReport({
    to: scan.email,
    brand: scan.brand,
    scanId,
    resultCount: scan.result_count,
    reportUrl,
    pdf,
  });
}
