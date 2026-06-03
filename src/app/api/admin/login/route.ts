import { NextResponse } from "next/server";
import { checkPassword, issueAdminCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const pw = body.password ?? "";
  if (!pw || !checkPassword(pw)) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  const cookie = issueAdminCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });
  return res;
}
