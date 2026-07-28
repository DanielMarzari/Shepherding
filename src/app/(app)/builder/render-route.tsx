import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { SessionContext } from "@/lib/auth";
import {
  getBuilderBlocks,
  getBuilderPage,
  getDbSchema,
  listBuilderPages,
  runBuilderQueryForOrg,
} from "@/lib/builder";
import { seedPageIfMissing } from "@/lib/builder-seeds";
import { BuilderPageClient, type ClientBlock } from "./builder-page-client";

const NO_SQL = new Set(["text", "divider", "embed", "pagelist", "group"]);

/** Render one builder page inside the app shell — the single code path behind
 *  both `/builder/[slug]` (user pages) and the overridden real routes (e.g.
 *  `/checkins`, which render their seeded builder page in place and become
 *  editable). `seed: true` creates the page from its seed definition on first
 *  visit; otherwise a missing page 404s. `active` / `breadcrumb` override the
 *  shell chrome so an overridden route keeps its original nav highlight. */
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
  if (seed) seedPageIfMissing(session.orgId, slug);

  const page = getBuilderPage(session.orgId, slug);
  if (!page) notFound();

  const raw = getBuilderBlocks(page.id);

  // Seed filter parameters from each filter's default so the first render is
  // already filtered; the client re-runs affected blocks when a filter changes.
  const initialParams: Record<string, string> = {};
  for (const b of raw) if (b.kind === "filter" && b.config.param) initialParams[b.config.param] = b.config.defaultValue ?? "";

  const blocks: ClientBlock[] = raw.map((b) => ({
    id: b.id,
    position: b.position,
    kind: b.kind,
    config: b.config,
    result: NO_SQL.has(b.kind) ? null : runBuilderQueryForOrg(session.orgId, b.config.sql ?? "", initialParams),
    childResults: b.kind === "group"
      ? (b.config.children ?? []).map((ch) => (NO_SQL.has(ch.kind) ? null : runBuilderQueryForOrg(session.orgId, ch.config.sql ?? "", initialParams)))
      : undefined,
  }));

  const pages = listBuilderPages(session.orgId)
    .filter((p) => p.slug !== slug)
    .map((p) => ({ slug: p.slug, title: p.title, description: p.description }));

  return (
    <AppShell active={active ?? page.title} breadcrumb={breadcrumb ?? `See more › Page Builder › ${page.title}`}>
      <div className="px-5 md:px-7 py-7">
        <BuilderPageClient
          page={{ id: page.id, slug: page.slug, title: page.title, description: page.description, navSection: page.navSection, moreSection: page.moreSection }}
          blocks={blocks}
          isAdmin={session.role === "admin"}
          initialEdit={edit}
          schema={getDbSchema()}
          pages={pages}
        />
      </div>
    </AppShell>
  );
}
