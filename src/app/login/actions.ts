"use server";

import { redirect } from "next/navigation";
import { createSession, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function loginAction(_: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password required." };

  const db = getDb();
  const user = db
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email) as
    | { id: number; email: string; name: string; password_hash: string }
    | undefined;
  if (!user) return { error: "Email or password incorrect." };

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return { error: "Email or password incorrect." };

  // Pick most recent org as default current_org_id, or null if none
  const m = db
    .prepare("SELECT org_id FROM memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(user.id) as { org_id: number } | undefined;
  await createSession(user.id, m?.org_id ?? null);

  redirect(m ? "/" : "/orgs");
}
