"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import {
  type BlockConfig,
  type BlockKind,
  type QueryParams,
  type QueryResult,
  addBuilderBlock,
  createBuilderPage,
  deleteBuilderBlock,
  deleteBuilderPage,
  getBuilderBlockSql,
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

const VALID_KINDS: BlockKind[] = ["stat", "kpi", "progress", "chart", "table", "leaderboard", "map", "text", "divider", "embed", "filter", "pagelist", "group"];

export async function createPageAction(formData: FormData) {
  const s = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const slug = createBuilderPage(s.orgId, title || "Untitled page");
  revalidatePath("/builder");
  redirect(`/builder/${slug}?edit=1`);
}

export async function updatePageAction(id: number, title: string, description: string, slug: string, navSection?: string, moreSection?: string) {
  const s = await requireAdmin();
  updateBuilderPage(s.orgId, id, title, description.trim() || null, navSection ?? null, moreSection ?? null);
  revalidatePath(`/builder/${slug}`);
  revalidatePath("/builder");
  revalidatePath("/more"); // the See More page reflects moreSection placement
  revalidatePath("/", "layout"); // the sidebar (AppShell) reflects nav placement
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
export async function runQueryAction(sql: string, params?: QueryParams): Promise<QueryResult> {
  await requireAdmin();
  return runBuilderQuery(sql, params);
}

/** Re-run a saved block with new filter params (any org member, read-only).
 *  The SQL is looked up server-side so a viewer can never run arbitrary SQL. */
export async function runBlockAction(blockId: number, params?: QueryParams): Promise<QueryResult> {
  const s = await requireOrg();
  const sql = getBuilderBlockSql(s.orgId, blockId);
  if (sql == null) return { columns: [], rows: [], truncated: false, error: "Block not found." };
  return runBuilderQuery(sql, params);
}
