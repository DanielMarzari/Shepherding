import "server-only";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";

const SESSION_COOKIE = "shepherding_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  email: string;
  name: string;
}

export interface SessionContext {
  user: SessionUser;
  orgId: number | null;
  orgName: string | null;
  role: "admin" | "member" | null;
  sessionId: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function newSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function expiresAt(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function createSession(userId: number, orgId: number | null) {
  const id = newSessionId();
  const db = getDb();
  db.prepare(
    "INSERT INTO sessions (id, user_id, current_org_id, expires_at) VALUES (?, ?, ?, ?)",
  ).run(id, userId, orgId, expiresAt());
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (id) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.current_org_id,
              u.id as user_id, u.email, u.name,
              o.name as org_name, m.role as role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = s.current_org_id
       LEFT JOIN memberships m ON m.org_id = s.current_org_id AND m.user_id = u.id
       WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .get(id) as
    | {
        session_id: string;
        current_org_id: number | null;
        user_id: number;
        email: string;
        name: string;
        org_name: string | null;
        role: "admin" | "member" | null;
      }
    | undefined;
  if (!row) {
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }
  return {
    user: { id: row.user_id, email: row.email, name: row.name },
    orgId: row.current_org_id,
    orgName: row.org_name,
    role: row.role,
    sessionId: row.session_id,
  };
}

/** Require an authenticated session. Redirects to /login if missing. */
export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Require an authenticated session AND a selected org. */
export async function requireOrg(): Promise<SessionContext & { orgId: number; role: "admin" | "member" }> {
  const s = await requireSession();
  if (s.orgId === null || s.role === null) redirect("/orgs");
  return { ...s, orgId: s.orgId, role: s.role };
}

export async function setCurrentOrg(orgId: number) {
  const s = await requireSession();
  const db = getDb();
  // Verify membership
  const m = db
    .prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?")
    .get(s.user.id, orgId);
  if (!m) throw new Error("Not a member of that organization");
  db.prepare("UPDATE sessions SET current_org_id = ? WHERE id = ?").run(orgId, s.sessionId);
}

export interface OrgListing {
  id: number;
  name: string;
  role: "admin" | "member";
}

export function listOrgs(userId: number): OrgListing[] {
  return getDb()
    .prepare(
      `SELECT o.id, o.name, m.role
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.name`,
    )
    .all(userId) as OrgListing[];
}

export function listAllOrgs(): { id: number; name: string }[] {
  return getDb()
    .prepare("SELECT id, name FROM organizations ORDER BY name")
    .all() as { id: number; name: string }[];
}
