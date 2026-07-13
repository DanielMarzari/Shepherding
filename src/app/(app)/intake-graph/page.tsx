import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getIntakeCoverage, getIntakeGraph, getTopMarkers } from "@/lib/intake-graph";
import { IntakeGraphView } from "./graph-view";

export const metadata = { title: "Who knows who · Shepherding" };

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (n: number) => n.toLocaleString();

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-subtle mt-0.5">{sub}</div>}
    </Card>
  );
}

function GraphSection({ title, blurb, data, markers }: {
  title: string; blurb: string;
  data: ReturnType<typeof getIntakeGraph>;
  markers: Array<{ name: string; count: number }>;
}) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-subtle mt-0.5">{blurb}</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#2563eb" }} />Shepherd team</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#9ca3af" }} />Everyone else</span>
        </div>
      </div>
      <IntakeGraphView data={data} />
      {markers.length > 0 && (
        <div className="text-xs text-muted">
          <span className="text-subtle">Most connections: </span>
          {markers.slice(0, 6).map((m, i) => (
            <span key={i}>{i > 0 ? " · " : ""}{m.name} ({m.count})</span>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function IntakeGraphPage() {
  const session = await requireOrg();
  const know = getIntakeGraph(session.orgId, "know");
  const present = getIntakeGraph(session.orgId, "present");
  const cov = getIntakeCoverage(session.orgId);
  const knowMarkers = getTopMarkers(session.orgId, "know");
  const presentMarkers = getTopMarkers(session.orgId, "present");

  return (
    <AppShell active="See more" breadcrumb="See more › Who knows who">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Who knows who</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            The relationship webs from the &ldquo;who do you know&rdquo; forms — shepherd-team
            members in blue, everyone else grey. A person can be known by several people.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Active people known" value={pct(cov.knownActivePct)} sub={`${num(cov.activeMarked)} of ${num(cov.activeTotal)} active`} />
          <Kpi label="Present people known" value={pct(cov.presentKnownPct)} sub={`${num(cov.presentMarked)} of ${num(cov.presentTotal)} present`} />
          <Kpi label="/know marks" value={num(cov.knowMarks)} sub={`by ${num(cov.knowMarkers)} people`} />
          <Kpi label="/present marks" value={num(cov.presentMarks)} sub={`by ${num(cov.presentMarkers)} people`} />
        </div>

        <GraphSection
          title="/know — active people"
          blurb="Shepherd-team members flagging active people they personally know."
          data={know}
          markers={knowMarkers}
        />
        <GraphSection
          title="/present — present people"
          blurb="The invite-only /present form: who knows people who show up but aren’t active yet."
          data={present}
          markers={presentMarkers}
        />
      </div>
    </AppShell>
  );
}
