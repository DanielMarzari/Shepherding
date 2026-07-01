"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import {
  type BlockConfig,
  type BlockKind,
  type QueryResult,
  addBuilderBlock,
  createBuilderPage,
  deleteBuilderBlock,
  deleteBuilderPage,
  moveBuilderBlock,
  runBuilderQuery,
  updateBuilderBlock,
  updateBuilderPage,
} from "@/lib/builder";

async function requireAdmin() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  return s;
}

const VALID_KINDS: BlockKind[] = ["stat", "bar", "table", "text"];

export async function createPageAction(formData: FormData) {
  const s = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const slug = createBuilderPage(s.orgId, title || "Untitled page");
  revalidatePath("/builder");
  redirect(`/builder/${slug}?edit=1`);
}

export async function updatePageAction(id: number, title: string, description: string, slug: string) {
  const s = await requireAdmin();
  updateBuilderPage(s.orgId, id, title, description.trim() || null);
  revalidatePath(`/builder/${slug}`);
  revalidatePath("/builder");
}

export async function deletePageAction(id: number) {
  const s = await requireAdmin();
  deleteBuilderPage(s.orgId, id);
  revalidatePath("/builder");
  redirect("/builder");
}

export async function addBlockAction(pageId: number, kind: BlockKind, slug: string) {
  const s = await requireAdmin();
  if (!VALID_KINDS.includes(kind)) throw new Error("Bad block kind");
  addBuilderBlock(s.orgId, pageId, kind);
  revalidatePath(`/builder/${slug}`);
}

export async function updateBlockAction(id: number, config: BlockConfig, slug: string) {
  const s = await requireAdmin();
  updateBuilderBlock(s.orgId, id, config);
  revalidatePath(`/builder/${slug}`);
}

export async function deleteBlockAction(id: number, slug: string) {
  const s = await requireAdmin();
  deleteBuilderBlock(s.orgId, id);
  revalidatePath(`/builder/${slug}`);
}

export async function moveBlockAction(id: number, dir: "up" | "down", slug: string) {
  const s = await requireAdmin();
  moveBuilderBlock(s.orgId, id, dir);
  revalidatePath(`/builder/${slug}`);
}

/** Live-preview a query from the block editor (admin only, read-only). */
export async function runQueryAction(sql: string): Promise<QueryResult> {
  await requireAdmin();
  return runBuilderQuery(sql);
}
