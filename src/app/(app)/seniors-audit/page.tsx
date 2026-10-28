import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  EVENT_PICKER_YEARS,
  getAgeSource,
  getEmailSource,
  getEventSource,
  getSeniorsSelection,
  getWorkingList,
  listCcOptions,
  listPickerOptions,
} from "@/lib/seniors-audit";
import { AuditView } from "./audit-view";
import { SettingsPanel } from "./settings-panel";

/** The seniors audit.
 *
 *  Three sources and one list. Email says who the ministry writes to and
 *  whether they read it; age says who is old enough whether or not
 *  anybody has asked them; events say who has turned up. The answer is
 *  in the overlap — and more in the gaps between them, which is why all
 *  three are kept visible rather than collapsed into one number.
 */
export default async function SeniorsAuditPage() {
  const session = await requireOrg();
  const sel = getSeniorsSelection(session.orgId);
  const email = getEmailSource(session.orgId);
  const age = getAgeSource(session.orgId);
  const events = getEventSource(session.orgId);
  const working = getWorkingList(session.orgId);

  return (
    <AppShell active="Seniors audit" breadcrumb="Reports & insights › Seniors audit">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Seniors audit
          </h1>
          <p className="text-muted text-sm mt-1.5 max-w-3xl leading-relaxed">
            Who is actually part of the seniors ministry, and who should be.
            Three sources &mdash; the mailing list, everyone{" "}
            {sel.ageMin} and older, and whoever has turned up to a seniors
            event &mdash; merged into one list, sorted by how involved they
            are rather than by how old they are.
          </p>
        </div>

        <SettingsPanel
          ccOptions={listCcOptions(session.orgId)}
          eventOptions={listPickerOptions(session.orgId)}
          ageMin={sel.ageMin}
          years={EVENT_PICKER_YEARS}
          isAdmin={session.role === "admin"}
        />

        <AuditView
          working={working}
          email={email}
          age={age}
          events={events}
          years={EVENT_PICKER_YEARS}
        />
      </div>
    </AppShell>
  );
}
