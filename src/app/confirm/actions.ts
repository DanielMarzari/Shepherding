"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth";
import { churchOrgId } from "@/lib/church-auth";
import { getDb } from "@/lib/db";

export type ConfirmState = null | { error: string };

/** Use a sign-up link: make the account, give it member access to the
 *  church, sign it in.
 *
 *  A POST from the confirm page's button, never the GET of the link
 *  itself — mail scanners open links to check them, and a GET that did
 *  this would spend the link before its owner clicked it. */
export async function confirmAction(_: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "That link is incomplete." };
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const db = getDb();
  const pending = db
    .prepare(
      `SELECT email, name, password_hash FROM pending_signups
        WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .get(tokenHash) as { email: string; name: string; password_hash: string } | undefined;
  if (!pending) {
    return { error: "That link has expired or been used. Sign up again for a new one." };
  }

  const orgId = churchOrgId();
  if (orgId === null) return { error: "The church isn't set up in the app yet." };

  const userId = db.transaction(() => {
    const existing = db
      .prepare("SELECT id, email_verified_at FROM users WHERE email = ?")
      .get(pending.email) as { id: number; email_verified_at: string | null } | undefined;
    let id: number;
    if (existing?.email_verified_at) {
      // Confirmed already (another link, used first). Leave the account as
      // it is — its owner chose that password — and just sign in. No
      // membership is added: if it has none, somebody took its access away,
      // and a sign-up link must not hand it back.
      id = existing.id;
    } else if (existing) {
      // An account from before sign-up needed a church email, never let
      // in. The link proves the address, so it takes the new details.
      db.prepare(
        `UPDATE users SET name = ?, password_hash = ?,
                email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?`,
      ).run(pending.name, pending.password_hash, existing.id);
      id = existing.id;
      db.prepare(
        "INSERT OR IGNORE INTO memberships (user_id, org_id, role) VALUES (?, ?, 'member')",
      ).run(id, orgId);
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO users (email, password_hash, name, email_verified_at)
             VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          )
          .run(pending.email, pending.password_hash, pending.name).lastInsertRowid,
      );
      db.prepare(
        "INSERT OR IGNORE INTO memberships (user_id, org_id, role) VALUES (?, ?, 'member')",
      ).run(id, orgId);
    }
    // Every other link for the address dies with this one.
    db.prepare("DELETE FROM pending_signups WHERE email = ?").run(pending.email);
    return id;
  })();

  const member = db
    .prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?")
    .get(userId, orgId);
  await createSession(userId, member ? orgId : null);
  redirect(member ? "/" : "/orgs");
}
