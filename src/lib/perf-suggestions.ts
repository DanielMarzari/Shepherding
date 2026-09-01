import "server-only";
import { getDb } from "./db";

// Performance optimization backlog. Authored here in code (Claude profiles the
// app and writes these); per-org status lives in perf_suggestion_status. The
// admin reviews each on /settings/performance and sets a status — "approved" is
// the signal for Claude to implement a code change; DB-level ones can be applied
// in place. Items already shipped are seeded defaultStatus:"applied".

export type PerfStatus = "pending" | "approved" | "applied" | "dismissed";
export type PerfSafety = "safe" | "moderate" | "larger";

export interface PerfSuggestion {
  key: string;
  title: string;
  /** Which pages get faster. */
  pages: string[];
  /** Plain-language description of what's slow today. */
  whatsSlow: string;
  /** Where it lives, for the curious. */
  location: string;
  bigOBefore: string;
  bigOAfter: string;
  /** The proposed fix. */
  fix: string;
  /** safe = provably can't change any displayed number; moderate = refactor,
   *  output-identical if done carefully; larger = new precompute/denormalization
   *  with a staleness contract. */
  safety: PerfSafety;
  /** Can Claude apply this as a code change, or is it a DB-level action? */
  how: "claude-code" | "db-config";
  defaultStatus: PerfStatus;
}

/** The catalog, roughly ranked by (impact × safety). Verified against the code
 *  by an adversarial profiling pass — see the notes in each `whatsSlow`. */
export const PERF_SUGGESTIONS: PerfSuggestion[] = [
  {
    key: "sqlite-pragmas",
    title: "Tune the SQLite engine (page cache, mmap, memory temp store)",
    pages: ["Every page"],
    whatsSlow:
      "The database ran with SQLite's tiny default 2 MB page cache and disk-backed temp tables. Every org-wide aggregate re-read pages from disk, and the many staging temp tables the dashboards build spilled to disk.",
    location: "src/lib/db.ts (main connection) + src/lib/builder.ts (read-only connection)",
    bigOBefore: "disk-bound reads",
    bigOAfter: "memory-resident hot pages",
    fix: "Set cache_size = 64 MB, mmap_size = 256 MB, temp_store = MEMORY, and run PRAGMA optimize on connect. Changes speed only — never a query result.",
    safety: "safe",
    how: "db-config",
    defaultStatus: "applied",
  },
  {
    key: "giving-double-decrypt",
    title: "Giving page decrypted every donor twice",
    pages: ["Giving statistics"],
    whatsSlow:
      "The donor directory block and the lapsed-givers block each called listGivingPeople(1000) independently, so the giving page decrypted up to 1,000 donors twice per render.",
    location: "src/lib/give-lane.ts, src/lib/builder-sources.ts (giving_directory / giving_lapsed)",
    bigOBefore: "2 × O(donors) decrypt",
    bigOAfter: "1 × O(donors) decrypt",
    fix: "Memoize listGivingPeople with React cache() per request; the lapsed view filters the shared result. Output-identical.",
    safety: "safe",
    how: "claude-code",
    defaultStatus: "applied",
  },
  {
    key: "shepherded-temp-table-cache",
    title: 'Rebuilds the "shepherded people" set several times per request',
    pages: ["People", "Care queue", "Relationship graph", "Lanes", "search"],
    whatsSlow:
      "populateShepherdedTempTable does a full pco_check_ins GROUP BY plus two membership scans and a DELETE, and it's called un-memoized from listPeople, searchPeople, getClassificationCounts, the graph, and care reads. A page that touches two of those rebuilds it twice.",
    location: "src/lib/people-read.ts:139",
    bigOBefore: "O(check_ins + memberships) × callers",
    bigOAfter: "O(check_ins + memberships) once per request",
    fix: "Wrap in React cache() keyed by orgId (the temp table lives on the single shared connection, so once-per-request is correct). Output-identical. Highest safe win — it's on many hot paths.",
    safety: "safe",
    how: "claude-code",
    defaultStatus: "pending",
  },
  {
    key: "shepherd-workload-correlated",
    title: "Home page runs a correlated subquery per shepherd",
    pages: ["Home"],
    whatsSlow:
      "getShepherdWorkload computes each leader's flock size with a correlated subquery over an un-indexed UNION CTE, re-scanned once per leader, on every home load.",
    location: "src/lib/dashboard-read.ts:407",
    bigOBefore: "O(leaders × reach rows)",
    bigOAfter: "O(reach rows) — one pass",
    fix: "Rewrite as a single GROUP BY over the reach CTE joined to the leaders. Result-identical. (Modest impact — the leader set is small — but a free, safe win.)",
    safety: "safe",
    how: "claude-code",
    defaultStatus: "pending",
  },
  {
    key: "person-name-cache",
    title: "Decrypts all ~33k people on graph / name-audit / every search keystroke",
    pages: ["Relationship graph", "Name audit", "Global search"],
    whatsSlow:
      "Names live only inside the encrypted PII blob, so the relationship graph and the name audit decrypt the whole population on each render, and search decrypts everyone on each keystroke (the code notes ~50–150 ms per pass on 33k).",
    location: "src/lib/graph-read.ts, src/lib/audit-read.ts, src/lib/people-read.ts",
    bigOBefore: "O(people) AES-decrypt per render / per keystroke",
    bigOAfter: "plaintext column read (0 decrypts)",
    fix: "Names are now plaintext columns on pco_people (migration 0074), populated at sync + a one-time backfill; email/phone/address/birthdate stay protected. Graph, name-audit, and search read the columns and decrypt nobody. Search matches on plaintext first and only builds the ≤8 matches.",
    safety: "safe",
    how: "claude-code",
    defaultStatus: "applied",
  },
  {
    key: "per-render-dedupe",
    title: "Reuse identical queries within a page render",
    pages: ["Groups", "Teams", "Demographics", "any custom page"],
    whatsSlow:
      "Blocks running the exact same SQL (a shared base aggregate, a scope set) re-executed it every time — /groups computed the same 6-CTE base 4×, /teams scanned the serving history ~12–15×, demographics re-scanned people per chart.",
    location: "src/app/(app)/builder/render-route.tsx",
    bigOBefore: "N × the query cost",
    bigOAfter: "1 × per distinct query",
    fix: "render-route memoizes each block query by its SQL/source within a render, so identical queries run once and the rest reuse the result (shown as “deduped” in the inspector). Automatic — covers custom pages you build later. This is the generic fix for the three recompute items below.",
    safety: "safe",
    how: "claude-code",
    defaultStatus: "applied",
  },
  {
    key: "groups-base-once",
    title: "Groups page recomputes the same heavy aggregate 4 times",
    pages: ["Groups", "Home"],
    whatsSlow:
      "GROUPS_BASE (a 6-CTE aggregate that scans the large pco_event_attendances table) is embedded in three /groups blocks + one home block. Three of the four compute an identical result and throw most of it away.",
    location: "src/lib/builder-seeds.ts:277 (embedded at :376, :383, :394, :669)",
    bigOBefore: "4 × O(groups + members + attendances)",
    bigOAfter: "1 × per page",
    fix: "Compute the base once per render (a request-scoped temp table or a cache()d source) and have the three blocks read from it. NOTE: do NOT repoint at the existing group_summary snapshot — its window/exclusion/column semantics differ and would change the displayed numbers.",
    safety: "moderate",
    how: "claude-code",
    defaultStatus: "applied",
  },
  {
    key: "teams-base-once",
    title: "Teams page scans the serving history ~12–15 times",
    pages: ["Teams"],
    whatsSlow:
      "TEAMS_BASE joins pco_plan_people to pco_plans and is embedded in three blocks, each with ~4 internal scans, plus four serving-trend charts — so one page makes roughly 12–15 full passes over the serving history.",
    location: "src/lib/builder-seeds.ts:494 (embedded at :581, :583, :588 + trend tails)",
    bigOBefore: "~12–15 × O(plan_people)",
    bigOAfter: "1 × per page (or a refreshed snapshot)",
    fix: "Compute TEAMS_BASE once per render and reuse. A team_summary snapshot (mirroring group_summary, built in the dashboard refresh) is the bigger win but adds a staleness contract.",
    safety: "moderate",
    how: "claude-code",
    defaultStatus: "applied",
  },
  {
    key: "scope-set-once",
    title: "Demographics / groups / teams re-scan people once per chart",
    pages: ["Demographics", "Groups", "Teams"],
    whatsSlow:
      "Each demographic chart re-materializes the same population scope set and then scans pco_people to GROUP BY. With 4–5 charts running serially that's 4–5 full people scans per page.",
    location: "src/lib/builder-seeds.ts:133 (SCOPE_CTE), :264 (GROUPS_SP), :486 (TEAMS_SP)",
    bigOBefore: "4–5 × O(people)",
    bigOAfter: "1 × O(people) + cheap regroups",
    fix: "Build the scope person-id set once (temp table / cached CTE) and reuse across the page's charts. (Indexes won't help here — the charts bucket with CASE expressions, so no column index can drive the GROUP BY.)",
    safety: "moderate",
    how: "claude-code",
    defaultStatus: "applied",
  },
];

const VALID: PerfStatus[] = ["pending", "approved", "applied", "dismissed"];

export interface PerfSuggestionView extends PerfSuggestion {
  status: PerfStatus;
  note: string | null;
  updatedAt: string | null;
}

/** Catalog merged with the org's stored statuses (falling back to defaults). */
export function getPerfSuggestions(orgId: number): PerfSuggestionView[] {
  const rows = getDb()
    .prepare(`SELECT key, status, note, updated_at FROM perf_suggestion_status WHERE org_id = ?`)
    .all(orgId) as Array<{ key: string; status: string; note: string | null; updated_at: string }>;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return PERF_SUGGESTIONS.map((s) => {
    const stored = byKey.get(s.key);
    const status = stored && VALID.includes(stored.status as PerfStatus) ? (stored.status as PerfStatus) : s.defaultStatus;
    return { ...s, status, note: stored?.note ?? null, updatedAt: stored?.updated_at ?? null };
  });
}

export function setPerfSuggestionStatus(orgId: number, key: string, status: PerfStatus, note?: string): void {
  if (!PERF_SUGGESTIONS.some((s) => s.key === key)) return;
  if (!VALID.includes(status)) return;
  getDb()
    .prepare(
      `INSERT INTO perf_suggestion_status (org_id, key, status, note, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, key) DO UPDATE SET status=excluded.status, note=excluded.note, updated_at=excluded.updated_at`,
    )
    .run(orgId, key, status, note ?? null);
}
