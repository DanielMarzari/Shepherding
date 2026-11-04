import "server-only";
import crypto from "node:crypto";
import { getDb } from "./db";

/** Who may sign in, for a one-church app.
 *
 *  Sign-up takes a church address and proves it with an emailed link; the
 *  leadership team shares one full-access login whose password lives only
 *  in the server's environment. Everything here is read from env at call
 *  time, so a value that is not set switches its feature off rather than
 *  failing the build.
 */

export const CHURCH_EMAIL_DOMAIN = "faithchurchpa.com";

export function isChurchEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1) === CHURCH_EMAIL_DOMAIN;
}

/** The church's organization. The app was built for many and is used by
 *  one; with a single row this is that row, and the oldest if more appear. */
export function churchOrgId(): number | null {
  const row = getDb()
    .prepare("SELECT id FROM organizations ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

/** Links in emails point here, never at the Host header of the request:
 *  a forged Host would send somebody's confirmation link to a stranger. */
export function appUrl(): string {
  return (process.env.APP_URL || "https://shepherdly.danmarzari.com").replace(/\/+$/, "");
}

// ── the leadership login ─────────────────────────────────────────────

/** Typed into the email box in place of an address. Not an address, so it
 *  can never collide with somebody's real account. */
export const LEADERSHIP_LOGIN = "leadership";
const LEADERSHIP_NAME = "Leadership team";

function leadershipPassword(): string | null {
  const p = process.env.LEADERSHIP_PASSWORD;
  return p && p.length >= 12 ? p : null;
}

export function leadershipEnabled(): boolean {
  return leadershipPassword() !== null;
}

/** Constant-time: comparing digests means the lengths always match. */
export function checkLeadershipPassword(attempt: string): boolean {
  const real = leadershipPassword();
  if (!real) return false;
  const a = crypto.createHash("sha256").update(attempt).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

/** What the shared account's password_hash column holds: a keyed digest of
 *  the current password. Sessions check it on every request, so changing
 *  LEADERSHIP_PASSWORD and redeploying signs everybody on it out — the
 *  only way to take a shared password back. Keyed with the app's
 *  encryption key so a copy of the database does not hand over a digest
 *  that can be guessed against offline. */
export function leadershipFingerprint(): string | null {
  const real = leadershipPassword();
  if (!real) return null;
  const key = process.env.ENCRYPTION_KEY ?? "";
  return "env:" + crypto.createHmac("sha256", key).update(real).digest("hex");
}

/** The shared account, created on first use and given admin in the church
 *  organization. Returns its user id. */
export function ensureLeadershipUser(orgId: number): number {
  const db = getDb();
  const fp = leadershipFingerprint();
  if (!fp) throw new Error("Leadership login is not configured.");
  db.prepare(
    `INSERT INTO users (email, password_hash, name, email_verified_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash`,
  ).run(LEADERSHIP_LOGIN, fp, LEADERSHIP_NAME);
  const { id } = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(LEADERSHIP_LOGIN) as { id: number };
  db.prepare(
    `INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, 'admin')
     ON CONFLICT(user_id, org_id) DO UPDATE SET role = 'admin'`,
  ).run(id, orgId);
  return id;
}

/** Is this session's user the shared account on a password that has since
 *  changed (or been switched off)? Then the session is over. */
export function isStaleLeadershipSession(email: string, passwordHash: string): boolean {
  if (email !== LEADERSHIP_LOGIN) return false;
  const fp = leadershipFingerprint();
  if (!fp || fp.length !== passwordHash.length) return true;
  return !crypto.timingSafeEqual(Buffer.from(fp), Buffer.from(passwordHash));
}

// ── failed-login throttle ────────────────────────────────────────────

/** Ten wrong passwords for one login in fifteen minutes locks that login
 *  for the rest of the fifteen. In memory: the app is one process, and a
 *  restart forgetting the count is an acceptable trade for no table. It
 *  matters most for the shared login, whose password a whole team knows. */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures: Map<string, { n: number; first: number }> =
  ((globalThis as { __loginFailures?: Map<string, { n: number; first: number }> })
    .__loginFailures ??= new Map());

export function loginLocked(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return f.n >= MAX_FAILURES;
}

export function recordLoginFailure(key: string): void {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { n: 1, first: Date.now() });
  else f.n++;
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}

// ── the confirmation email ───────────────────────────────────────────

/** Resend needs a key and a sender on a domain verified in Resend. Without
 *  both, sign-up says so rather than creating accounts nobody can confirm. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendConfirmationEmail(to: string, name: string, link: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  const first = name.split(" ")[0] || name;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [to],
      subject: "Confirm your Shepherding account",
      text: `Hi ${first},\n\nConfirm your email to finish setting up your Shepherding account:\n\n${link}\n\nThe link works once and expires in 24 hours. If you didn't sign up, ignore this email and nothing will happen.\n`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1c1c1a;max-width:480px">
<p>Hi ${esc(first)},</p>
<p>Confirm your email to finish setting up your Shepherding account.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#6d28d9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Confirm my email</a></p>
<p style="color:#666;font-size:13px">The link works once and expires in 24 hours. If you didn't sign up, ignore this email and nothing will happen.</p>
</div>`,
    }),
  }).catch(() => null);
  return Boolean(res?.ok);
}
