# Plan: telling a report which PCO things it is about

*Written 2026-09-15, after building the Ministry Impact Report pages.*

## The problem, measured

Every Ministry Impact Report page finds its data by **matching PCO names in
SQL**. A sweep of `src/lib/mir-metrics.ts` counts:

> **23 reports · 58 distinct hardcoded matches · 147 occurrences**

A representative sample:

| report | pinned by |
|---|---|
| ESL | `s.name LIKE '%english as a second language%'` |
| Foster & Adoption | `gt.name = 'Foster Adopt Care Communities'`, `s.name LIKE '%foster%'` |
| VBX | `e.name LIKE 'VBX%'` and `e.name <> 'VBX Middle School'` |
| Worship Classic | `st.name LIKE 'CLASSIC SERVICE%'`, `t.name LIKE '%chapel%'` |
| Human Resources | `l.name = 'REFERENCE - Church Staff'` |
| Small Groups | `gt.name = 'Small Groups'` (×9) |

Three things go wrong, and all three go wrong **silently**:

1. **A rename empties a chart.** Retitle the ESL signup to "ESL 2027" and the
   page reports zero students. No error, no warning — the report simply says the
   ministry did nothing.
2. **A new event never appears.** Create "Foster & Adoption: Spring Info Night"
   and it is counted, because that pattern is loose. Create "F&A Spring Night"
   and it is not. Which of those happens is an accident of wording.
3. **A loose pattern captures the wrong thing.** `t.name LIKE '%chapel%'` was
   written for the Chapel PrayerWorks teams. It would also match a team called
   "Chapel Chairs" the moment somebody makes one.

This is already not hypothetical. Three fixes made this month were this bug
wearing different clothes: the Discover courses needed *Discover Faith Church*
and *Discover Membership* excluded by name; VBX needed the 2019 middle-school
event excluded by name; ESL needs *ESL Teacher Training* excluded by name. Each
is a hand-maintained exception that a rename breaks.

## The fix: pools of PCO ids, not name patterns

One table. A **pool** is a named slot a report declares — "the signups that are
ESL students" — and the table says which PCO entities are in it.

```sql
CREATE TABLE report_sources (
  org_id      INTEGER NOT NULL,
  pool        TEXT    NOT NULL,  -- 'esl.students', 'vbx.weeks', 'hr.staff'
  entity_kind TEXT    NOT NULL,  -- registration_signup | checkin_event |
                                 -- group_type | list | service_type | team
  entity_id   TEXT    NOT NULL,  -- the PCO id
  added_at    TEXT    NOT NULL,
  PRIMARY KEY (org_id, pool, entity_kind, entity_id)
);
```

**Storing the id rather than the name is the whole point.** PCO ids survive
renames; names do not. That alone kills failure (1).

### It needs no change to how the pages are built

The concern with a per-org config is that the report SQL is a static string
compiled into the seed at module load, long before an org is known. It does not
matter — the lookup is a subquery, so the SQL stays static and the *data* varies
per org:

```ts
const inPool = (pool: string, kind: string) => `
  SELECT entity_id FROM report_sources
   WHERE org_id = :orgId AND pool = '${pool}' AND entity_kind = '${kind}'`;
```

```sql
-- before
WHERE lower(s.name) LIKE '%english as a second language%'
  AND lower(s.name) NOT LIKE '%teacher%'
-- after
WHERE s.pco_id IN (${inPool("esl.students", "registration_signup")})
```

The "not a teacher" exception disappears: the teacher-training signup is simply
not in the pool. Every hand-maintained exclusion above dissolves the same way.

### Declaring pools

Each report declares what it needs, next to its metrics:

```ts
pools: [
  { key: "esl.students", label: "ESL student registrations",
    kinds: ["registration_signup"],
    hint: "One signup per school year. Do NOT include teacher training." },
]
```

That declaration drives the settings UI on its own — no per-pool screen to
write, and a new report gets its configuration page for free.

## Migration: 147 occurrences without a flag day

1. **Seed from what is there now.** A one-off script resolves each existing
   pattern against live PCO data and writes the matching ids into
   `report_sources`. Every page keeps showing exactly what it shows today, and
   the mapping starts correct rather than empty.
2. **Convert one report at a time.** Swap its patterns for `inPool(...)` and
   check the numbers are unchanged before moving on. The harness used throughout
   this work — extract every block's SQL from the compiled seed, run it against a
   copy of production, compare — is exactly the check for this.
3. **Fall back while converting.** If a pool is empty, use the old pattern and
   show a warning on the page. Nothing can break mid-migration.

## The settings page

One screen, `Settings → Filters → Report sources`, grouped by report:

- Each pool lists its assigned entities, with a search to add more.
- **An "unassigned" panel is the part that earns its keep.** PCO entities whose
  names look like they belong to a pool but are not in it — fuzzy-matched
  against the pool's current members and its hint. This is what catches a new
  event: create "F&A Spring Info Night" and it appears as *suggested for Foster &
  Adoption events*, one click to confirm. Failure (2) becomes a prompt instead of
  a silent omission.
- **A health line per pool**: how many entities, when last changed, and a flag
  if a pool is empty or if an assigned id no longer exists in PCO (deleted event)
  — which also surfaces the reverse problem: a pool pointing at something gone.

## What this does not solve

- It does not decide *what* belongs in a pool. Somebody has to say that ESL
  Teacher Training is teachers, not students. It makes that decision explicit,
  reviewable and done once, rather than implicit in a `LIKE` pattern.
- Entity kinds not in the list above (person custom fields, membership types)
  stay as they are. `field_name = 'Baptism'` and `membership_type = 'Member'` are
  stable vocabulary, not per-ministry choices, and the complexity is not earned.
- `sunday_checkin_events` (migration 0083) is this idea's first instance, built
  before the general shape was clear. It should fold into `report_sources` as
  pool `sunday.attendance` when this lands, not stay a bespoke column.

## Effort

| phase | scope |
|---|---|
| 1 — schema + helper + seeding script | table, `inPool()`, resolve the 58 patterns to ids |
| 2 — settings page | one screen driven by pool declarations; the unassigned panel |
| 3 — convert 23 reports | one at a time, numbers verified unchanged against production |
| 4 — remove the fallbacks | once every pool is populated; delete `sunday_checkin_events` |

Phases 1 and 2 are the work. Phase 3 is mechanical but wants the
verify-numbers-unchanged discipline on each report, because a silently emptied
chart is precisely the failure being designed out.
