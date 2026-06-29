# Proposal: Build Faith Church's Member-Engagement System (vs. buying StudioC)

**Prepared for:** Faith Church leadership
**Date:** June 2026
**Author:** Dan Marzari / Shepherdly
**Status:** Proposal for decision

---

## 1. Executive summary

We propose continuing to build **Shepherdly** — our in-house engagement dashboard — into a full
member-engagement system, rather than purchasing a boxed platform (StudioC). We have already built
the hard, differentiated half (knowing our people and measuring movement); the remaining work is the
"act" half (a defined discipleship pathway, a per-person next-step engine, and connecting our existing
channels). We will integrate the four systems Faith Church already pays for — **Planning Center (PCO),
Pushpay, Constant Contact, and Subsplash** — so data flows in and action flows out, without handing
member data to a third party.

**The economics:** boxed church-engagement platforms recur at **several thousand to low five figures
per year** (typically per-member or tiered). Our recurring cost is essentially **server hosting +
domain — on the order of ~$65–$310/year** — on top of in-house development we are already doing.

**Recommendation:** approve continued in-house build; integrate (don't rebuild) the messaging
channels; move off the flaky 1 GB free box to a right-sized managed VPS (Hetzner ~$65–$310/yr) plus a
~$10/yr domain.

---

## 2. The opportunity

The StudioC seminar framed engagement as a **GPS for discipleship** with four parts: a **Pathway**
(the journey we want people on), **Data** (knowing each person), **Messaging** (the right nudge, on
the right channel, at the right time), and **Analytics** (measuring *next steps*, not just attendance
and giving). Their thesis — borne out across the churches they cited — is that **engagement drives
attendance and giving** (their examples: +57% giving, +25% attendance from an engagement push), and
that the leverage is in **personalization at scale**: augmenting the pastoral handshake for the
dozens of people who walk past to the parking lot every week.

**Where Faith Church stands today (Shepherdly):** we are already strong on **Data** and **Analytics**,
arguably deeper than the boxed product — PCO sync and classification, per-person activity, retention
decay / returns / lane analysis, geographic reach + census, campus planning, and the "who do you know"
relational graph. **Our gap is the act half:** we observe and measure, but we don't yet turn that into
a defined pathway, a per-person next step, and a nudge.

---

## 3. What we propose to build

Building on what already runs:

1. **A configurable engagement Pathway** — the church defines its steps (attend → commit/baptism →
   group → serve → give → share → lead). Completion is **auto-derived from data we already sync**, so
   every member has a live position on the journey. (This is the single highest-leverage piece — the
   "one slide" that gives every event and conversation a "who is this for / what's the next step?")
2. **A per-person next-step engine (staff-facing first)** — for each person, the single most relevant
   next step and *why*. Plus an **at-risk list** (who's disengaging, why, suggested intervention) built
   on our existing retention/lane analytics, with interventions **tracked closed-loop**.
3. **Next-steps measurement** — "total next steps taken," per-step goals, and progress over time,
   added to the analytics we already have. The metric the seminar says reshapes culture beyond
   "nickels and noses."
4. **Messaging via integration, not rebuild** — generate targeted, dynamic segments and hand them to
   the channels we already own (email + the app), then read engagement back to close the loop.
5. **(Later, optional) a member-facing surface** — each person seeing their own pathway + one-tap next
   step. This is the largest build and where a boxed product's value is highest; we'd lean on the
   existing Subsplash app before building our own.

---

## 4. Why build vs. buy StudioC

**Reasons to build (strong):**
- **We already own the hard half.** The boxed pitch is mostly *knowing people + measuring movement* —
  which we do, deeper. Buying means paying for what we have and *losing* our differentiated analytics
  (retention decay, geographic reach, census, campus siting, the relational graph).
- **Data ownership + trust posture.** PCO as source of truth, HMAC'd PII, self-hosted, no plaintext
  emails. A vendor means handing member data to a third party and adopting their practices — including
  the purchased "likely-to-divorce" broker targeting we would decline on principle.
- **Fit.** Faith-specific features (room/service-time attendance, the lane model, valley reach, campus
  planning) are bespoke and already live. A box won't model them.
- **Recurring cost.** Per-member SaaS compounds with a large church; we've already built the expensive
  parts, and our recurring cost is essentially hosting.

**Honest tradeoffs (where the box wins):**
- The **messaging + member-app** layer is real engineering (deliverability, journeys, an app) and is
  where we're starting from zero — which is exactly why we propose to **integrate** existing channels
  rather than build them.
- **Time-to-value** is faster off-the-shelf; our build is incremental over months.
- **Cross-church benchmarking** is a network effect a single church can't replicate (defer).

**Conclusion:** hybrid — build Pathway + Data + Analytics + the next-step engine; integrate the
messaging channels; revisit "buy" only if a rich member-facing app becomes the top priority.

---

## 5. Integrations

All four are systems Faith Church already uses, so this is connecting, not adding vendors.

| System | Role | What we pull / push | Feasibility |
|---|---|---|---|
| **Planning Center (PCO)** | Source of truth (people, groups, teams, check-ins, attendance, forms) | People, membership, activity → classification & pathway completion | **Live today.** |
| **Pushpay** | Giving | Per-payer giving signals → engagement/at-risk model; "giving" pathway step | **REST API + webhooks** ([pushpay.io](https://pushpay.io/docs/introduction)). Requires contacting their API support to enable. |
| **Constant Contact** | Email touch points | Push targeted segments → send; pull **per-contact opens/clicks/bounces** back | **v3 REST API** (OAuth2), contacts/lists/campaigns + per-contact tracking ([developer.constantcontact.com](https://developer.constantcontact.com/docs/contact-tracking/click-activities-report.html)). |
| **Subsplash** (Faith Church app) | Member channel + intent signals | App opens, content consumption, push tokens → the per-person "intent" data we currently lack | **Engagement API + CSV export** ([Subsplash API](https://support.subsplash.com/en/articles/11610463-subsplash-api)). Verify per-person granularity + access tier on our plan. |

Net effect: PCO + Pushpay feed *who people are and what they do*; Constant Contact + Subsplash become
the *outbound channels* and feed back *engagement/intent* — closing the GPS loop.

---

## 6. Infrastructure & hosting

**Today:** the system runs on an Oracle Cloud **free 1 GB** instance behind Caddy. That box is already
the bottleneck — we've hit out-of-memory/timeout issues on the heavier pages (it's why we added
nightly precomputes and caching). It is not adequate for adding messaging + more integrations.

**Architecture note (why a single bigger box, not "more servers"):** the app is intentionally
self-hosted on **SQLite (better-sqlite3)** with the routing engine (OSRM) co-located. This is fast and
cheap but is a **single-box, vertical-scaling** design — the right move is *one right-sized server*,
not a cluster. ~8 GB RAM / 4 vCPU comfortably covers PCO data (~33k people), OSRM, census, and the new
engagement workload.

### Options & estimated yearly cost

We have hit real friction on Oracle's free tier (finicky setup/capacity, and Oracle *quietly cut* it
from 4 OCPU/24 GB to 2/12 in June 2026 with no notice — [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)).
So the plan is a **right-sized, guaranteed-capacity x86 VPS** — the opposite of a flaky free ARM box.

| Option | Spec | Yearly cost | Notes |
|---|---|---|---|
| **Hetzner CPX31** ⭐ best value | 4 vCPU / 8 GB / 160 GB | **~$300** | Best price/performance + reliable; the responsive target. US + EU regions (US pricing rose mid-2026 to ~$25/mo — [Hetzner](https://www.hetzner.com/news/new-cx-plans/)). |
| **Hetzner CX22** | 2 vCPU / 4 GB / 40 GB | **~$55–60** | Cheapest serious VPS (~$4.59/mo); workable minimum, snug once messaging + OSRM grow. |
| **DigitalOcean** ⭐ easiest | 4 vCPU / 8 GB | **~$576** (4 GB ~$288) | Most polished console, 1-click snapshots/backups, strong docs/support — the no-fuss option. |
| **Linode / Vultr / AWS Lightsail** | 8 GB | **~$530–580** | DO-equivalent; pick on region/preference or AWS ecosystem. |
| Oracle Ampere (free) | 2 OCPU / 12 GB | $0 | The tier we fought with — keep only as a free fallback, not the plan. |

**Domain:** **Cloudflare Registrar** (~$10–11/yr at-cost for .com + free DNS/SSL) recommended; Porkbun
or Namecheap (~$10–15/yr) also fine. (We already run `shepherdly.danmarzari.com`; a dedicated
church-facing domain is optional.) **Off-site backups:** object storage or a second micro instance,
~$10–30/yr.

**Recommendation:** **Hetzner CPX31 (8 GB / 4 vCPU, ~$25/mo)** for the best balance of power,
reliability, and cost — or **DigitalOcean** if we'd rather pay a premium for the smoothest setup and
managed backups. 8 GB gives comfortable headroom for OSRM + the new messaging workload; 4 GB is the
workable minimum. **Total realistic recurring infrastructure cost: ~$65/yr (CX22 + domain) on the low
end, ~$310/yr (CPX31 + domain) for the responsive target, up to ~$590/yr on DigitalOcean.**

---

## 7. Cost comparison

| | Boxed (StudioC) | Build in-house (this proposal) |
|---|---|---|
| Recurring software | Several $k–low-five-figures/yr (per-member/tiered; not public) | $0 |
| Hosting + domain | included | **~$65–$310/yr** |
| Member data | held by vendor | **owned, self-hosted** |
| Differentiated analytics | replaced by their model | **kept + extended** |
| Build effort | none | in-house dev (already underway) |

The recurring economics favor building by **thousands of dollars per year**; the cost we trade is
in-house development time, which is already being invested.

---

## 8. Risks & mitigations

- **Free-tier instability** (Oracle cut limits without notice) → plan the paid Hetzner path; keep
  infrastructure as code so migration is hours, not days.
- **Single-box / single point of failure** → automated daily off-site DB backups; the SQLite file is
  small and trivially restorable.
- **Integration access** (Pushpay/Subsplash API tiers, Subsplash per-person granularity) → confirm via
  short spikes before committing the messaging roadmap.
- **Messaging done badly is harmful** (the seminar's "best year of your life" to a new widow) → strict
  segmentation rules + human review on sensitive sends; lean on our existing privacy discipline.
- **Key-person dependency** (in-house build) → documentation + the repo already being version-controlled
  and deployable.

---

## 9. Phased roadmap

1. **Infra:** move off the 1 GB box → a right-sized VPS (Hetzner CPX31, or DigitalOcean) + domain. *(days)*
2. **Pathway + next-steps metric** on the data we already have. *(near-term)*
3. **Per-person next-step engine + at-risk list**, staff-facing. *(near-term)*
4. **Pushpay integration** (giving signals into the model). *(spike, then build)*
5. **Constant Contact integration** (segments out, engagement back) — first real messaging loop.
6. **Subsplash integration** (app opens/intent in; pathway/CTAs out). *(pending API verification)*
7. **Paid host (Hetzner)** when messaging goes live + responsiveness matters.
8. **(Optional, later)** member-facing pathway surface; cross-church benchmarking.

---

## 10. Recommendation / ask

Approve (a) continuing the in-house build per the roadmap above, (b) integrating PCO, Pushpay,
Constant Contact, and Subsplash rather than buying a boxed platform, and (c) a small infrastructure
budget — a right-sized managed server (**~$65–$310/year**, Hetzner) plus a **~$10/year domain** — to
replace the flaky free box. The result is a system tailored to Faith Church, that keeps member data in our
hands, extends analytics we already lead on, and avoids thousands per year in recurring SaaS fees.

---

_Sources: Pushpay Developer Portal (pushpay.io), Constant Contact v3 API
(developer.constantcontact.com), Subsplash API/App Analytics (support.subsplash.com), Oracle Cloud
free-tier change (linuxiac.com), Hetzner Cloud pricing (hetzner.com). Captured June 2026._
