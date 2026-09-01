import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getSqlTheme } from "@/lib/builder-theme-store";
import { AppearanceClient } from "./appearance-client";

export default async function AppearancePage() {
  const session = await requireOrg();
  const theme = getSqlTheme(session.orgId);
  return (
    <AppShell active="Appearance" breadcrumb="Settings › Appearance">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appearance</h1>
          <p className="text-muted text-sm mt-1 max-w-xl">
            Colors for the SQL editor in the Page Builder. Pick a hue for each token type; the preview
            updates as you go. Saved colors apply to everyone in your organization.
          </p>
        </div>
        <AppearanceClient initial={theme} isAdmin={session.role === "admin"} />
      </div>
    </AppShell>
  );
}
