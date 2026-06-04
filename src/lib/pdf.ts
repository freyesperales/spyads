/**
 * PDF generation for completed scans.
 *
 * Strategy: reuse the Playwright browser we already pull in for the
 * Google scraper. Open `${SITE_URL}/scan/[id]?pdf=1` (the page renders
 * a print-friendly variant when ?pdf=1 is present), then `page.pdf()`.
 *
 * Why not @react-pdf/renderer? It would require a separate template
 * tree and we'd quickly drift from the on-screen report. The whole
 * point of this PDF is "the same thing the user saw, downloadable".
 *
 * Why not Puppeteer? Playwright is already in our dep tree from the
 * Google scraper. One less moving part.
 */

import { chromium, type Browser } from "playwright";

let cached: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cached && cached.isConnected()) return cached;
  cached = await chromium.launch({ headless: true });
  return cached;
}

/**
 * Render `/scan/<scanId>` (against the running app) to a PDF buffer.
 * Caller is responsible for providing a `siteUrl` that's reachable
 * from this process — usually `http://127.0.0.1:3000` when self-hosted
 * on the same VM, or the public URL when running in a worker elsewhere.
 */
export async function renderScanPdf(
  scanId: string,
  siteUrl: string,
): Promise<Buffer> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 1400 },
    // Match the headless UA so any analytics see this as a server-side hit.
    userAgent: "spyads-pdf/0.1",
  });
  const page = await ctx.newPage();
  try {
    const url = new URL(`/scan/${scanId}`, siteUrl);
    url.searchParams.set("pdf", "1");
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 60_000 });
    // Wait briefly for any client-side hydration to settle.
    await page.waitForTimeout(500);
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return buf;
  } finally {
    await ctx.close();
  }
}

/** Allow the runner to dispose the cached browser cleanly on shutdown. */
export async function disposePdfBrowser(): Promise<void> {
  if (cached) {
    try {
      await cached.close();
    } catch {
      // best-effort
    }
    cached = null;
  }
}
