import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui";
import { listStaffOptions } from "@/lib/assignments-read";
import { requireOrg } from "@/lib/auth";
import { getMir } from "@/lib/mir-read";
import { MirForm } from "../MirForm";

export default async function MirDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrg();
  const { id } = await params;
  const mir = getMir(session.orgId, Number(id));
  if (!mir) notFound();
  const isAdmin = session.role === "admin";
  const staffOptions = listStaffOptions(session.orgId);

  return (
    <AppShell
      active="See more"
      breadcrumb={`See more › MIR › ${mir.title}`}
    >
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-4xl">
        <BackLink fallback="/mir">← Back to reports</BackLink>
        <h1 className="text-2xl font-semibold tracking-tight">{mir.title}</h1>
        <Card className="p-6">
          <MirForm
            mode="edit"
            mir={mir}
            staffOptions={staffOptions}
            isAdmin={isAdmin}
          />
        </Card>
      </div>
    </AppShell>
  );
}
