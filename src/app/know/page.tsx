import {
  getIntakeSession,
  listIntakeCandidates,
} from "@/lib/shepherd-intake";
import { IntakeEmailForm } from "./email-form";
import { KnownList } from "./known-list";
import { intakeLogoutAction } from "./actions";

export const metadata = {
  title: "Who do you know? · Shepherding",
};

/** Public, no-admin-login page. A shepherd-team member enters their
 *  email to identify themselves, then marks which active members they
 *  personally know. Those marks are a SIGNAL for the church admin —
 *  not an assignment. The admin reviews them on the care map and
 *  decides who to formally assign. */
export default async function KnowPage() {
  const session = await getIntakeSession();

  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-fg flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Who do you know?
            </h1>
            <p className="text-muted text-sm mt-2">
              If you&apos;re on your church&apos;s shepherd team, enter the
              email your church has on file and we&apos;ll show you the
              directory so you can flag the people you personally know.
            </p>
          </div>
          <IntakeEmailForm />
          <p className="text-xs text-subtle text-center">
            We only use your email to recognize you — we never store the
            address itself.
          </p>
        </div>
      </main>
    );
  }

  const candidates = listIntakeCandidates(session.orgId, session.personId);

  return (
    <main className="min-h-screen bg-bg text-fg px-5 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Hi, {session.fullName.split(" ")[0]}
            </h1>
            <p className="text-muted text-sm mt-1.5 leading-relaxed max-w-prose">
              Mark the people you personally know — no rush, a few at a time
              is fine. It just tells your church who you have a relationship
              with; your admin decides who&apos;s formally assigned to you.
            </p>
          </div>
          <form action={intakeLogoutAction} className="shrink-0">
            <button
              type="submit"
              className="text-xs text-muted hover:text-fg underline underline-offset-2 cursor-pointer"
            >
              Sign out
            </button>
          </form>
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-xl border border-border-soft p-8 text-center text-sm text-muted">
            No active members to show yet. Check back after your church&apos;s
            next data sync.
          </div>
        ) : (
          <KnownList initial={candidates} />
        )}

        <p className="text-xs text-subtle text-center pt-2">
          Your selections save automatically as you tap.
        </p>
      </div>
    </main>
  );
}
