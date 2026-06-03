/**
 * Pure parsing helpers for Google Ad Transparency Center scraping.
 *
 * No Playwright import here — these are unit-testable in isolation.
 * The DOM-dependent code lives in google.ts.
 */

import type { Ad, AdFormat } from "../lib/types";

/**
 * Minimal country-name → ISO 3166-1 alpha-2 map.
 * Covers the ~30 most common markets in Google's Ad Transparency UI.
 * Unknown names are silently dropped by callers.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  "united states": "US",
  "usa": "US",
  "united kingdom": "GB",
  "uk": "GB",
  "great britain": "GB",
  "canada": "CA",
  "mexico": "MX",
  "brazil": "BR",
  "argentina": "AR",
  "chile": "CL",
  "colombia": "CO",
  "peru": "PE",
  "spain": "ES",
  "portugal": "PT",
  "france": "FR",
  "germany": "DE",
  "italy": "IT",
  "netherlands": "NL",
  "belgium": "BE",
  "switzerland": "CH",
  "austria": "AT",
  "sweden": "SE",
  "norway": "NO",
  "denmark": "DK",
  "finland": "FI",
  "poland": "PL",
  "ireland": "IE",
  "australia": "AU",
  "new zealand": "NZ",
  "japan": "JP",
  "south korea": "KR",
  "china": "CN",
  "india": "IN",
  "singapore": "SG",
  "hong kong": "HK",
  "indonesia": "ID",
  "philippines": "PH",
  "thailand": "TH",
  "vietnam": "VN",
  "malaysia": "MY",
  "turkey": "TR",
  "russia": "RU",
  "ukraine": "UA",
  "south africa": "ZA",
  "egypt": "EG",
  "israel": "IL",
  "united arab emirates": "AE",
  "uae": "AE",
  "saudi arabia": "SA",
};

const MONTH_TO_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Parse a Google ATC date string into ISO date (YYYY-MM-DD).
 *
 * Accepts:
 *   - "Sep 15, 2024"
 *   - "September 15, 2024"
 *   - "15 Sep 2024"
 *   - "Sep 15, 2024 — present" (uses the first date; "present" range collapses
 *     to its start)
 *   - "Sep 15, 2024 - Oct 1, 2024" (uses the first date — pair with parseDate
 *     on the second segment for ranges)
 *
 * Returns undefined for malformed input and emits a console.warn.
 */
export function parseDate(raw: string): string | undefined {
  if (!raw || typeof raw !== "string") {
    console.warn(`[google_parser] parseDate: empty input`);
    return undefined;
  }

  // Strip the "present" / range tail so we always parse the first segment.
  const cleaned = raw
    .split(/[—–-]/u)[0]
    ?.replace(/present/iu, "")
    .trim();

  if (!cleaned) {
    console.warn(`[google_parser] parseDate: blank after cleanup: "${raw}"`);
    return undefined;
  }

  // Pattern 1: "Sep 15, 2024" or "September 15, 2024"
  const usMatch = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/u.exec(cleaned);
  if (usMatch) {
    const [, monRaw, dayRaw, yearRaw] = usMatch;
    return buildIsoDate(monRaw, dayRaw, yearRaw, raw);
  }

  // Pattern 2: "15 Sep 2024" or "15 September 2024"
  const euMatch = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/u.exec(cleaned);
  if (euMatch) {
    const [, dayRaw, monRaw, yearRaw] = euMatch;
    return buildIsoDate(monRaw, dayRaw, yearRaw, raw);
  }

  // Pattern 3: ISO-ish "2024-09-15"
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(cleaned);
  if (isoMatch) {
    return cleaned;
  }

  console.warn(`[google_parser] parseDate: unrecognized format "${raw}"`);
  return undefined;
}

function buildIsoDate(
  monRaw: string | undefined,
  dayRaw: string | undefined,
  yearRaw: string | undefined,
  original: string,
): string | undefined {
  if (!monRaw || !dayRaw || !yearRaw) {
    console.warn(`[google_parser] parseDate: missing segment in "${original}"`);
    return undefined;
  }
  const monthIdx = MONTH_TO_INDEX[monRaw.toLowerCase()];
  if (monthIdx === undefined) {
    console.warn(`[google_parser] parseDate: unknown month "${monRaw}" in "${original}"`);
    return undefined;
  }
  const day = Number.parseInt(dayRaw, 10);
  const year = Number.parseInt(yearRaw, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    console.warn(`[google_parser] parseDate: invalid day "${dayRaw}" in "${original}"`);
    return undefined;
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    console.warn(`[google_parser] parseDate: implausible year "${yearRaw}" in "${original}"`);
    return undefined;
  }
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Map a Google "format" chip label to our normalized AdFormat union.
 * Unknown labels become "unknown" (not an error).
 */
export function parseFormat(chip: string): AdFormat {
  if (!chip || typeof chip !== "string") return "unknown";
  const normalized = chip.trim().toLowerCase();
  if (!normalized) return "unknown";

  if (/^image$/u.test(normalized) || normalized.includes("image")) return "image";
  if (/^video$/u.test(normalized) || normalized.includes("video")) return "video";
  if (/^text$/u.test(normalized) || normalized.includes("text")) return "text";
  if (normalized.includes("search")) return "text";
  if (normalized.includes("carousel")) return "carousel";
  return "unknown";
}

/**
 * Parse a comma-separated region list ("United States, Germany, ...") into
 * ISO codes. Unknown names are dropped silently (Google sometimes shows
 * region groups like "EEA" — that won't map and that's fine).
 */
export function parseCountries(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const parts = text
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const codes: string[] = [];
  for (const part of parts) {
    const iso = COUNTRY_NAME_TO_ISO[part];
    if (iso) codes.push(iso);
  }
  return codes;
}

/** Raw fields harvested from a Google ATC ad card or detail page. */
export interface RawGoogleAd {
  id: string;
  advertiser: string;
  formatChip?: string;
  firstShownRaw?: string;
  lastShownRaw?: string;
  regionsRaw?: string;
  creativeUrl?: string;
  landingUrl?: string;
  headline?: string;
  body?: string;
  sourceUrl?: string;
}

/**
 * Convert a RawGoogleAd into our normalized Ad shape.
 * Throws if `id` is missing — that's a programmer error upstream.
 */
export function buildAd(raw: RawGoogleAd): Ad {
  if (!raw.id) throw new Error("id required");

  const ad: Ad = {
    id: raw.id,
    platform: "google",
    advertiser: raw.advertiser ?? "",
    seenAt: new Date().toISOString(),
  };

  if (raw.formatChip !== undefined) {
    ad.adFormat = parseFormat(raw.formatChip);
  }

  if (raw.firstShownRaw !== undefined) {
    const iso = parseDate(raw.firstShownRaw);
    if (iso !== undefined) ad.firstSeen = iso;
  }

  if (raw.lastShownRaw !== undefined) {
    const iso = parseDate(raw.lastShownRaw);
    if (iso !== undefined) ad.lastSeen = iso;
  }

  if (raw.regionsRaw !== undefined) {
    const countries = parseCountries(raw.regionsRaw);
    if (countries.length > 0) ad.countries = countries;
  }

  if (raw.creativeUrl) ad.creativeUrls = [raw.creativeUrl];
  if (raw.landingUrl) ad.landingUrl = raw.landingUrl;
  if (raw.headline) ad.headline = raw.headline;
  if (raw.body) ad.body = raw.body;
  if (raw.sourceUrl) ad.sourceUrl = raw.sourceUrl;

  return ad;
}
