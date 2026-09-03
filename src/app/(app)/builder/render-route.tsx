import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { NAV_SECTIONS } from "@/lib/builder-nav";
import type { SessionContext } from "@/lib/auth";
import {
  countPageVersions,
  explainQueryPlan,
  getBuilderBlocks,
  getBuilderPage,
  getDbSchema,
  listBuilderPages,
  runBuilderQueryForOrg,
  type BlockConfig,
  type QueryDebug,
  type QueryResult,
} from "@/lib/builder";
import { ensureSeededPage } from "@/lib/builder-seeds";
import { runSource } from "@/lib/builder-sources";
import { BuilderPageClient, type ClientBlock } from "./builder-page-client";

const NO_SQL = new Set(["text", "divider", "embed", "pagelist", "group"]);

/** Render one builder page inside the app shell — the single code path behind
 *  both `/builder/[slug]` (user pages) and the overridden real routes (e.g.
 *  `/checkins`, which render their seeded builder page in place and become
 *  editable). `seed: true` creates the page from its seed definition on first
 *  visit; otherwise a missing page 404s. `active` / `breadcrumb` override the
 *  shell chrome so an overridden route keeps its original nav highlight. */
/** A builder page filed under a hub layer belongs to that layer, not to the
 *  Page Builder that happens to render it — "See more › Page Builder › Adult
 *  Discipleship" tells a reader the wrong thing about where they are. Reads the
 *  label straight from NAV_SECTIONS (client-safe constants, no extra query) and
 *  falls back to the old crumb for pages with no layer. */
function defaultBreadcrumb(page: { title: string; navSection: string | null; moreSection: string | null }): string {
  const layer =
    NAV_SECTIONS.find((s) => s.value && s.value === page.navSection)?.label ??
    page.moreSection?.trim();
  return layer ? `${layer} › ${page.title}` : `See more › Page Builder › ${page.title}`;
}

export async function renderBuilderRoute({
  session,
  slug,
  edit,
  seed = false,
  active,
  breadcrumb,
}: {
  session: SessionContext & { orgId: number; role: "admin" | "member" };
  slug: string;
  edit: boolean;
  seed?: boolean;
  active?: string;
  breadcrumb?: string;
}) {
  if (seed) ensureSeededPage(session.orgId, slug);

  const page = getBuilderPage(session.orgId, slug);
  if (!page) notFound();

  const raw = getBuilderBlocks(page.id);

  // Seed filter parameters from each filter's default so the first render is
  // already filtered; the client re-runs affected blocks when a filter changes.
  const initialParams: Record<string, string> = {};
  for (const b of raw) if (b.kind === "filter" && b.config.param) initialParams[b.config.param] = b.config.defaultValue ?? "";

  // Time every block query so edit mode can show a per-page inspector (how
  // many queries ran, each query's ms + rows, and an EXPLAIN-derived big-O).
  // Execution is serial/synchronous on one better-sqlite3 connection, so the
  // summed ms here ≈ the real render-blocking time the user feels.
  const queryLog: QueryDebug[] = [];
  // Dedupe identical queries within one render: blocks that run the exact same
  // SQL (or the same named source) reuse the first result instead of hitting
  // the DB again. This automatically collapses the "same heavy base recomputed
  // N times per page" cases — including on custom pages built later — with no
  // per-page tuning. All blocks share initialParams, so the query text is a
  // sufficient key.
  const queryCache = new Map<string, QueryResult>();
  const runTimed = (
    b: { id: number; kind: string; config: BlockConfig },
    cfg: BlockConfig,
  ): QueryResult => {
    const key = cfg.source ? `src:${cfg.source}` : `sql:${cfg.sql ?? ""}`;
    const cached = queryCache.has(key);
    const t0 = performance.now();
    const res = cached
      ? queryCache.get(key)!
      : cfg.source
        ? runSource(session.orgId, cfg.source, initialParams)
        : runBuilderQueryForOrg(session.orgId, cfg.sql ?? "", initialParams);
    if (!cached) queryCache.set(key, res);
    queryLog.push({
      blockId: b.id,
      kind: b.kind,
      title: (b.config.title ?? "").trim() || b.kind,
      source: cfg.source ?? null,
      sql: cfg.source ? null : cfg.sql ?? "",
      ms: performance.now() - t0,
      rows: res.rows.length,
      cols: res.columns.length,
      truncated: res.truncated,
      error: res.error ?? null,
      deduped: cached,
      plan: cached || cfg.source
        ? null
        : explainQueryPlan(cfg.sql ?? "", { ...initialParams, orgId: String(session.orgId) }),
    });
    return res;
  };

  const blocks: ClientBlock[] = raw.map((b) => ({
    id: b.id,
    position: b.position,
    kind: b.kind,
    config: b.config,
    result: NO_SQL.has(b.kind) ? null : runTimed(b, b.config),
    childResults: b.kind === "group"
      ? (b.config.children ?? []).map((ch) =>
          NO_SQL.has(ch.kind)
            ? null
            : runTimed({ id: b.id, kind: ch.kind, config: ch.config }, ch.config))
      : undefined,
  }));

  const pages = listBuilderPages(session.orgId)
    .filter((p) => p.slug !== slug)
    .map((p) => ({ slug: p.slug, title: p.title, description: p.description }));

  return (
    <AppShell active={active ?? page.title} breadcrumb={breadcrumb ?? defaultBreadcrumb(page)}>
      <div className="px-5 md:px-7 py-7">
        <BuilderPageClient
          page={{ id: page.id, slug: page.slug, title: page.title, description: page.description, navSection: page.navSection, moreSection: page.moreSection }}
          blocks={blocks}
          isAdmin={session.role === "admin"}
          initialEdit={edit}
          schema={getDbSchema()}
          pages={pages}
          versionCount={countPageVersions(session.orgId, page.id)}
          queryLog={queryLog}
        />
      </div>
    </AppShell>
  );
}
