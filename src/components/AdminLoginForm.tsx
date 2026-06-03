"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function AdminLoginForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "login failed");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "login failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 max-w-sm mx-auto grid gap-4">
      <h1 className="text-xl font-semibold">Admin login</h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        Set <span className="mono">ADMIN_PASSWORD</span> in your env.
      </p>
      <input
        type="password"
        className="input"
        placeholder="Password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
        disabled={busy}
      />
      {err && <div className="text-sm text-[var(--color-danger)]">{err}</div>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
