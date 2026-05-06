import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";

export default function PCOSettingsPage() {
  return (
    <AppShell active="PCO" breadcrumb="PCO › Sync settings">
      <div className="px-5 md:px-7 py-7 max-w-5xl">
        <div className="mb-7">
          <div className="text-muted text-xs mb-1">PCO · Planning Center Online</div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync settings</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect your Planning Center account, choose what to pull, and set the schedule.
            Shepherding never writes back to PCO — your source of truth stays untouched.
          </p>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Connection</div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-good" />
              <span className="font-medium">Connected</span>
            </div>
            <div className="text-xs text-muted mt-1">Grace Community · Anaheim</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last sync</div>
            <div className="font-medium">6 minutes ago</div>
            <div className="text-xs text-good-soft-fg mt-1">204 changes pulled</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Next sync</div>
            <div className="font-medium">in 54 minutes</div>
            <div className="text-xs text-muted mt-1">hourly · automatic</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">People in scope</div>
            <div className="tnum text-2xl font-semibold">642</div>
            <div className="text-xs text-muted mt-1">587 active · 41 unshep</div>
          </Card>
        </div>

        {/* Credentials */}
        <Card className="mb-5">
          <CardHeader
            title="Credentials"
            badge={<Pill tone="good">Verified</Pill>}
            right={<span className="text-xs text-muted">Personal Access Token (PAT) preferred</span>}
          />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field
              label="Application ID"
              hint="From Planning Center · Account › Personal Access Tokens"
              value="pco_app_a1b2c3•••"
              type="text"
            />
            <Field
              label="Secret"
              hint="Stored encrypted at rest · only the last 4 chars are shown after save"
              value="•••••••••••••••3f9d"
              type="password"
            />
            <Field
              label="Webhook secret (optional)"
              hint="For real-time push updates between syncs"
              value="—"
              type="text"
              optional
            />
            <Field
              label="Organization name"
              hint="As seen at /people in PCO"
              value="Grace Community"
              type="text"
              readOnly
            />
            <div className="md:col-span-2 flex items-center justify-between pt-2 border-t border-border-soft">
              <div className="text-xs text-muted">
                Last verified Aug 18 · 9:14 AM · responded in 240ms
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg">
                  Test connection
                </button>
                <button className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg">
                  Rotate token
                </button>
                <button className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium">
                  Save credentials
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* What to sync */}
        <Card className="mb-5">
          <CardHeader
            title="What to sync"
            right={<span className="text-xs text-muted">5 of 7 entities enabled</span>}
          />
          <ul className="divide-y divide-border-softer">
            <SyncRow
              label="People"
              desc="Names, contact info, demographics, household, status"
              count="642"
              enabled
              required
            />
            <SyncRow
              label="Group memberships"
              desc="Who is in which group, since when, role"
              count="1,284"
              enabled
            />
            <SyncRow
              label="Group attendance"
              desc="Per-meeting attendance · used for activity tracking"
              count="38,402 events / 12mo"
              enabled
            />
            <SyncRow
              label="Service teams"
              desc="Worship, Hospitality, Greeters, Kids · membership + scheduling"
              count="221"
              enabled
            />
            <SyncRow
              label="Sunday attendance (check-ins)"
              desc="Required for Worship lane and falling-through-cracks rules"
              count="from Check-Ins app"
              enabled
            />
            <SyncRow
              label="Giving"
              desc="Donor records · drives the Giving lane. We never see amounts, only frequency."
              count="312 donors"
              enabled={false}
            />
            <SyncRow
              label="Forms (newcomer track)"
              desc="Pull form submissions to flag newcomers and track milestone completion"
              count="—"
              enabled={false}
            />
          </ul>
        </Card>

        {/* Schedule */}
        <Card className="mb-5">
          <CardHeader title="Auto-sync schedule" right={<Pill tone="good">Enabled</Pill>} />
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="text-xs text-muted block mb-2">Frequency</label>
              <div className="grid grid-cols-4 gap-1.5 text-sm">
                <FreqBtn>15m</FreqBtn>
                <FreqBtn>30m</FreqBtn>
                <FreqBtn active>Hourly</FreqBtn>
                <FreqBtn>Daily</FreqBtn>
              </div>
              <p className="text-xs text-muted mt-2">
                PCO rate-limits at 100 req/min per app. Hourly is well within budget.
              </p>
            </div>
            <div>
              <label className="text-xs text-muted block mb-2">Quiet hours</label>
              <div className="flex items-center gap-2">
                <input
                  className="bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm w-24"
                  defaultValue="22:00"
                />
                <span className="text-muted">→</span>
                <input
                  className="bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm w-24"
                  defaultValue="06:00"
                />
                <span className="text-xs text-muted">local time</span>
              </div>
              <p className="text-xs text-muted mt-2">
                Pause non-essential syncs overnight. Webhooks still fire.
              </p>
            </div>
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-border-soft">
              <Toggle label="Run a sync now after saving" enabled />
              <Toggle label="Email me when sync fails twice" enabled />
              <Toggle label="Auto-resolve PCO conflicts" enabled={false} />
            </div>
          </div>
        </Card>

        {/* Recent sync log */}
        <Card>
          <CardHeader
            title="Recent syncs"
            right={<button className="text-xs text-accent">View full log →</button>}
          />
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-soft">
                <th className="text-left font-medium px-5 py-2">When</th>
                <th className="text-left font-medium px-5 py-2">Trigger</th>
                <th className="text-left font-medium px-5 py-2">Result</th>
                <th className="text-right font-medium px-5 py-2 tnum">Changes</th>
                <th className="text-right font-medium px-5 py-2 tnum">Duration</th>
              </tr>
            </thead>
            <tbody>
              {SYNC_LOG.map((row, i) => (
                <tr key={i} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                  <td className="px-5 py-2.5 tnum text-muted">{row.when}</td>
                  <td className="px-5 py-2.5 text-muted">{row.trigger}</td>
                  <td className="px-5 py-2.5">
                    {row.ok ? (
                      <span className="text-good-soft-fg">OK</span>
                    ) : (
                      <span className="text-warn-soft-fg">Partial · {row.warning}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right tnum">{row.changes}</td>
                  <td className="px-5 py-2.5 text-right tnum text-muted">{row.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <p className="mt-6 text-xs text-muted">
          <span className="text-fg">Privacy:</span> credentials are stored encrypted at rest.
          Shepherding only reads the entities you enable above. We never write back to your PCO
          account, never store giving amounts, and never share data outside your church.
        </p>
      </div>
    </AppShell>
  );
}

const SYNC_LOG = [
  { when: "Aug 18 · 09:14", trigger: "Hourly", ok: true, changes: 14, duration: "240ms" },
  { when: "Aug 18 · 08:14", trigger: "Hourly", ok: true, changes: 8, duration: "212ms" },
  { when: "Aug 18 · 07:14", trigger: "Hourly", ok: true, changes: 22, duration: "318ms" },
  { when: "Aug 17 · 22:00", trigger: "Quiet-hour pause", ok: true, changes: 0, duration: "—" },
  {
    when: "Aug 17 · 09:14",
    trigger: "Hourly",
    ok: false,
    warning: "rate-limited 1×",
    changes: 47,
    duration: "1.2s",
  },
  { when: "Aug 17 · 08:14", trigger: "Manual", ok: true, changes: 31, duration: "402ms" },
];

function Field({
  label,
  hint,
  value,
  type,
  optional,
  readOnly,
}: {
  label: string;
  hint: string;
  value: string;
  type: "text" | "password";
  optional?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1.5 flex items-center gap-2">
        <span>{label}</span>
        {optional ? <span className="text-subtle text-[10px]">optional</span> : null}
      </label>
      <input
        className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm font-mono disabled:text-muted"
        type={type}
        defaultValue={value}
        disabled={readOnly}
      />
      <p className="text-xs text-subtle mt-1.5">{hint}</p>
    </div>
  );
}

function SyncRow({
  label,
  desc,
  count,
  enabled,
  required,
}: {
  label: string;
  desc: string;
  count: string;
  enabled: boolean;
  required?: boolean;
}) {
  return (
    <li className="px-5 py-3.5 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {required ? <Pill tone="muted">required</Pill> : null}
        </div>
        <p className="text-xs text-muted mt-0.5">{desc}</p>
      </div>
      <div className="text-xs text-muted tnum hidden md:block whitespace-nowrap">{count}</div>
      <Toggle enabled={enabled} disabled={required} />
    </li>
  );
}

function Toggle({
  label,
  enabled,
  disabled,
}: {
  label?: string;
  enabled: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`relative inline-block w-9 h-5 rounded-full transition-colors ${
          enabled ? "bg-accent" : "bg-bg-elev-2 border border-border-soft"
        } ${disabled ? "opacity-60" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-4" : ""
          }`}
        />
      </span>
      {label ? <span className="text-sm text-fg">{label}</span> : null}
    </div>
  );
}

function FreqBtn({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent-soft-bg text-accent-soft-fg"
          : "border-border-soft text-muted hover:text-fg hover:bg-bg-elev-2"
      }`}
    >
      {children}
    </button>
  );
}
