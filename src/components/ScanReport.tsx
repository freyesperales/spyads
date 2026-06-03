"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Ad, Platform, ProgressEvent } from "@/lib/types";

interface ScanData {
  id: string;
  brand: string;
  status: "running" | "done" | "error";
  error: string | null;
  resultCount: number;
  results: Ad[];
  createdAt: string;
  completedAt: string | null;
}

interface Props {
  scanId: string;
  initial: ScanData;
}

export function ScanReport({ scanId, initial }: Props) {
  const [data, setData] = useState<ScanData>(initial);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const closedRef = useRef(false);

  useEffect(() => {
    if (initial.status !== "running") return;
    const es = new EventSource(`/api/scans/${scanId}/events`);

    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        setProgress((p) => [...p, data]);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("done", () => {
      closedRef.current = true;
      es.close();
      void refresh();
    });

    es.addEventListener("error", () => {
      // EventSource fires generic "error" on disconnect too — only treat
      // server-emitted error event payload as fatal. We refetch and let the
      // GET endpoint tell us if status is "error".
      if (closedRef.current) return;
      void refresh();
    });

    return () => {
      closedRef.current = true;
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  async function refresh() {
    try {
      const r = await fetch(`/api/scans/${scanId}`);
      if (!r.ok) return;
      const j = (await r.json()) as ScanData;
      setData(j);
    } catch {
      /* ignore */
    }
  }

  const filtered = useMemo(() => {
    return data.results.filter((a) => {
      if (platformFilter !== "all" && a.platform !== platformFilter) return false;
      if (formatFilter !== "all" && a.adFormat !== formatFilter) return false;
      return true;
    });
  }, [data.results, platformFilter, formatFilter]);

  const platforms = useMemo(() => {
    const set = new Set<Platform>();
    for (const a of data.results) set.add(a.platform);
    return [...set];
  }, [data.results]);

  const formats = useMemo(() => {
    const set = new Set<string>();
    for (const a of data.results) if (a.adFormat) set.add(a.adFormat);
    return [...set];
  }, [data.results]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(data.results, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `spyads-${data.brand}-${scanId}.json`);
  }

  function downloadCsv() {
    const cols: Array<keyof Ad> = [
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
      "sourceUrl",
    ];
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const a of data.results) {
      lines.push(cols.map((c) => esc(a[c])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    triggerDownload(blob, `spyads-${data.brand}-${scanId}.csv`);
  }

  return (
    <div className="grid gap-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--color-text-muted)] mono">
            scan {scanId.slice(0, 8)}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold mt-1">
            {data.brand}
          </h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            {data.status === "running" && "Scanning live…"}
            {data.status === "done" && `${data.resultCount} ads found`}
            {data.status === "error" && `Scan failed: ${data.error}`}
          </p>
        </div>
        {data.status === "done" && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={downloadCsv}>
              CSV
            </button>
            <button className="btn-ghost" onClick={downloadJson}>
              JSON
            </button>
          </div>
        )}
      </header>

      {data.status === "running" && (
        <ProgressPanel events={progress} />
      )}

      {data.status === "done" && data.results.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <FilterPills
              label="Platform"
              options={[
                { value: "all", label: "All" },
                ...platforms.map((p) => ({ value: p, label: p })),
              ]}
              value={platformFilter}
              onChange={(v) => setPlatformFilter(v as Platform | "all")}
            />
            <FilterPills
              label="Format"
              options={[
                { value: "all", label: "All" },
                ...formats.map((f) => ({ value: f, label: f })),
              ]}
              value={formatFilter}
              onChange={setFormatFilter}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((ad) => (
              <AdCard key={`${ad.platform}-${ad.id}`} ad={ad} />
            ))}
          </div>
        </>
      )}

      {data.status === "done" && data.results.length === 0 && (
        <div className="card p-10 text-center text-[var(--color-text-muted)]">
          We hit every source and found nothing live for{" "}
          <span className="text-[var(--color-text)] font-medium">
            {data.brand}
          </span>
          . Smaller brands sometimes don&apos;t appear — try a different
          spelling or country.
        </div>
      )}

      <div className="card p-6 mt-6 text-center">
        <h3 className="font-semibold text-lg">
          Want to track {data.brand} weekly?
        </h3>
        <p className="text-[var(--color-text-muted)] mt-1">
          We can send you a diff every Monday — new ads, paused ads, copy
          changes.
        </p>
        <a
          href={`mailto:hello@spyads.test?subject=Weekly%20tracking%20for%20${encodeURIComponent(data.brand)}`}
          className="btn-accent inline-block mt-4"
        >
          Email us
        </a>
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function FilterPills({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              value === o.value ? "badge badge-primary" : "badge hover:opacity-80"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProgressPanel({ events }: { events: ProgressEvent[] }) {
  const byPlatform = new Map<string, ProgressEvent[]>();
  for (const e of events) {
    const list = byPlatform.get(e.source) ?? [];
    list.push(e);
    byPlatform.set(e.source, list);
  }
  const latest: Record<string, ProgressEvent | undefined> = {};
  byPlatform.forEach((list, k) => {
    latest[k] = list[list.length - 1];
  });

  return (
    <div className="card p-6 grid gap-3">
      <div className="flex items-center gap-3">
        <Spinner />
        <span className="font-medium">Scanning…</span>
      </div>
      <ul className="grid gap-2 mono text-sm">
        {Object.entries(latest).map(([source, ev]) => (
          <li key={source} className="flex justify-between items-center">
            <span>
              <span className="badge badge-primary mr-2">{source}</span>
              {ev?.message}
            </span>
            {typeof ev?.count === "number" && (
              <span className="text-[var(--color-text-muted)]">
                {ev.count} ads
              </span>
            )}
          </li>
        ))}
        {Object.keys(latest).length === 0 && (
          <li className="text-[var(--color-text-muted)]">
            Warming up the scrapers…
          </li>
        )}
      </ul>
    </div>
  );
}

function Spinner() {
  return (
    <div className="h-4 w-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin" />
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const img = ad.creativeUrls?.[0];
  return (
    <article className="card p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center text-xs">
        <span className="badge badge-primary">{ad.platform}</span>
        <div className="flex gap-1.5">
          {ad.adFormat && <span className="badge">{ad.adFormat}</span>}
          {ad.isActive && (
            <span className="badge badge-accent">live</span>
          )}
        </div>
      </div>
      {img && (
        <div className="aspect-video w-full rounded-md overflow-hidden bg-[var(--color-bg-soft)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img}
            alt={ad.headline ?? ad.advertiser}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div>
        <h3 className="font-semibold leading-tight">
          {ad.headline ?? ad.advertiser}
        </h3>
        {ad.body && (
          <p className="text-sm text-[var(--color-text-muted)] mt-1 line-clamp-3">
            {ad.body}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between text-xs mono text-[var(--color-text-muted)]">
        <span>{ad.cta ?? "—"}</span>
        {ad.sourceUrl && (
          <a
            href={ad.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-text)]"
          >
            source ↗
          </a>
        )}
      </div>
    </article>
  );
}
