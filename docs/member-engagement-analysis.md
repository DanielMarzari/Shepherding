# Member Engagement — StudioC seminar analysis & path forward

> Notes from the StudioC ("Blue", ex-Mercedes/agency marketer, ex-XP of a ~37k church)
> member-engagement seminar, mapped against Shepherdly. Written as strategy reference.

## The framework (the yardstick)

Guide people from **passive attender → active contributor → advocate who brings others.**
Do it like a **GPS for discipleship**, which needs four parts:

1. **Pathway** — a defined, *aligned*, church-owned engagement journey
   (aware → consider → evaluate → known → baptized/group/serve/give/share → disciple-maker).
   Key finding: churches are clear on values/vision/mission but go silent on **strategy**, and
   most events can't answer *"who is this for / what's the next step?"*
2. **Data** — a per-person *persona* (demographics, church engagement, **spiritual gifts/traits**),
   aggregated from everywhere and organized **around the person**, not around groups/events.
3. **Messaging** — *personalized, targeted, omni-channel communication journeys* (mobile-app-primary),
   one-tap CTAs, "for-you" recognize-and-encourage messages, drip campaigns, event tiers, and
   **predictive targeting** (who'll leave; who to reach). Mantra: *"an irrelevant message is not
   neutral — it's negative."* Avg **7–14 touch points** before a member takes an action.
4. **Analytics** — measure **next steps, not just "nickels & noses"**, set per-step goals, track
   *movement over time*, eventually **benchmark across churches**.

Growth thesis: spend ~70% of effort on existing members; **engagement drives attendance + giving**
(his 3 churches: +57% giving, +25% attendance from an engagement push). Caveat he stresses hard:
bad segmentation is harmful (the widow who got "this will be the best year of your life" the morning
after her husband's memorial). Methodology ran **3 years with zero technology** — software is the
*lever for personalization at scale*, not the insight.

---

## (1) What Shepherdly lacks

We are strong on two pillars, largely absent on two.

**Strong (Data + Analytics, staff-facing):** PCO sync, classification
(shepherded/active/present/inactive), `person_activity`, group/team membership, check-ins,
attendance, giving signals, **geographic reach + census** (Reaching-the-Valley, campus planner),
and a **relational graph** (/know). Our retention decay / returns / lanes-exit and reach analytics
are *more sophisticated* than anything in the deck.

**Gaps:**
- **The entire Messaging pillar is missing.** We observe & analyze; we don't *communicate to
  members*. No targeted messaging, CTAs, journeys/drip, or omni-channel (email/text/app). We built
  the part of the GPS that knows where everyone is — not the display that says "turn here."
- **No member-facing surface.** Everything is admin/shepherd-facing. The seminar's centerpiece —
  a member seeing *their own* pathway + next step + one-tap CTA — doesn't exist for us. /know is the
  closest, but it's shepherd→member.
- **No first-class, configurable Pathway object.** We have *lanes* (worship/community/serving) +
  classification — conceptually close — but not a church-defined step checklist with per-person
  completion state shown as a journey. Our data could derive it; we don't model it.
- **"Next steps" isn't a measured metric or a goal** (no "total next steps taken", per-step goals,
  progress-to-goal) — the cultural keystone he pushes.
- **No per-person intent signals or closed-loop interventions.** We track *activity* (attended,
  served, checked-in), not *intent* (clicked baptism info 3×). Our retention-decay/returns/lane-exit
  is a churn model in aggregate, but not surfaced per-person as "this individual is disengaging, here's
  why, here's the intervention" with the intervention *tracked*.
- **No spiritual-gifts/traits in the persona.**
- **No cross-church benchmarking** (multi-tenant; later).

---

## (2) What existing software does

- **StudioC** operationalizes all four pillars as a **member-engagement layer on top of a ChMS**:
  member **mobile app** showing pathway + position + CTA buttons; **targeted omni-channel messaging**
  with journeys/drip/event-tiers; **predictive** churn ("57% of those we predicted left within 6
  months") and acquisition (divorce-prediction → marriage conference) models; **per-person engagement
  tracking** (badge clicks → pastor call); **next-steps analytics + goals + cross-church benchmarking**.
  Moat = *scaling personalization* ("augment the handshake when 54 people walk past to the parking lot").
- **ChMS (PCO, which we already integrate)** holds the raw data + basic workflows/blast email; most
  churches use it as a static directory and shotgun everyone — the gap StudioC sells into.

---

## (3) Path forward (sequenced: lowest-lift / highest-alignment first)

We're not behind on the hard part — we already *know the people* better than his stack. Our gap is the
**"act" half**: turn knowledge into the right nudge.

1. **Make the engagement Pathway a first-class, configurable object** and auto-derive completion from
   data we already sync (map steps → classification/lanes/activity). We're uniquely positioned because
   we already compute who's done what. This is his "one PowerPoint slide" — the keystone.
2. **Add "next steps" to analytics we already have** ("total next steps taken", per-step goals,
   progress over time) — slots into the Retention page. Cheap, high cultural payoff.
3. **Per-person "next step" engine, staff-facing first** — for each person, the single most relevant
   next step + why ("intelligent armed conversation without being in the room"). Rides on /know + the
   care map; no member app required. Productize retention-decay/returns/lane-exit into an **at-risk
   list with reason + suggested intervention**, and track whether the intervention happened (closed loop).
4. **Messaging — feed, don't replace (at first).** Generate targeted, dynamic *segments* ("next step =
   group, Center campus, active") that export into an email tool (see Constant Contact below) and/or
   PCO automations, before building native omni-channel. Heed the segmentation cautions; we're already
   disciplined on trust (HMAC emails, no plaintext PII).
5. **Member-facing surface (optional, biggest build)** — personalized portal/app showing pathway +
   CTAs. StudioC's real moat; could lean on the existing Subsplash app rather than build one.
6. **Cross-church benchmarking — later** (multi-tenant).

**Net:** the seminar validates our direction and exposes one strategic hole. We've over-invested in
*measurement/knowing* and under-invested in *communicating the next step*. Fastest credible move:
formalize the **Pathway** + **per-person next-step engine** on the staff side.

---

## Integrations & data sources (research notes)

### Public marriage/divorce data (his predictive targeting)
- **Court records are public + free to *view*.** PA divorce records live with the **Prothonotary of the
  Court of Common Pleas** per county; the **Unified Judicial System online case search** is free
  (search by name/date/docket). Copies ~$0.25/page; some records sealed by petition. **Not bulk/queryable**
  for free — fine for one-off lookups, useless for "score the whole county."
- **His actual method wasn't court records.** "Books they read, websites they visit" = **third-party
  consumer-data brokers / programmatic ad audiences** (Experian/Acxiom-type append + ad-platform
  targeting). That's paid, and **ethically/PR loaded for a church** (buying "likely to divorce" lists).
- **Recommendation:** skip individual-level predictive *acquisition* off purchased data. The defensible,
  free version we already do is **aggregate/geographic** targeting (Reaching-the-Valley census). For
  *retention* prediction, use our **own first-party** signals (we already have the churn analytics) —
  no broker data, no privacy/PR exposure.

### Constant Contact (email touch points / campaigns)
- **Yes, viable.** Constant Contact **v3 REST API** (OAuth2) covers **contacts, lists, email campaigns,
  and per-contact tracking** (opens, clicks, bounces, forwards) — exactly the "touch point" loop the
  seminar describes.
- **Fit:** we push dynamic segments → Constant Contact sends → we pull back per-contact open/click
  tracking to feed the engagement model (closes the loop, app-side). Good interim Messaging layer
  without building our own sender.

### Subsplash (Faith Church app — apps.apple.com/.../faith-church-pa)
- **Yes, there is an API** — Subsplash exposes a **Media Management API** and, importantly, an
  **Engagement API** (user activity, **app opens, content consumption, push-notification tokens**),
  plus **CSV export** of app analytics. They also support ChMS sync / Zapier.
- **Caveats to verify:** API access tier/cost, whether the Engagement API exposes **per-person**
  events (vs. aggregate analytics), and auth/scopes. This is the channel that could give us the
  per-person "intent" signals we currently lack (badge/app interaction) — *if* per-person granularity
  is available on our plan.
- **Recommendation:** scope a spike — confirm per-person engagement events + push tokens are
  retrievable, then sync into `person_activity` as new intent signals.

### (5) Build custom vs. buy the box (StudioC)

**Reasons to keep building custom:**
- **We already own the hard half.** StudioC's pitch is mostly *knowing people + measuring movement* —
  which we already do, deeper (retention decay, returns, lanes, geographic reach, census, campus
  siting, the relational /know graph). Buying the box means *paying for what we have* and *losing* our
  differentiated analytics.
- **Data ownership + privacy posture.** Our model (PCO as source of truth, HMAC'd PII, self-hosted
  SQLite, no plaintext emails) is a deliberate trust stance. A boxed vendor means handing member data
  to a third party and adopting *their* data practices (including, in StudioC's case, the broker-data
  targeting we'd reject).
- **Fit + flexibility.** Faith Church specifics (room/service attendance, lane model, census reach,
  campus planning) are bespoke and already live. A box won't model them.
- **Cost trajectory.** Per-seat/per-member SaaS for a large church compounds; we've already built the
  expensive parts.

**Reasons the box wins (be honest):**
- **The Messaging pillar + member app is real engineering** (omni-channel sender, deliverability,
  journeys, a member-facing app). That's where StudioC's moat is and where we're at zero.
- **Time-to-value:** they ship personalized member comms now; we'd build for months.
- **Cross-church benchmarking** is a network effect we can't replicate single-tenant.

**Recommendation (hybrid):** keep custom for **Pathway + Data + Analytics + next-step engine** (our
strengths), and **integrate rather than build** the Messaging pillar — Constant Contact for email
touch points, Subsplash for the member app + intent signals. Revisit "buy the box" only if the
member-facing experience becomes the priority and integration proves insufficient.

---

_Sources: Constant Contact v3 API (developer.constantcontact.com), Subsplash API/App Analytics
(support.subsplash.com), PA Unified Judicial System public records (pacourts.us) — captured
June 2026 for reference._
