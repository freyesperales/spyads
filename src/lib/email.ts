/**
 * Outbound email via Resend.
 *
 * Resend was picked over classic SMTP because:
 *   - HTTP API in Node — no socket lifecycle, no STARTTLS dance
 *   - Free tier 3,000/mo + 100/day, sufficient for a lead-magnet launch
 *   - Domain verification is a one-time DNS step (SPF/DKIM auto-generated)
 *
 * If you'd rather swap to SMTP later, this module is the only file you
 * need to rewrite — the rest of the app only calls `sendScanReport()`.
 */

import { Resend } from "resend";

interface ResendError {
  name?: string;
  message?: string;
  statusCode?: number;
}

interface SendOptions {
  to: string;
  brand: string;
  scanId: string;
  resultCount: number;
  reportUrl: string;
  pdf?: Buffer;
}

/**
 * Send the "your report is ready" email. Returns true on success.
 * On failure: logs + returns false — we never throw, because email
 * shouldn't ever crash the scan pipeline.
 */
export async function sendScanReport(opts: SendOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      "[email] RESEND_API_KEY or EMAIL_FROM not set — skipping send for",
      opts.to,
    );
    return false;
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: `Your spyads report for "${opts.brand}" is ready`,
      html: renderEmailHtml(opts),
      text: renderEmailText(opts),
      attachments: opts.pdf
        ? [
            {
              filename: filenameForBrand(opts.brand),
              content: opts.pdf,
            },
          ]
        : undefined,
    });

    if (error) {
      const e = error as ResendError;
      console.error("[email] Resend rejected:", e.name, e.message);
      return false;
    }
    console.info("[email] sent id=%s to=%s", data?.id, opts.to);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] threw:", message);
    return false;
  }
}

function filenameForBrand(brand: string): string {
  // Strip filesystem-unfriendly chars; keep it short.
  const safe = brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `spyads-${safe || "report"}.pdf`;
}

function renderEmailHtml(opts: SendOptions): string {
  const safeBrand = escapeHtml(opts.brand);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>spyads report</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#1a1a1a;background:#f7f7f7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;border:1px solid #e5e5e5;">
    <h1 style="margin:0 0 6px;font-size:22px;">Your spyads report is ready</h1>
    <p style="color:#666;margin:0 0 18px;">${opts.resultCount} ad${opts.resultCount === 1 ? "" : "s"} found for <b>${safeBrand}</b>.</p>
    <p style="margin:0 0 18px;">The full PDF report is attached. You can also view it live:</p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(opts.reportUrl)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">View report online</a>
    </p>
    <p style="color:#888;font-size:13px;border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;">
      You're receiving this because you ran a scan on spyads. We never share your email.
      <br>
      <a href="${escapeHtml(opts.reportUrl)}" style="color:#888;">${escapeHtml(opts.reportUrl)}</a>
    </p>
  </div>
</body>
</html>`;
}

function renderEmailText(opts: SendOptions): string {
  return (
    `Your spyads report is ready.\n\n` +
    `${opts.resultCount} ad${opts.resultCount === 1 ? "" : "s"} found for "${opts.brand}".\n\n` +
    `The full PDF is attached. View online: ${opts.reportUrl}\n`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
