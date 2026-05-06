import { listAllOrgs, listOrgs, requireSession } from "@/lib/auth";
import { OrgPicker } from "./form";

export default async function OrgsPage() {
  const s = await requireSession();
  const myOrgs = listOrgs(s.user.id);
  const allOrgs = listAllOrgs();
  const myIds = new Set(myOrgs.map((o) => o.id));
  const otherOrgs = allOrgs.filter((o) => !myIds.has(o.id));

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-8">
          <span className="w-7 h-7 rounded grid place-items-center bg-accent text-[var(--accent-fg)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12c0-3 3-6 9-6s9 3 9 6-3 6-9 6-9-3-9-6Z" />
            </svg>
          </span>
          <span className="font-semibold tracking-tight">Shepherding</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">
          Welcome, {s.user.name.split(" ")[0]}.
        </h1>
        <p className="text-sm text-muted mb-8">
          Pick an organization to enter — or create a new one and you&apos;ll be its admin.
        </p>
        <OrgPicker myOrgs={myOrgs} otherOrgs={otherOrgs} />
      </div>
    </div>
  );
}
