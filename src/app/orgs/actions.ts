"use server";

import { redirect } from "next/navigation";

export async function logoutAction() {
  const { destroySession } = await import("@/lib/auth");
  await destroySession();
  redirect("/login");
}
