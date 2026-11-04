import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { requireSession, setCurrentOrg } from "@/lib/auth";
import { churchOrgId } from "@/lib/church-auth";
import { getDb } from "@/lib/db";
import { logoutAction } from "./actions";

/** Where a signed-in account with no access lands.
 *
 *  There used to be an organization picker here, with Join and Create —
 *  which let anybody who made an account walk into the church's data. One
 *  church, so there is nothing to pick: an account with a membership goes
 *  straight in, and one without is told so. Access is only ever granted by
 *  confirming a church email (or by the leadership team), never here. */
export default async function OrgsPage() {
  const s = await requireSession();
  if (s.orgId !== null && s.role !== null) redirect("/");

  const orgId = churchOrgId();
  const member =
    orgId !== null &&
    getDb()
      .prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?")
      .get(s.user.id, orgId);
  if (member && orgId !== null) {
    await setCurrentOrg(orgId);
    redirect("/");
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">No access yet</h1>
      <p className="text-sm text-muted mb-6 leading-relaxed">
        You&rsquo;re signed in as <strong className="text-fg">{s.user.email}</strong>, but
        this account can&rsquo;t see the church&rsquo;s information. Ask the leadership
        team to give you access.
      </p>
      <form action={logoutAction}>
        <button
          type="submit"
          className="w-full px-3 py-2 rounded border border-border-soft text-sm hover:bg-bg-elev-2"
        >
          Sign out
        </button>
      </form>
    </AuthLayout>
  );
}
