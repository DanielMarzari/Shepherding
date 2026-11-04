"use server";

import { redirect } from "next/navigation";
import { createSession, verifyPassword } from "@/lib/auth";
import {
  LEADERSHIP_LOGIN,
  checkLeadershipPassword,
  churchOrgId,
  clearLoginFailures,
  ensureLeadershipUser,
  leadershipEnabled,
  loginLocked,
  recordLoginFailure,
} from "@/lib/church-auth";
import { getDb } from "@/lib/db";

const LOCKED = "Too many wrong passwords. Wait 15 minutes and try again.";
const WRONG = "Email or password incorrect.";

/** The email comes back with any error so the form can keep it: React
 *  clears a form after its action runs. Never the password. */
export type LoginState = null | { error: string; email: string };

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!login || !password) return { error: "Enter your email and password.", email: login };
  if (loginLocked(login)) return { error: LOCKED, email: login };

  // The shared leadership login: its password is only ever in the server's
  // environment, and it is off entirely when that is not set.
  if (login === LEADERSHIP_LOGIN) {
    const orgId = churchOrgId();
    if (!leadershipEnabled() || orgId === null || !checkLeadershipPassword(password)) {
      recordLoginFailure(login);
      return { error: WRONG, email: login };
    }
    clearLoginFailures(login);
    const userId = ensureLeadershipUser(orgId);
    await createSession(userId, orgId);
    redirect("/");
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, password_hash, email_verified_at FROM users WHERE email = ?",
    )
    .get(login) as
    | { id: number; password_hash: string; email_verified_at: string | null }
    | undefined;

  if (!user) {
    recordLoginFailure(login);
    const pending = db
      .prepare(
        `SELECT 1 FROM pending_signups
          WHERE email = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .get(login);
    if (pending) {
      return {
        error:
          "You haven't confirmed your email yet. Open the link we sent you, or sign up again for a new one.",
        email: login,
      };
    }
    return { error: WRONG, email: login };
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    recordLoginFailure(login);
    return { error: WRONG, email: login };
  }
  clearLoginFailures(login);

  // From before sign-up needed a confirmed church email, and never let in.
  if (!user.email_verified_at) {
    return {
      error:
        "This account was never confirmed. Sign up again with your church email to get a confirmation link.",
      email: login,
    };
  }

  const orgId = churchOrgId();
  const member =
    orgId !== null &&
    db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?").get(user.id, orgId);
  // Signed in either way: with no membership, /orgs says access was taken
  // away and who to ask, rather than a bare "incorrect password".
  await createSession(user.id, member ? orgId : null);
  redirect(member ? "/" : "/orgs");
}
