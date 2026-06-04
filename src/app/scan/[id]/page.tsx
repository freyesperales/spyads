import { notFound } from "next/navigation";
import { getScan } from "@/lib/db";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { ScanReport } from "@/components/ScanReport";
import type { Ad } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ScanPage({ params }: PageProps) {
  const { id } = await params;
  const row = getScan(id);
  if (!row) notFound();

  let results: Ad[] = [];
  try {
    const parsed: unknown = JSON.parse(row.results_json);
    if (Array.isArray(parsed)) results = parsed as Ad[];
  } catch {
    results = [];
  }
  let sources: Array<{
    name: string;
    status: "ok" | "empty" | "error";
    count: number;
    message?: string;
    hint?: "needs_token" | "rate_limited" | "no_results" | "blocked" | "config";
  }> = [];
  try {
    const parsed: unknown = JSON.parse(row.sources_json ?? "[]");
    if (Array.isArray(parsed)) sources = parsed as typeof sources;
  } catch {
    sources = [];
  }

  const initial = {
    id: row.id,
    brand: row.brand,
    status: row.status,
    error: row.error,
    resultCount: row.result_count,
    results,
    sources,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };

  return (
    <main>
      <header className="mx-auto max-w-6xl px-5 pt-6">
        <a href="/" className="inline-block">
          <Logo />
        </a>
      </header>
      <div className="mx-auto max-w-6xl px-5 mt-10">
        <ScanReport scanId={id} initial={initial} />
      </div>
      <Footer />
    </main>
  );
}
