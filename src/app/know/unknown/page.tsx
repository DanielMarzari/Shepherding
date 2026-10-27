import { getUnknownIntakeSession, listUnknownCandidates } from "@/lib/unknown-intake";
import { KnownList } from "../known-list";
import { UnknownIntakeEmailForm } from "./email-form";
import { unknownIntakeLogoutAction, toggleUnknownIntakeKnownAction } from "./actions";

export const metadata = {
  title: "Who do you know? · Shepherding",
};

/** Invite-only variant of /know that lists the Unknown band rather than the
 *  Known one. Only the hard-wired allowlist can log in. */
export default async function UnknownIntakePage() {
  const session = await getUnknownIntakeSession();

  if (!session) {
    return (
      <main className="min-h-screen bg-bg text-fg flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Who do you know?</h1>
            <p className="text-muted text-sm mt-2">
              Enter the email your church has on file and we&apos;ll show you the
              list so you can flag the people you personally know.
            </p>
          </div>
          <UnknownIntakeEmailForm />
          <p className="text-xs text-subtle text-center">
            Invite-only. We only use your email to recognize you — we never store the address itself.
          </p>
        </div>
      </main>
    );
  }

  const candidates = listUnknownCandidates(session.orgId, session.personId);

  return (
    <main className="min-h-screen bg-bg text-fg px-5 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hi, {session.fullName.split(" ")[0]}</h1>
            <p className="text-muted text-sm mt-1.5 leading-relaxed max-w-prose">
              The people below have shown up at our church, but we can&apos;t see them in
              anything yet — folks we&apos;d love to connect with and help take their next
              step. Select anyone you know personally, even just in passing. This
              doesn&apos;t assign them to you — it just shows who&apos;s connected to whom.
            </p>
          </div>
          <form action={unknownIntakeLogoutAction} className="shrink-0">
            <button type="submit" className="text-xs text-muted hover:text-fg underline underline-offset-2 cursor-pointer">
              Sign out
            </button>
          </form>
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-xl border border-border-soft p-8 text-center text-sm text-muted">
            Nobody to show right now. Check back after your church&apos;s next data sync.
          </div>
        ) : (
          <KnownList initial={candidates} toggleAction={toggleUnknownIntakeKnownAction} />
        )}

        <p className="text-xs text-subtle text-center pt-2">Your selections save automatically as you tap.</p>
      </div>
    </main>
  );
}
