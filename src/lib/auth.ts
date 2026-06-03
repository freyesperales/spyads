import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "spyads_admin";

function getSecret(): string {
  return process.env.ADMIN_PASSWORD || "changeme";
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function issueAdminCookie(): { name: string; value: string; maxAge: number } {
  const secret = getSecret();
  const nonce = randomBytes(16).toString("hex");
  const sig = sign(nonce, secret);
  return {
    name: COOKIE_NAME,
    value: `${nonce}.${sig}`,
    maxAge: 60 * 60 * 8,
  };
}

export function verifyAdminCookie(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts as [string, string];
  const expected = sign(nonce, getSecret());
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

export function adminCookieName(): string {
  return COOKIE_NAME;
}

export function checkPassword(input: string): boolean {
  const expected = Buffer.from(getSecret());
  const got = Buffer.from(input);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}
