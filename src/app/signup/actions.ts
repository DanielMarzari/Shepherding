"use server";

import { redirect } from "next/navigation";
import { createSession, hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function signupAction(_: unknown, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name) return { error: "Name is required." };
  if (!email.includes("@")) return { error: "Enter a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
  if (existing) return { error: "An account with that email already exists." };

  const password_hash = await hashPassword(password);
  const result = db
    .prepare("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)")
    .run(email, password_hash, name);
  const userId = Number(result.lastInsertRowid);
  await createSession(userId, null);
  redirect("/orgs");
}
