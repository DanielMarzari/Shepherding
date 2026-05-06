"use server";

import { redirect } from "next/navigation";
import { requireSession, setCurrentOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function selectOrgAction(_: unknown, formData: FormData) {
  const orgId = Number(formData.get("orgId"));
  if (!Number.isFinite(orgId) || orgId <= 0) return { error: "Pick an organization." };
  await setCurrentOrg(orgId);
  redirect("/");
}

export async function joinOrgAction(_: unknown, formData: FormData) {
  const s = await requireSession();
  const orgId = Number(formData.get("orgId"));
  if (!Number.isFinite(orgId) || orgId <= 0) return { error: "Pick an organization." };
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(orgId);
  if (!exists) return { error: "That organization no longer exists." };
  // Idempotent insert as 'member'
  db.prepare(
    "INSERT OR IGNORE INTO memberships (user_id, org_id, role) VALUES (?, ?, 'member')",
  ).run(s.user.id, orgId);
  await setCurrentOrg(orgId);
  redirect("/");
}

export async function createOrgAction(_: unknown, formData: FormData) {
  const s = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Organization name is required." };
  if (name.length > 80) return { error: "Name is too long." };

  const db = getDb();
  const result = db
    .prepare("INSERT INTO organizations (name, created_by) VALUES (?, ?)")
    .run(name, s.user.id);
  const orgId = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, 'admin')",
  ).run(s.user.id, orgId);
  await setCurrentOrg(orgId);
  redirect("/");
}

export async function logoutAction() {
  const { destroySession } = await import("@/lib/auth");
  await destroySession();
  redirect("/login");
}
