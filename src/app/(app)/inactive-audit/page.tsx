import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { PULSE_MONTHS, getInactiveAudit } from "@/lib/inactive-audit";
import { InactiveTable } from "./inactive-table";

/** Who to consider marking inactive in Planning Center.
 *
 *  The lowest bar the data can express: one of anything — a gift, an
 *  email open, a check-in, a form — inside a year. Known asks a hard
 *  question and this asks the easiest one, on purpose. Failing this does
 *  not mean somebody has left; it means nothing they do reaches PCO, and
 *  that is worth somebody looking at either way.
 */
export default async function InactiveAuditPage() {
  const session = await requireOrg();
  const audit = getInactiveAudit(session.orgId);

  return (
    <AppShell active="Inactive audit" breadcrumb="Audit & data hygiene › Inactive audit">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Inactive audit
          </h1>
          <p className="text-muted text-sm mt-1.5 max-w-3xl leading-relaxed">
            Active PCO records with no trace of the person anywhere in{" "}
            {audit.months} months &mdash; no check-in, no form, no group
            meeting, no serving, no gift, no email opened, no registration.
            One of any of them would have been enough.
          </p>
        </div>

        <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              n={audit.candidates.length}
              label="to consider marking inactive"
              tone="warn"
            />
            <Stat n={audit.considered} label="active records in PCO" />
            <Stat
              n={audit.neverSeen}
              label="no trace at all, ever"
            />
            <Stat
              n={audit.alreadyInactive}
              label="already inactive — left alone"
            />
          </div>
          <div className="mt-3 text-[11px] text-subtle leading-relaxed">
            {audit.excludedByType > 0 && (
              <>
                <strong className="text-fg tnum">
                  {audit.excludedByType.toLocaleString()}
                </strong>{" "}
                more are never suggested because of their membership type
                &mdash; {audit.excludedTypes.join(", ")}. A partner with no
                check-ins is a partner, not a lapsed attender, and a SYSTEM
                USE record is not a person.
              </>
            )}
          </div>
          <p className="text-xs text-subtle mt-3.5 leading-relaxed max-w-3xl">
            This is a list to work through, not a verdict. Somebody can be
            in the building every Sunday and leave no record of it, so the
            question each row asks is whether anyone has seen this person —
            not whether the database is sure they are gone. Marking the
            record inactive is done in Planning Center; nothing here
            changes it.
          </p>
        </div>

        <InactiveTable
          rows={audit.candidates}
          months={audit.months}
          types={audit.typesPresent}
        />
      </div>
    </AppShell>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-semibold tnum ${
          tone === "warn" ? "text-warn-soft-fg" : ""
        }`}
      >
        {n.toLocaleString()}
      </div>
      <div className="text-[11px] text-subtle leading-snug">{label}</div>
    </div>
  );
}

export const revalidate = 0;
export { PULSE_MONTHS };
