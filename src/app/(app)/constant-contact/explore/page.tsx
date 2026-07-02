import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hmac } from "@/lib/encryption";
import { ccApiGet, getStoredConstantContactCreds, type CcApiResult } from "@/lib/constant-contact";

export const metadata = { title: "Explore · Constant Contact" };

// ── defensive rendering helpers ──────────────────────────────────────
type Row = Record<string, unknown>;

function firstArray(obj: unknown): Row[] | null {
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Row)) {
      if (Array.isArray(v)) return v.filter((r) => r && typeof r === "object") as Row[];
    }
  }
  return null;
}
function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function extractEmail(c: Row): string | null {
  const e = c.email_address;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as Row).address === "string") return (e as Row).address as string;
  return null;
}

function DataTable({ rows, max = 25, cols }: { rows: Row[]; max?: number; cols?: string[] }) {
  if (!rows.length) return <p className="text-xs text-subtle">No rows returned.</p>;
  const keys = (cols ?? Array.from(new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r))))).slice(0, 9);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-muted">
            {keys.map((k) => <th key={k} className="text-left font-medium py-1 pr-3 whitespace-nowrap">{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-border-soft/60 align-top">
              {keys.map((k) => <td key={k} className="py-1 pr-3 max-w-[240px] truncate">{cell(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="text-[10px] text-subtle mt-1.5">Showing {max} of {rows.length}.</p>}
    </div>
  );
}

function KeyValues({ obj }: { obj: Row }) {
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
      {Object.entries(obj).slice(0, 30).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border-soft/40 py-0.5">
          <span className="text-muted">{k}</span>
          <span className="text-fg truncate max-w-[60%] text-right">{cell(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, result, cols, endpoint }: {
  title: string; subtitle?: string; result: CcApiResult<unknown>; cols?: string[]; endpoint: string;
}) {
  const arr = result.ok ? firstArray(result.data) : null;
  return (
    <Card className="p-5 space-y-2.5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">{title}{arr ? ` · ${arr.length}` : ""}</h2>
        <code className="text-[10px] text-subtle">GET {endpoint}</code>
      </div>
      {subtitle && <p className="text-xs text-subtle -mt-1">{subtitle}</p>}
      {!result.ok ? (
        <p className="text-xs text-warn-soft-fg">Error {result.status}: {result.error}</p>
      ) : arr ? (
        <DataTable rows={arr} cols={cols} />
      ) : (
        <KeyValues obj={(result.data ?? {}) as Row} />
      )}
    </Card>
  );
}

export default async function ExploreConstantContactPage() {
  const session = await requireOrg();
  const creds = getStoredConstantContactCreds(session.orgId);

  if (session.role !== "admin" || !creds.connected) {
    return (
      <AppShell active="Constant Contact" breadcrumb="Credentials › Constant Contact › Explore">
        <div className="px-5 md:px-7 py-7 max-w-3xl">
          <Card className="p-6 text-sm text-muted">
            {session.role !== "admin"
              ? "Only admins can explore Constant Contact data."
              : "Connect Constant Contact first."}{" "}
            <Link href="/constant-contact" className="text-accent hover:underline">Back to Constant Contact</Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Sequential (≤ 4 req/sec, 10k/day): one token refresh + 5 reads.
  const account = await ccApiGet(session.orgId, "/account/summary");
  const lists = await ccApiGet(session.orgId, "/contact_lists?include_count=true&limit=1000");
  const contacts = await ccApiGet(session.orgId, "/contacts?limit=50&status=all&include=list_memberships");
  const campaigns = await ccApiGet(session.orgId, "/emails?limit=50");
  const summaries = await ccApiGet(session.orgId, "/reports/summary_reports/email_campaign_summaries?limit=50");

  // How many sampled contacts we can link to a PCO person by email hash.
  let matched = 0;
  let sampled = 0;
  if (contacts.ok) {
    const rows = firstArray(contacts.data) ?? [];
    const stmt = getDb().prepare("SELECT 1 FROM pco_person_emails WHERE org_id = ? AND email_hash = ? LIMIT 1");
    for (const c of rows) {
      const email = extractEmail(c);
      if (!email) continue;
      sampled++;
      if (stmt.get(session.orgId, hmac(email.trim().toLowerCase()))) matched++;
    }
  }

  return (
    <AppShell active="Constant Contact" breadcrumb="Credentials › Constant Contact › Explore">
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-5xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Explore Constant Contact</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              A live look at what&apos;s in the account — pulled straight from the
              API on each load (a handful of calls, well under the rate limit).
              This is the raw material for the reporting we&apos;ll build next.
            </p>
          </div>
          <Link href="/constant-contact" className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer">
            ← Back
          </Link>
        </div>

        {sampled > 0 && (
          <div className="rounded-lg border border-border-soft bg-bg-elev-2/40 px-4 py-2.5 text-sm">
            <span className="font-medium">{matched}</span> of the{" "}
            <span className="font-medium">{sampled}</span> sampled contacts matched a
            PCO person by email — that email hash is the key we&apos;ll use to join
            Constant Contact engagement to each person in Shepherdly.
          </div>
        )}

        <Section title="Account" endpoint="/account/summary" result={account} />
        <Section
          title="Contact lists"
          subtitle="What people opted into — each list with its member count."
          endpoint="/contact_lists"
          cols={["list_id", "name", "membership_count", "favorite", "created_at", "updated_at"]}
          result={lists}
        />
        <Section
          title="Contacts (sample)"
          subtitle="First 50 contacts — email links them to PCO people."
          endpoint="/contacts"
          cols={["contact_id", "first_name", "last_name", "email_address", "create_source", "created_at"]}
          result={contacts}
        />
        <Section
          title="Emails sent (campaigns)"
          subtitle="Campaigns and their current status."
          endpoint="/emails"
          cols={["campaign_id", "name", "current_status", "type", "created_at", "updated_at"]}
          result={campaigns}
        />
        <Section
          title="Campaign engagement (opens / clicks / bounces)"
          subtitle="Per-campaign summary stats — sends, opens, clicks, bounces, opt-outs."
          endpoint="/reports/summary_reports/email_campaign_summaries"
          result={summaries}
        />
      </div>
    </AppShell>
  );
}
