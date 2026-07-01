import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getBuilderBlocks, getBuilderPage, getDbSchema, runBuilderQuery } from "@/lib/builder";
import { BuilderPageClient, type ClientBlock } from "../builder-page-client";

export default async function BuilderCustomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { slug } = await params;
  const sp = await searchParams;
  const page = getBuilderPage(session.orgId, slug);
  if (!page) notFound();

  const raw = getBuilderBlocks(page.id);

  // Seed filter parameters from each filter's default so the first render is
  // already filtered; the client re-runs affected blocks when a filter changes.
  const initialParams: Record<string, string> = {};
  for (const b of raw) if (b.kind === "filter" && b.config.param) initialParams[b.config.param] = b.config.defaultValue ?? "";

  const NO_SQL = new Set(["text", "divider", "embed"]);
  const blocks: ClientBlock[] = raw.map((b) => ({
    id: b.id,
    position: b.position,
    kind: b.kind,
    config: b.config,
    result: NO_SQL.has(b.kind) ? null : runBuilderQuery(b.config.sql ?? "", initialParams),
  }));

  return (
    <AppShell active={page.title} breadcrumb={`See more › Page Builder › ${page.title}`}>
      <div className="px-5 md:px-7 py-7">
        <BuilderPageClient
          page={{ id: page.id, slug: page.slug, title: page.title, description: page.description, navSection: page.navSection }}
          blocks={blocks}
          isAdmin={session.role === "admin"}
          initialEdit={sp.edit === "1"}
          schema={getDbSchema()}
        />
      </div>
    </AppShell>
  );
}
