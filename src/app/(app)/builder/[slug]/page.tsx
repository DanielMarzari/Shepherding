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

  const blocks: ClientBlock[] = getBuilderBlocks(page.id).map((b) => ({
    id: b.id,
    position: b.position,
    kind: b.kind,
    config: b.config,
    result: b.kind === "text" ? null : runBuilderQuery(b.config.sql ?? ""),
  }));

  return (
    <AppShell active="See more" breadcrumb={`See more › Page Builder › ${page.title}`}>
      <div className="px-5 md:px-7 py-7">
        <BuilderPageClient
          page={{ id: page.id, slug: page.slug, title: page.title, description: page.description }}
          blocks={blocks}
          isAdmin={session.role === "admin"}
          initialEdit={sp.edit === "1"}
          schema={getDbSchema()}
        />
      </div>
    </AppShell>
  );
}
