"use client";

import { useMemo, useState } from "react";

interface Lead {
  id: string;
  brand: string;
  email: string;
  company: string;
  countries: string[];
  status: string;
  resultCount: number;
  createdAt: string;
}

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return leads;
    const lc = q.toLowerCase();
    return leads.filter(
      (l) =>
        l.brand.toLowerCase().includes(lc) ||
        l.email.toLowerCase().includes(lc) ||
        l.company.toLowerCase().includes(lc) ||
        l.countries.some((c) => c.toLowerCase().includes(lc)),
    );
  }, [q, leads]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {filtered.length} of {leads.length} shown
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="search brand, email, company…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <a className="btn-primary" href="/api/admin/leads?format=csv">
            Export CSV
          </a>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-soft)]">
            <tr className="text-left text-[var(--color-text-muted)]">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ads</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr
                key={l.id}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-4 py-3 mono text-xs">
                  {new Date(l.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-medium">{l.brand}</td>
                <td className="px-4 py-3">{l.email}</td>
                <td className="px-4 py-3 text-[var(--color-text-muted)]">
                  {l.company || "—"}
                </td>
                <td className="px-4 py-3">{l.countries.join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      l.status === "done"
                        ? "badge badge-primary"
                        : l.status === "error"
                          ? "badge badge-accent"
                          : "badge"
                    }
                  >
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right mono">{l.resultCount}</td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/scan/${l.id}`}
                    className="text-[var(--color-primary-soft)] hover:underline"
                  >
                    view
                  </a>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-[var(--color-text-muted)]"
                >
                  no leads yet — run a scan from the homepage
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
