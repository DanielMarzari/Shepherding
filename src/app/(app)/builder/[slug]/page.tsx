import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../render-route";

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
  // seed: a slug with a definition in BUILDER_SEEDS (e.g. the Ministry Impact
  // Report pages) is created on first visit; ensureSeededPage is a no-op for
  // every other slug, and never overwrites a page someone has edited.
  return renderBuilderRoute({ session, slug, edit: sp.edit === "1", seed: true });
}
