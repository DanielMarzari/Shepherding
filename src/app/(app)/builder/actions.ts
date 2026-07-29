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
  getBuilderBlockConfig,
  getBuilderBlockSql,
  moveBuilderBlock,
  pageIdOfBlock,
  runBuilderQueryForOrg,
  snapshotPageVersion,
  undoPageVersion,
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
  snapshotPageVersion(s.orgId, id);
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
  snapshotPageVersion(s.orgId, pageId);
  addBuilderBlock(s.orgId, pageId, kind);
  revalidatePath(`/builder/${slug}`);
}

export async function updateBlockAction(id: number, config: BlockConfig, slug: string) {
  const s = await requireAdmin();
  const pid = pageIdOfBlock(s.orgId, id);
  if (pid) snapshotPageVersion(s.orgId, pid);
  updateBuilderBlock(s.orgId, id, config);
  revalidatePath(`/builder/${slug}`);
}

export async function deleteBlockAction(id: number, slug: string) {
  const s = await requireAdmin();
  const pid = pageIdOfBlock(s.orgId, id);
  if (pid) snapshotPageVersion(s.orgId, pid);
  deleteBuilderBlock(s.orgId, id);
  revalidatePath(`/builder/${slug}`);
}

export async function moveBlockAction(id: number, dir: "up" | "down", slug: string) {
  const s = await requireAdmin();
  const pid = pageIdOfBlock(s.orgId, id);
  if (pid) snapshotPageVersion(s.orgId, pid);
  moveBuilderBlock(s.orgId, id, dir);
  revalidatePath(`/builder/${slug}`);
}

/** Undo the most recent change to a page (restores the last snapshot). */
export async function undoPageAction(pageId: number, slug: string) {
  const s = await requireAdmin();
  undoPageVersion(s.orgId, pageId);
  revalidatePath(`/builder/${slug}`);
  revalidatePath(`/${slug}`);
}

/** Live-preview a query from the block editor (admin only, read-only). */
export async function runQueryAction(sql: string, params?: QueryParams): Promise<QueryResult> {
  const s = await requireAdmin();
  return runBuilderQueryForOrg(s.orgId, sql, params);
}

/** Live-preview a named data source from the block editor (admin only). */
export async function runSourceAction(sourceId: string, params?: QueryParams): Promise<QueryResult> {
  const s = await requireAdmin();
  const { runSource } = await import("@/lib/builder-sources");
  return runSource(s.orgId, sourceId, params);
}

/** Re-run a saved block with new filter params (any org member, read-only).
 *  The SQL is looked up server-side so a viewer can never run arbitrary SQL. */
export async function runBlockAction(blockId: number, params?: QueryParams): Promise<QueryResult> {
  const s = await requireOrg();
  const cfg = getBuilderBlockConfig(s.orgId, blockId);
  if (!cfg) return { columns: [], rows: [], truncated: false, error: "Block not found." };
  if (cfg.source) {
    const { runSource } = await import("@/lib/builder-sources");
    return runSource(s.orgId, cfg.source, params);
  }
  const sql = getBuilderBlockSql(s.orgId, blockId);
  if (sql == null) return { columns: [], rows: [], truncated: false, error: "Block not found." };
  return runBuilderQueryForOrg(s.orgId, sql, params);
}
