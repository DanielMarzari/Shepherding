# Page Builder remodel — status of every page

Scheme (per Dan, 2026-07-29): new builder versions are staged at **`/[page]-new`**;
the **original stays on its primary route** until Dan approves and it's promoted.
(The first three — checkins, demographics, groups — were done under the earlier
scheme: builder on the primary route, original at `/[page]-original`.)

Next Campus Planner is intentionally excluded.

## ✅ Converted — builder version live

| Page | Where | Notes |
|------|-------|-------|
| `/checkins` | primary (orig at `/checkins-original`) | stats + events table |
| `/demographics` | primary (orig at `/demographics-original`) | chips scope filter + 4 charts |
| `/groups` | primary (orig at `/groups-original`) | full parity: 6 stats, health, rich table (attend % banded), demographics, attendance trend |
| `/teams-new` | `-new` | roster stats, health, teams table, demographics, serving trend |
| `/home-new` | `-new` | engaged/mix stats + group health (SQL) + falling-through-cracks / movement / shepherd-workload (decrypt sources) |
| `/people-new` | `-new` | classification stats + **tabs filter** (All/Shepherded/Active/Present/Inactive → `:classification`) driving the directory table (decrypted names via `people_directory` source) |
| `/staff-new` | `-new` | staff count + directory via `staff_directory` source (the "REFERENCE - Church Staff" list) |
| `/shepherds-new` | `-new` | overview list-stat (shepherds · overseen · needs mapping) + directory table via `shepherds_directory` / `shepherds_overview` sources (reuses `listShepherds` + `getLeaderOverseersBatch`, exact page logic) |
| `/shepherd-team-new` | `-new` | team-members count (SQL) + four-bucket reach table via `shepherd_team_directory` (`getShepherdTeamBreakdown`) |
| `/audit/duplicates-new` | `-new` (slug `audit-duplicates`) | 4 stat cards + confidence **chips** + likely-duplicates **linkcard** (each pair links both people to PCO) via `duplicate_pairs` / `duplicate_overview` |
| `/audit/membership-new` | `-new` (slug `audit-membership`) | flagged/scanned stats + membership-type dropdown + issue chips + flagged-people **linkcard** via `membership_audit` (`auditMembershipType`) |
| `/audit/names-new` | `-new` (slug `audit-names`) | junk/weird-name **linkcard** via `name_audit` (`findNameIssuesAcrossOrg`) |
| `/map-new` | `-new` (slug `member-map`) | mapped-count stat + engagement donut + **map block** of geocoded members (static; the reach / second-campus tooling stays on `/map`) |
| `/attendance-new` | `-new` (slug `attendance`) | 4 stats + attendance-over-time + congregation-mix line charts + by-room bar (SQL-able core; weather/forecast/preacher analytics stay on `/attendance`) |

## 🟡 Quick follow-ups — reuse existing patterns (decrypt sources exist)

| Page | Plan |
|------|------|
| `/care-queue` | **original is mock data** (`@/lib/mock`) — needs real care logic first (`listCareCandidates` exists in care-read.ts) |

## 🟠 Complex analytics — need their TS logic ported to SQL/sources (bigger)

| Page | Why |
|------|-----|
| `/retention` | cohort decay / seasonality — multi-step retention math; a monthly cohort-retention heatmap is a feasible builder approximation |
| `/pipeline` | interest→action funnel timing, cohorted by month |
| `/lanes/*` | community/serve lane pipelines (partly PII) |
| `/metrics` | mostly threshold/map/serving-form **settings** (writes) — keep hand-coded; could add a read-only KPI strip |

## 🔵 Interactive / bespoke — a static builder version is a real downgrade

| Page | Why the interactive original wins |
|------|-----------------------------------|
| `/reaching-the-valley` | census/reach overlays + LV_CENSUS_META constants — not SQL; map block alone loses the point |
| `/graph`, `/intake-graph` | force-graph over **all** engaged people (hundreds–thousands of nodes/edges) — an echarts network of that size is unreadable & janky. A *scoped* network (one shepherd's immediate connections) would be a worthwhile new feature, not a static dump |
| `/movement` | **sankey** chart from movement/classification transitions — feasible if desired |
| `/care-map`, `/shepherd-map` | drag-to-assign / isochrone — inherently interactive |

`/map-new` shows a clean static points map because points-on-a-map survives being
static; a force-graph does not. Recommend keeping the graph/reach pages interactive.

## ⚪ Keep hand-coded — not dashboards (OAuth / config / write / uploads)

`/constant-contact*`, `/pushpay`, `/subsplash`, `/pco*`, `/mir*` (PDF upload),
`/audit/names` (write actions), `/more` (menu), `/lanes` editors, and the various
`*-original` / example routes. A builder page is read-only and can't host connect
flows or mutating forms.

## Capabilities built for this remodel
Table density; 12-col grid (fractional widths); preset text colors (whole-element +
per-column) + threshold color-bands; **chip columns** (newline-joined lists → pills);
per-bar category colors; ratio & list stat formats (+ per-segment colors); **stat
`valueColumn`** (several cards read one shared source row); SVG bar/pie charts +
multi-series line; **tabs / chips / dropdown filters**; the **`linkcard`** block
(People/PCO cards — 1+ people linking to PCO, note, tags); Undo (last 10);
re-seed-on-revision; and the decrypt-capable **data source** registry
(`builder-sources.ts`, cached per-render for graph-heavy sources).
