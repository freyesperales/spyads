import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { insertScan } from "@/lib/db";
import { validateEmail } from "@/lib/email-validator";
import { rateLimit } from "@/lib/ratelimit";
import { launchScan } from "@/lib/runner";
import { createScanSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`scans:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many scans from your IP. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createScanSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Stricter email check after zod's basic shape pass: blocks disposable
  // domains and confirms the domain has an MX record. This is the
  // load-bearing piece of "asdas.e" rejection — zod's `.email()` will
  // happily accept many shapes that no provider actually delivers to.
  const emailCheck = await validateEmail(input.email);
  if (!emailCheck.ok) {
    return NextResponse.json(
      { error: `email: ${emailCheck.message}`, reason: emailCheck.reason },
      { status: 400 },
    );
  }

  const id = randomBytes(10).toString("hex");

  insertScan({
    id,
    brand: input.brand,
    email: emailCheck.normalized,
    company: input.company || undefined,
    countries: input.countries,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
  });

  launchScan(id, input);

  return NextResponse.json({ scanId: id }, { status: 201 });
}
