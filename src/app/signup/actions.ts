"use server";

import crypto from "node:crypto";
import { hashPassword } from "@/lib/auth";
import {
  CHURCH_EMAIL_DOMAIN,
  appUrl,
  emailConfigured,
  isChurchEmail,
  sendConfirmationEmail,
} from "@/lib/church-auth";
import { getDb } from "@/lib/db";

export type SignupState =
  | null
  // name and email come back so the form can keep them: React clears a
  // form after its action runs, and retyping both for one typo is a chore.
  | { error: string; name: string; email: string }
  | { sent: true; email: string };

const LINK_HOURS = 24;
/** One link a minute per address: enough to resend a lost one, too few to
 *  use the form to flood somebody's inbox. */
const RESEND_GAP_MS = 60 * 1000;

/** Sign-up sends a link; nothing is created until it is used.
 *
 *  The account is made in confirmAction, from the pending row, by whoever
 *  holds the link — which only the owner of the inbox can. */
export async function signupAction(_: SignupState, formData: FormData): Promise<SignupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name) return { error: "Enter your name.", name, email };
  if (name.length > 100) return { error: "That name is too long.", name, email };
  if (!isChurchEmail(email)) {
    return { error: `Use your church email — the one ending in @${CHURCH_EMAIL_DOMAIN}.`, name, email };
  }
  if (password.length < 8) return { error: "Your password needs at least 8 characters.", name, email };
  if (!emailConfigured()) {
    return {
      error:
        "Sign-up can't send confirmation emails yet. Ask the leadership team to finish setting it up.",
      name,
      email,
    };
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT email_verified_at FROM users WHERE email = ?")
    .get(email) as { email_verified_at: string | null } | undefined;
  if (existing?.email_verified_at) {
    return { error: "There's already an account for that email. Sign in instead.", name, email };
  }

  db.prepare(
    "DELETE FROM pending_signups WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ).run();
  const recent = db
    .prepare("SELECT MAX(created_at) AS at FROM pending_signups WHERE email = ?")
    .get(email) as { at: string | null };
  if (recent.at && Date.now() - Date.parse(recent.at) < RESEND_GAP_MS) {
    // Already on its way. Say the same thing as a fresh send, so the form
    // never hints at whether this address has been tried before.
    return { sent: true, email };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const passwordHash = await hashPassword(password);
  db.prepare(
    `INSERT INTO pending_signups (token_hash, email, name, password_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    tokenHash,
    email,
    name,
    passwordHash,
    new Date(Date.now() + LINK_HOURS * 3600 * 1000).toISOString(),
  );

  const ok = await sendConfirmationEmail(email, name, `${appUrl()}/confirm?token=${token}`);
  if (!ok) {
    db.prepare("DELETE FROM pending_signups WHERE token_hash = ?").run(tokenHash);
    return { error: "We couldn't send the confirmation email. Try again in a minute.", name, email };
  }
  return { sent: true, email };
}
