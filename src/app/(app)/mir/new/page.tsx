import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { MirForm } from "../MirForm";

export default async function NewMirPage() {
  const session = await requireOrg();
  if (session.role !== "admin") redirect("/mir");
  return (
    <AppShell
      active="See more"
      breadcrumb="See more › Ministry Impact Reports › New"
    >
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-4xl">
        <BackLink fallback="/mir">← Back to reports</BackLink>
        <h1 className="text-2xl font-semibold tracking-tight">
          New Ministry Impact Report
        </h1>
        <Card className="p-6">
          <MirForm mode="create" />
        </Card>
      </div>
    </AppShell>
  );
}
