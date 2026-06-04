/**
 * Stronger email validation than zod's `.email()`.
 *
 * Three layers, cheapest-first so we reject obvious garbage before
 * making any DNS calls:
 *
 *   1. Regex — enforces a real-looking local part, a real TLD (≥ 2
 *      alphabetic chars), and rejects shapes that the WHATWG email
 *      check happily allows but no real provider would issue.
 *
 *   2. Disposable-domain blocklist — the top services people use to
 *      bypass lead-magnet forms (mailinator, tempmail, guerrillamail,
 *      etc.). This is the most-skipped check in lead-magnet UX and the
 *      easiest win for list quality. Embedded — no runtime fetch.
 *
 *   3. DNS MX record check — confirms the domain is actually configured
 *      to receive mail. Catches "asdas.eu" / "totally-made-up.io"
 *      patterns that pass regex but have no mailserver. Done via
 *      Node's `dns/promises` — no external dep.
 *
 * Returned shape:
 *
 *   { ok: true }                                     // pass
 *   { ok: false, reason: "format" | "disposable" | "no_mx" | "timeout",
 *     message: string }                              // fail
 *
 * The MX check has a hard 4-second timeout — slow corporate DNS
 * shouldn't keep a form-submit spinner alive forever. Timeouts return
 * `ok: false` rather than silently passing, because waving through a
 * timeout undermines the whole point of the check.
 */

import { promises as dns } from "node:dns";

// --- 1. Format check ------------------------------------------------------

// Stricter than `.email()` from zod:
//   - local part: alnum + `.+-_` (no leading/trailing dot)
//   - domain part: at least one label + a TLD of ≥ 2 alphabetic chars
// We deliberately allow `+addressing` so "user+spyads@gmail.com" passes.
const EMAIL_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._+\-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

function passesFormat(email: string): boolean {
  if (email.length < 6 || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

// --- 2. Disposable / throw-away providers --------------------------------

// Curated set — services explicitly marketed as "no-signup inbox" or used
// by 10minutemail / similar. We don't try to be exhaustive (lists with
// 20k entries exist); these cover the ~95th percentile of bot signups.
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.dev",
  "temp-mail.org",
  "temp-mail.io",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "sharklasers.com",
  "grr.la",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "fakeinbox.com",
  "maildrop.cc",
  "mailnesia.com",
  "mailcatch.com",
  "mintemail.com",
  "mohmal.com",
  "dispostable.com",
  "spamgourmet.com",
  "spam4.me",
  "harakirimail.com",
  "getairmail.com",
  "burnermail.io",
  "emailondeck.com",
  "fakemail.net",
  "mvrht.net",
  "anonbox.net",
  "boximail.com",
  "byom.de",
  "spambox.us",
  "spambog.com",
  "trbvm.com",
  "owlpic.com",
  "moakt.com",
  "deadaddress.com",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "anonymbox.com",
  "armyspy.com",
  "cuvox.de",
  "dayrep.com",
  "einrot.com",
  "fleckens.hu",
  "gustr.com",
  "jourrapide.com",
  "rhyta.com",
  "superrito.com",
  "teleworm.us",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "spamspot.com",
  "trash-mail.com",
  "trashmail.io",
  "trashmail.de",
  "trashmail.ws",
  "tutye.com",
  "fakemailgenerator.com",
  "mailtemp.info",
  "tempemail.net",
  "tempemails.io",
  "tmpmail.org",
  "tmpmail.net",
  "edu.sg.com",
  "inboxbear.com",
  "internetkeno.com",
  "mailhz.me",
  "mailtothis.com",
  "minutemail.com",
  "mymailoasis.com",
  "nepwk.com",
  "no-spam.ws",
  "objectmail.com",
  "smailpro.com",
  "spambox.org",
  "spamfree.eu",
  "spamfree24.com",
  "spamfree24.de",
  "spamfree24.eu",
  "spamfree24.info",
  "spamfree24.net",
  "spamfree24.org",
  "spamthis.co.uk",
  "spamtroll.net",
  "tafmail.com",
  "tagyourself.com",
  "tempmailaddress.com",
  "tempmail-ru.com",
  "tempr.email",
  "tempymail.com",
  "tilien.com",
  "tradermail.info",
  "trash2009.com",
  "venompen.com",
  "wronghead.com",
  "yepmail.net",
  "yourdomain.com",
  "example.com",  // people literally type this
  "example.org",
  "example.net",
  "test.com",
  "test.test",
]);

function isDisposable(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Also strip a single subdomain layer in case people use foo.mailinator.com
  const parts = domain.split(".");
  if (parts.length > 2) {
    const root = parts.slice(-2).join(".");
    return DISPOSABLE_DOMAINS.has(root);
  }
  return false;
}

// --- 3. DNS MX lookup -----------------------------------------------------

const MX_TIMEOUT_MS = 4000;

async function hasMxRecord(domain: string): Promise<"yes" | "no" | "timeout"> {
  // Race the lookup against a timer. If DNS is slow we'd rather show
  // the user an error than freeze the form for 30 seconds.
  type MxResult = "yes" | "no" | "timeout";
  const lookup: Promise<MxResult> = dns
    .resolveMx(domain)
    .then((records): MxResult => (records.length > 0 ? "yes" : "no"))
    .catch((): MxResult => "no");
  const timeout: Promise<MxResult> = new Promise((resolve) =>
    setTimeout(() => resolve("timeout"), MX_TIMEOUT_MS),
  );
  return Promise.race([lookup, timeout]);
}

// --- Public API -----------------------------------------------------------

export type EmailValidationResult =
  | { ok: true; normalized: string }
  | {
      ok: false;
      reason: "format" | "disposable" | "no_mx" | "timeout";
      message: string;
    };

export interface ValidateOptions {
  /** Set to false to skip the DNS lookup (testing, offline dev). */
  checkMx?: boolean;
}

export async function validateEmail(
  raw: string,
  options: ValidateOptions = {},
): Promise<EmailValidationResult> {
  const { checkMx = true } = options;
  const email = (raw ?? "").trim().toLowerCase();

  if (!passesFormat(email)) {
    return {
      ok: false,
      reason: "format",
      message: "That doesn't look like a real email address.",
    };
  }

  if (isDisposable(email)) {
    return {
      ok: false,
      reason: "disposable",
      message:
        "Disposable / temp-mail addresses aren't accepted. Please use a real address.",
    };
  }

  if (checkMx) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const mx = await hasMxRecord(domain);
    if (mx === "timeout") {
      return {
        ok: false,
        reason: "timeout",
        message:
          "Couldn't verify your email domain (DNS timeout). Try again or use a different address.",
      };
    }
    if (mx === "no") {
      return {
        ok: false,
        reason: "no_mx",
        message: `${domain} has no mailserver — that address can't receive email.`,
      };
    }
  }

  return { ok: true, normalized: email };
}
