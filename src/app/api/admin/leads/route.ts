import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminCookieName, verifyAdminCookie } from "@/lib/auth";
import { leadsToCsv } from "@/lib/csv";
import { listScans } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await cookies();
  if (!verifyAdminCookie(c.get(adminCookieName())?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  const rows = listScans();

  if (format === "json") {
    return NextResponse.json({ rows });
  }

  const csv = leadsToCsv(rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="spyads-leads.csv"`,
    },
  });
}
