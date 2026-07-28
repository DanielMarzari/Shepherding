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
  return renderBuilderRoute({ session, slug, edit: sp.edit === "1" });
}
