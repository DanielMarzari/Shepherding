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
| `/graph-new` | `-new` (slug `relationship-graph`) | overview stats + **interactive Network chart** (`relationship_graph`, capped 2,500 edges, names disambiguated) |
| `/intake-graph-new` | `-new` (slug `who-knows-who`) | know/present tabs + **interactive Network chart** (`intake_graph`) |
| `/constant-contact/dashboard-new` | `-new` (slug `email-dashboard`) | audience + open/click stats, open/click-%-over-time line, new-contacts bar, campaign-performance table (banded) — all SQL over `cc_*` |
| `/retention-new` | `-new` (slug `retention`) | retention stats + by-join-year + month-seasonality bars + cohort-decay **heatmap** (wraps `getRetention`) |
| `/pipeline-new` | `-new` (slug `group-pipeline`) | apply→join→attend median stats + over-time line + "where the time goes" **bubble** + by-type table (wraps `getGroupPipeline`; serving pipeline stays on `/pipeline`) |

Note: the ECharts network chart and the Leaflet map block **are** interactive
(drag / zoom / hover / pan / click) — the earlier "static" framing was wrong.
The only genuinely-interactive-only pieces are the bespoke tools below.

## 🟡 Quick follow-ups — reuse existing patterns (decrypt sources exist)

| Page | Plan |
|------|------|
| `/care-queue` | **original is mock data** (`@/lib/mock`) — needs real care logic first (`listCareCandidates` exists in care-read.ts) |
| `/reaching-the-valley` | member map + a small reach-context source (LV_CENSUS_META numbers) — feasible, just not built yet |

## 🟠 Complex analytics — not yet converted

| Page | Why |
|------|-----|
| `/pipeline` (serving side) | the serving pipeline needs a `:serviceType` param; only the group pipeline is converted so far |
| `/lanes/*` | community/serve lane pipelines (partly PII) |
| `/metrics` | mostly threshold/map/serving-form **settings** (writes) — keep hand-coded; could add a read-only KPI strip |
| `/movement` | **sankey** from movement/classification transitions — feasible if desired |

## 🚫 Intentionally excluded / bespoke-interaction-only

| Page | Why |
|------|-----|
| `/next-campus-planner` | **excluded** (Dan, confirmed 2026-07-29) — flagship draw-to-test / isochrone / LVPC tool; a builder page can't host it |
| `/care-map`, `/shepherd-map` | drag-to-assign / isochrone editing — inherently interactive write tools |

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
