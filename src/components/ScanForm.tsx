"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

const COUNTRY_OPTIONS = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "ES", label: "Spain" },
  { code: "MX", label: "Mexico" },
  { code: "BR", label: "Brazil" },
  { code: "CL", label: "Chile" },
  { code: "AR", label: "Argentina" },
];

export function ScanForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [brand, setBrand] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("US");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: brand.trim(),
          email: email.trim(),
          company: company.trim() || undefined,
          countries: country ? [country] : [],
          utmSource: search.get("utm_source") || undefined,
          utmMedium: search.get("utm_medium") || undefined,
          utmCampaign: search.get("utm_campaign") || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const j = (await res.json()) as { scanId: string };
      router.push(`/scan/${j.scanId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="card p-6 grid gap-4 max-w-xl w-full mx-auto"
    >
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="brand">
          Brand to spy on
        </label>
        <input
          id="brand"
          className="input"
          required
          minLength={1}
          maxLength={80}
          placeholder="e.g. Notion, Linear, Patagonia"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="country">
            Country
          </label>
          <select
            id="country"
            className="input"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={busy}
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="company">
            Your company <span className="text-[var(--color-text-muted)]">(optional)</span>
          </label>
          <input
            id="company"
            className="input"
            maxLength={200}
            placeholder="Acme Inc."
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email so we can send you the report
        </label>
        <input
          id="email"
          type="email"
          required
          className="input"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </div>

      {error && (
        <div className="text-sm text-[var(--color-danger)]">{error}</div>
      )}

      <button type="submit" className="btn-accent w-full" disabled={busy}>
        {busy ? "Starting scan…" : "Spy on this brand →"}
      </button>
      <p className="text-xs text-[var(--color-text-muted)] text-center">
        Free. No login. No credit card. Just enter the brand.
      </p>
    </form>
  );
}
