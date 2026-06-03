import type { Ad } from "./types";
import type { ScanRow } from "./db";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const AD_COLS = [
  "platform",
  "id",
  "advertiser",
  "headline",
  "body",
  "cta",
  "landingUrl",
  "adFormat",
  "isActive",
  "firstSeen",
  "lastSeen",
  "seenAt",
  "sourceUrl",
  "creativeUrls",
] as const;

export function adsToCsv(ads: Ad[]): string {
  const lines = [AD_COLS.join(",")];
  for (const a of ads) {
    lines.push(
      AD_COLS.map((c) => {
        const v = a[c as keyof Ad];
        if (Array.isArray(v)) return esc(v.join(" | "));
        return esc(v);
      }).join(","),
    );
  }
  return lines.join("\n");
}

const LEAD_COLS = [
  "id",
  "created_at",
  "email",
  "company",
  "brand",
  "countries",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "status",
  "result_count",
] as const;

export function leadsToCsv(rows: ScanRow[]): string {
  const lines = [LEAD_COLS.join(",")];
  for (const r of rows) {
    const v: Record<(typeof LEAD_COLS)[number], string> = {
      id: r.id,
      created_at: new Date(r.created_at).toISOString(),
      email: r.email,
      company: r.company ?? "",
      brand: r.brand,
      countries: (() => {
        try {
          const parsed: unknown = JSON.parse(r.countries);
          return Array.isArray(parsed) ? parsed.join(" | ") : "";
        } catch {
          return "";
        }
      })(),
      utm_source: r.utm_source ?? "",
      utm_medium: r.utm_medium ?? "",
      utm_campaign: r.utm_campaign ?? "",
      status: r.status,
      result_count: String(r.result_count),
    };
    lines.push(LEAD_COLS.map((c) => esc(v[c])).join(","));
  }
  return lines.join("\n");
}
