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
| `/people-new` | `-new` | classification stats + directory table (decrypted names via `people_directory` source) |
| `/staff-new` | `-new` | staff count + directory via `staff_directory` source (the "REFERENCE - Church Staff" list) |

## 🟡 Quick follow-ups — reuse existing patterns (decrypt sources exist)

| Page | Plan |
|------|------|
| `/shepherds` | shepherd roster source (names + flock + overseer) — original is a hierarchy view |
| `/audit/duplicates` | count + a duplicate-pairs source (names) |
| `/care-queue` | **original is mock data** (`@/lib/mock`) — needs real care logic first (`listCareCandidates` exists in care-read.ts) |

## 🟠 Complex analytics — need their TS logic ported to SQL/sources (bigger)

| Page | Why |
|------|-----|
| `/retention` | cohort decay / seasonality — multi-step retention math |
| `/pipeline` | interest→action funnel timing, cohorted by month |
| `/attendance` | weather, forecast, seasonal, holiday, preacher analytics |
| `/lanes/*` | community/serve lane pipelines (partly PII) |
| `/metrics` | mostly threshold/map/serving-form **settings** (writes) — keep hand-coded; could add a read-only KPI strip |

## 🔵 Interactive / bespoke — need builder map/graph blocks (data is SQL-able)

| Page | Builder path |
|------|--------------|
| `/map`, `/care-map`, `/shepherd-map`, `/reaching-the-valley` | the **map block** (points from `geocode_cache` / member geo) — no drag/isochrone |
| `/graph`, `/intake-graph` | **network** chart from `shepherd_known_people` |
| `/movement` | **sankey** chart from movement/classification transitions |

These render *static* approximations of the interactive originals; the drag-to-test
map and live force-graph aren't expressible as builder blocks.

## ⚪ Keep hand-coded — not dashboards (OAuth / config / write / uploads)

`/constant-contact*`, `/pushpay`, `/subsplash`, `/pco*`, `/mir*` (PDF upload),
`/audit/names` (write actions), `/more` (menu), `/lanes` editors, and the various
`*-original` / example routes. A builder page is read-only and can't host connect
flows or mutating forms.

## Capabilities built for this remodel
Table density; 12-col grid (fractional widths); preset text colors (whole-element +
per-column) + threshold color-bands; per-bar category colors; ratio & list stat
formats (+ per-segment colors); Undo (last 10); re-seed-on-revision; and the
decrypt-capable **data source** registry (`builder-sources.ts`).
