# Roadmap / bookmarked features

Features we've scoped but parked because they need data we don't reliably
have synced yet. Each notes exactly what's required to build it.

## Assimilation funnel  (→ Next steps nav)

**Goal:** From the moment a PCO profile is created, how does a person
connect with us? The path into groups and teams, when they start giving,
where they drop off.

**Stages (what we'd chart):** profile created → first form / next-step
→ first group → first serve (team) → first gift → ongoing.

**Data status:**
- Profile created — have it (`pco_people.pco_created_at`).
- First group — have it (`pco_group_memberships.joined_at`).
- First serve — have it (`pco_plan_people` + `pco_plans.sort_date`).
- First form / next-step — partial (forms sync is limited).
- First gift — **missing** (no giving data; see below).

**Blocker:** we're not yet sure how people are actually entering (no clear
"first touch" event), and giving isn't synced. Confirm the intended funnel
stages, then build the stages we have and leave giving as a final stage
that lights up once Giving syncs. Likely a big build.

## Touchpoints  (→ Dashboard tabs)

**Goal:** Pastoral touchpoints — this week's **birthdays**, **anniversaries**,
and milestone years ("N years since baptism", "N years a member").

**Data status:**
- Birthdays — have it (`birthdate` in `enc_pii`). Buildable today.
- Baptism date / membership date — under PCO **Custom Tabs → Membership and
  Assimilation → Notable Dates (baptism)**. **Not synced**, and some of it
  is missing/dirty in PCO and needs cleanup first.

**Blocker:** add the Notable Dates custom field to the PCO sync, then
backfill/clean the data in PCO. Birthdays alone could ship sooner if we want
a partial version.

## Baptisms & new memberships  (→ Next steps nav)

**Goal:** Recent baptisms and new members as a follow-up/celebration list.

**Data status:** depends on the same baptism date + membership date Notable
Dates fields as Touchpoints — **not synced**, partly missing.

**Blocker:** same as Touchpoints — sync + clean the Notable Dates fields.

## Giving vs. attendance  (→ Attendance page)

**Goal:** Correlate weekly giving against weekly attendance, and
per-attender giving over time.

**Blocker:** no giving data source connected (PCO Giving not synced).
(Also bookmarked in `src/lib/attendance-family.ts`.)
