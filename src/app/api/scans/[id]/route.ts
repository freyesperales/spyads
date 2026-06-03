import { NextResponse } from "next/server";
import { getScan } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = getScan(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let results: unknown[] = [];
  try {
    results = JSON.parse(row.results_json) as unknown[];
  } catch {
    results = [];
  }
  let countries: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.countries);
    if (Array.isArray(parsed)) countries = parsed as string[];
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    id: row.id,
    brand: row.brand,
    status: row.status,
    error: row.error,
    countries,
    resultCount: row.result_count,
    results,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  });
}
