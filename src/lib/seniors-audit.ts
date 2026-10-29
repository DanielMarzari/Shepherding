import "server-only";
import { getDb } from "./db";
import {
  STANDING_ORDER,
  type SeniorSignal,
  type AgeSource,
  type EmailSource,
  type EventSource,
  type PickerOption,
  type SeniorRow,
  type SeniorsSelection,
  type Standing,
  type WorkingList,
  EVENT_PICKER_YEARS,
  OPEN_WINDOW_MONTHS,
} from "./seniors-audit-shared";
import {
  getSeniorsAgeMin,
  getSeniorsCcLists,
  getSeniorsCheckinEvents,
  getSeniorsGroupTypes,
  getSeniorsGroups,
  getSeniorsSignups,
} from "./pco";
import { NICKNAMES, editDistance, fullNameKey, normNamePart } from "./name-match";

/** The seniors audit: three sources, then one list.
 *
 *  Email says who the ministry already writes to and whether they read
 *  it. Age says who is old enough to belong whether or not anybody has
 *  asked them. Events says who has actually turned up. None of the three
 *  answers the question on its own — the point of merging them is the
 *  people who appear in one and not the others.
 *
 *  Nothing is inferred from names; the events source is empty until
 *  somebody ticks what counts, which is honest rather than wrong.
 */

export function getSeniorsSelection(orgId: number): SeniorsSelection {
  return {
    ccLists: getSeniorsCcLists(orgId),
    signups: getSeniorsSignups(orgId),
    checkinEvents: getSeniorsCheckinEvents(orgId),
    groupTypes: getSeniorsGroupTypes(orgId),
    groups: getSeniorsGroups(orgId),
    ageMin: getSeniorsAgeMin(orgId),
  };
}


const ph = (xs: unknown[]) => xs.map(() => "?").join(",");
const nameOf = (f: string | null, l: string | null, id: string) =>
  [f?.trim(), l?.trim()].filter(Boolean).join(" ") || `(unknown #${id})`;

/** Alive and not inactive in PCO. Deceased is carried by the inactive
 *  reason rather than a status, which is why both are tested. */
const ALIVE_SQL = `
  p.inactivated_at IS NULL
  AND LOWER(COALESCE(p.status,'')) <> 'inactive'
  AND COALESCE(p.inactive_reason,'') NOT LIKE '%eceas%'
  AND NOT EXISTS (
    SELECT 1 FROM pco_person_fields d
     WHERE d.org_id = p.org_id AND d.person_id = p.pco_id
       AND d.field_name = 'Date of Death' AND d.value_on IS NOT NULL)`;


/** Is there any sign of this person in PCO, and when was the last one.
 *
 *  Reads the snapshot's five lane flags and collapses them: which lane it
 *  was does not change what this page does next. Re-deriving them here is
 *  how two pages end up disagreeing about whether somebody serves, so the
 *  flags are taken as given.
 */
function pcoSignals(
  orgId: number,
  ids: string[],
): Map<string, { pco: boolean; lastActivityAt: string | null }> {
  const out = new Map<string, { pco: boolean; lastActivityAt: string | null }>();
  if (ids.length === 0) return out;
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db
      .prepare(
        `SELECT person_id AS id, last_activity_at AS last,
                (in_worship_lane + in_serving_lane + in_community_lane
                 + in_giving_lane + in_outreach_lane) AS lanes
           FROM person_activity
          WHERE org_id = ? AND person_id IN (${ph(chunk)})`,
      )
      .all(orgId, ...chunk) as Array<{
      id: string;
      last: string | null;
      lanes: number;
    }>) {
      out.set(r.id, { pco: r.lanes > 0, lastActivityAt: r.last });
    }
  }
  return out;
}

const NO_SIGNALS: Record<SeniorSignal, boolean> = { pco: false, email: false };

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

// ── source 1: the mailing list ───────────────────────────────────────

/** A name typed in capitals, or all in lower case, put into ordinary case.
 *  Constant Contact keeps whatever was typed into a sign-up form, and
 *  "ALAN RAIN" in a list of names reads as shouting. A name already in mixed
 *  case is left alone — "McDonald" knows better than any rule here. */
function tidyName(s: string): string {
  if (!/[a-z]/i.test(s)) return s;
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/\bMc(\p{L})/gu, (_, c: string) => "Mc" + c.toUpperCase());
}

/** First names close enough to be the same person, once the surname is
 *  already the same. Stricter than the duplicate audit's rule: spouses share
 *  a surname and often an inbox, so "Jean" must not meet "Joan" on a
 *  one-letter difference, nor "Dan" meet "Danielle" by being the start of
 *  it. A known nickname (Bob / Robert) and a typo in a longer name (Kathryn /
 *  Katheryn) are what this lets through. */
function sameFirstName(a: string, b: string): boolean {
  if (a === b) return true;
  if ((NICKNAMES[a] ?? []).includes(b) || (NICKNAMES[b] ?? []).includes(a)) return true;
  return a.length >= 5 && b.length >= 5 && a[0] === b[0] && editDistance(a, b) <= 1;
}

/** Contacts the email address could not place, placed by name instead.
 *
 *  The address on the mailing list is often not the one on the PCO record —
 *  an old one, a child's, the one somebody typed into a paper form — so a
 *  person PCO knows perfectly well shows up as a stranger. Their name is the
 *  other thing both systems have.
 *
 *  Only a name that points at exactly one person counts. An exact name is
 *  tried first; a nickname or a shortening only when nobody has the exact
 *  name. Somebody alive in PCO beats an inactive record of the same name, so
 *  one long-gone namesake does not stop a match — but two live people with
 *  the name is two people, and that contact stays unmatched.
 *
 *  Read-time only. The sync's own link is by address and stays that way;
 *  this is a judgement made for this page, not a fact written down.
 */
function matchByName(
  orgId: number,
  contacts: Array<{ contactId: string; first: string | null; last: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  const wanted = contacts
    .map((c) => ({
      id: c.contactId,
      first: normNamePart(c.first),
      last: normNamePart(c.last),
      full: fullNameKey(c.first, c.last),
    }))
    .filter((c) => c.first.length >= 2 && c.last.length >= 2);
  if (wanted.length === 0) return out;

  // Narrow by surname in SQL — the raw spelling and the normalized one, so
  // "RAIN" and "O'Neil" both find their people — and judge the rest here.
  const surnames = new Set<string>();
  for (const c of contacts) {
    if (c.last?.trim()) surnames.add(c.last.trim().toLowerCase());
  }
  for (const w of wanted) surnames.add(w.last);
  const names = [...surnames];

  type Person = { id: string; forms: string[]; last: string; full: string[]; alive: boolean };
  const byLast = new Map<string, Person[]>();
  const db = getDb();
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    for (const p of db
      .prepare(
        `SELECT p.pco_id AS id, p.first_name AS f, p.last_name AS l,
                p.nickname AS nick, p.legal_first_name AS legal,
                CASE WHEN ${ALIVE_SQL} THEN 1 ELSE 0 END AS alive
           FROM pco_people p
          WHERE p.org_id = ? AND LOWER(TRIM(p.last_name)) IN (${ph(chunk)})`,
      )
      .all(orgId, ...chunk) as Array<{
      id: string;
      f: string | null;
      l: string | null;
      nick: string | null;
      legal: string | null;
      alive: number;
    }>) {
      const last = normNamePart(p.l);
      // PCO keeps up to three first names for one person — first, nickname,
      // legal — and the form somebody signs up with can be any of them.
      const forms = [...new Set([p.f, p.nick, p.legal].map(normNamePart).filter(Boolean))];
      if (!last || forms.length === 0) continue;
      const list = byLast.get(last) ?? byLast.set(last, []).get(last)!;
      if (list.some((x) => x.id === p.id)) continue;
      list.push({
        id: p.id,
        forms,
        last,
        full: forms.map((f) => fullNameKey(f, p.l)),
        alive: p.alive === 1,
      });
    }
  }

  // One person, or nobody: never a guess between two.
  const pick = (cands: Person[]): string | null | "ambiguous" => {
    if (cands.length === 0) return null;
    const alive = cands.filter((p) => p.alive);
    const pool = alive.length > 0 ? alive : cands;
    return pool.length === 1 ? pool[0].id : "ambiguous";
  };

  for (const w of wanted) {
    const cands = byLast.get(w.last) ?? [];
    const exact = pick(cands.filter((p) => p.full.includes(w.full)));
    if (exact === "ambiguous") continue;
    if (exact) {
      out.set(w.id, exact);
      continue;
    }
    const near = pick(cands.filter((p) => p.forms.some((f) => sameFirstName(f, w.first))));
    if (near && near !== "ambiguous") out.set(w.id, near);
  }
  return out;
}

export function getEmailSource(orgId: number): EmailSource {
  const db = getDb();
  const listIds = getSeniorsCcLists(orgId);
  const empty: EmailSource = {
    lists: [],
    contacts: 0,
    matched: 0,
    matchedByName: 0,
    unmatched: 0,
    campaigns: 0,
    sends: 0,
    opens: 0,
    openers: 0,
    rows: [],
    unnamed: 0,
  };
  if (listIds.length === 0) return empty;

  const lists = db
    .prepare(
      `SELECT list_id AS id, name, COALESCE(membership_count,0) AS contacts
         FROM constant_contact_lists
        WHERE org_id = ? AND list_id IN (${ph(listIds)})
        ORDER BY name COLLATE NOCASE`,
    )
    .all(orgId, ...listIds) as Array<{
    id: string;
    name: string | null;
    contacts: number;
  }>;

  // Campaigns actually sent to one of these lists, in the window. Sent,
  // not merely created: a draft nobody received is not a touch.
  const campaigns = db
    .prepare(
      `SELECT DISTINCT c.campaign_activity_id AS aid,
              COALESCE(c.stat_sends,0) AS sends,
              COALESCE(c.stat_opens,0) AS opens
         FROM constant_contact_campaigns c
         JOIN constant_contact_campaign_lists cl
           ON cl.org_id = c.org_id
          AND cl.campaign_activity_id = c.campaign_activity_id
        WHERE c.org_id = ? AND cl.list_id IN (${ph(listIds)})
          AND c.last_sent_at IS NOT NULL
          AND c.last_sent_at >= date('now','-${OPEN_WINDOW_MONTHS} months')`,
    )
    .all(orgId, ...listIds) as Array<{
    aid: string | null;
    sends: number;
    opens: number;
  }>;
  const aids = campaigns.map((c) => c.aid).filter((a): a is string => !!a);

  const listName = new Map(lists.map((l) => [l.id, l.name ?? "(unnamed list)"]));
  const contacts = db
    .prepare(
      `SELECT c.contact_id AS contactId, c.person_id AS personId,
              p.first_name AS pf, p.last_name AS pl,
              c.first_name AS cf, c.last_name AS cl,
              GROUP_CONCAT(m.list_id) AS listIds
         FROM constant_contact_list_memberships m
         JOIN constant_contact_contacts c
           ON c.org_id = m.org_id AND c.contact_id = m.contact_id
         LEFT JOIN pco_people p
           ON p.org_id = c.org_id AND p.pco_id = c.person_id
        WHERE m.org_id = ? AND m.list_id IN (${ph(listIds)})
        GROUP BY c.contact_id`,
    )
    .all(orgId, ...listIds) as Array<{
    contactId: string;
    personId: string | null;
    pf: string | null;
    pl: string | null;
    cf: string | null;
    cl: string | null;
    listIds: string | null;
  }>;

  // Whoever the address could not place, try by name — and then fetch the
  // name PCO has for them, which is the one the rest of the page uses.
  const byName = matchByName(
    orgId,
    contacts
      .filter((c) => !c.personId)
      .map((c) => ({ contactId: c.contactId, first: c.cf, last: c.cl })),
  );
  if (byName.size > 0) {
    const ids = [...new Set(byName.values())];
    const pcoName = new Map<string, { f: string | null; l: string | null }>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of db
        .prepare(
          `SELECT pco_id AS id, first_name AS f, last_name AS l
             FROM pco_people WHERE org_id = ? AND pco_id IN (${ph(chunk)})`,
        )
        .all(orgId, ...chunk) as Array<{ id: string; f: string | null; l: string | null }>) {
        pcoName.set(r.id, r);
      }
    }
    for (const c of contacts) {
      const pid = c.personId ? undefined : byName.get(c.contactId);
      if (!pid) continue;
      c.personId = pid;
      c.pf = pcoName.get(pid)?.f ?? null;
      c.pl = pcoName.get(pid)?.l ?? null;
    }
  }

  // Opens and sends per contact, over those campaigns only.
  const opened = new Map<string, { n: number; last: string | null }>();
  const sentTo = new Map<string, number>();
  const clicked = new Map<string, number>();
  if (aids.length) {
    for (const r of db
      .prepare(
        `SELECT contact_id AS cid, activity_type AS t,
                COUNT(*) AS n, MAX(occurred_at) AS last
           FROM constant_contact_activity
          WHERE org_id = ? AND campaign_activity_id IN (${ph(aids)})
            AND activity_type IN ('open','send','click')
          GROUP BY contact_id, activity_type`,
      )
      .all(orgId, ...aids) as Array<{
      cid: string;
      t: string;
      n: number;
      last: string | null;
    }>) {
      if (r.t === "open") opened.set(r.cid, { n: r.n, last: r.last });
      else if (r.t === "click") clicked.set(r.cid, r.n);
      else sentTo.set(r.cid, r.n);
    }
  }

  const rows = contacts
    .map((c) => {
      // PCO's name when we have the person, Constant Contact's own when we
      // do not. Without the second, an unmatched contact is a person with
      // no name, no address and no record — nothing anybody can act on.
      const cc = [c.cf?.trim(), c.cl?.trim()].filter(Boolean).join(" ");
      const name = c.personId
        ? nameOf(c.pf, c.pl, c.personId)
        : cc
          ? tidyName(cc)
          : null;
      return {
        contactId: c.contactId,
        personId: c.personId,
        nameMatch: byName.has(c.contactId),
        name,
        lists: (c.listIds ?? "")
          .split(",")
          .filter(Boolean)
          .map((id) => listName.get(id) ?? id),
        // Where per-contact sends were not tracked, everyone on the list got
        // every campaign — which is what a list send means.
        sent: sentTo.get(c.contactId) ?? campaigns.length,
        opened: opened.get(c.contactId)?.n ?? 0,
        clicked: clicked.get(c.contactId) ?? 0,
        lastOpenedAt: opened.get(c.contactId)?.last ?? null,
      };
    })
    .sort((a, b) => b.opened - a.opened || (a.name ?? "~").localeCompare(b.name ?? "~"));

  return {
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name ?? "(unnamed list)",
      contacts: l.contacts,
    })),
    contacts: contacts.length,
    matched: contacts.filter((c) => c.personId).length,
    matchedByName: byName.size,
    unmatched: contacts.filter((c) => !c.personId).length,
    campaigns: campaigns.length,
    sends: campaigns.reduce((s, c) => s + c.sends, 0),
    opens: campaigns.reduce((s, c) => s + c.opens, 0),
    openers: rows.filter((r) => r.opened > 0).length,
    rows,
    unnamed: rows.filter((r) => !r.personId && !r.name).length,
  };
}

// ── source 2: old enough ─────────────────────────────────────────────

export function getAgeSource(orgId: number): AgeSource {
  const db = getDb();
  const ageMin = getSeniorsAgeMin(orgId);
  const bornOnOrBefore = new Date().getFullYear() - ageMin;

  const one = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(orgId, ...args) as { n: number }).n;

  const rows = db
    .prepare(
      `SELECT p.pco_id AS id, p.first_name AS f, p.last_name AS l,
              p.birth_year AS by,
              COALESCE(pa.classification,'unknown') AS cls
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ? AND p.birth_year <= ? AND ${ALIVE_SQL}
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    )
    .all(orgId, bornOnOrBefore) as Array<{
    id: string;
    f: string | null;
    l: string | null;
    by: number;
    cls: string;
  }>;

  const total = one(
    `SELECT COUNT(*) AS n FROM pco_people p
      WHERE p.org_id = ? AND p.birth_year <= ?`,
    bornOnOrBefore,
  );

  return {
    ageMin,
    bornOnOrBefore,
    total,
    // total minus whoever was taken out, so the headline is already net and
    // cannot be read as "and then subtract the inactive".
    count: rows.length,
    inactive: total - rows.length,

    noBirthYear: one(
      `SELECT COUNT(*) AS n FROM pco_people p
        WHERE p.org_id = ? AND p.birth_year IS NULL AND ${ALIVE_SQL}`,
    ),
    rows: rows.map((r) => ({
      personId: r.id,
      name: nameOf(r.f, r.l, r.id),
      classification: r.cls,
      birthYear: r.by,
    })),
  };
}

// ── source 3: turned up ──────────────────────────────────────────────

/** personId → the seniors events they appear in. */
function eventAttendance(
  orgId: number,
): Map<string, { events: string[]; last: string | null }> {
  const db = getDb();
  const out = new Map<string, { events: string[]; last: string | null }>();
  const add = (pid: string | null, label: string, when: string | null) => {
    if (!pid) return;
    const cur = out.get(pid) ?? { events: [], last: null };
    if (!cur.events.includes(label)) cur.events.push(label);
    // The most recent of whatever each source could tell us.
    if (when && (!cur.last || when > cur.last)) cur.last = when;
    out.set(pid, cur);
  };

  const signups = getSeniorsSignups(orgId);
  if (signups.length) {
    for (const r of db
      .prepare(
        `SELECT a.person_id AS pid, s.name AS name,
                a.pco_created_at AS when_
           FROM pco_registration_attendees a
           JOIN pco_registration_signups s
             ON s.org_id = a.org_id AND s.pco_id = a.signup_id
          WHERE a.org_id = ? AND a.signup_id IN (${ph(signups)})
            AND a.canceled = 0`,
      )
      .all(orgId, ...signups) as Array<{
      pid: string | null;
      name: string | null;
      when_: string | null;
    }>) {
      add(r.pid, r.name ?? "(registration)", r.when_);
    }
  }

  const events = getSeniorsCheckinEvents(orgId);
  if (events.length) {
    for (const r of db
      .prepare(
        `SELECT c.person_id AS pid, e.name AS name,
                MAX(c.event_time_starts_at) AS when_
           FROM pco_check_ins c
           JOIN pco_check_in_events e
             ON e.org_id = c.org_id AND e.pco_id = c.event_id
          WHERE c.org_id = ? AND c.event_id IN (${ph(events)})
            AND c.person_id IS NOT NULL
          GROUP BY c.person_id, e.pco_id`,
      )
      .all(orgId, ...events) as Array<{
      pid: string | null;
      name: string | null;
      when_: string | null;
    }>) {
      add(r.pid, r.name ?? "(event)", r.when_);
    }
  }

  const groupTypes = getSeniorsGroupTypes(orgId);
  const groups = getSeniorsGroups(orgId);
  if (groupTypes.length || groups.length) {
    const where: string[] = [];
    const args: string[] = [];
    if (groups.length) {
      where.push(`g.pco_id IN (${ph(groups)})`);
      args.push(...groups);
    }
    if (groupTypes.length) {
      where.push(`g.group_type_id IN (${ph(groupTypes)})`);
      args.push(...groupTypes);
    }
    for (const r of db
      .prepare(
        `SELECT m.person_id AS pid, g.name AS name,
                MAX(COALESCE(m.last_attended_at, m.joined_at)) AS when_
           FROM pco_group_memberships m
           JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.archived_at IS NULL
            AND g.archived_at IS NULL AND (${where.join(" OR ")})
          GROUP BY m.person_id, g.pco_id`,
      )
      .all(orgId, ...args) as Array<{
      pid: string | null;
      name: string | null;
      when_: string | null;
    }>) {
      add(r.pid, r.name ?? "(group)", r.when_);
    }
  }

  return out;
}

export function getEventSource(orgId: number): EventSource {
  const sel = getSeniorsSelection(orgId);
  const configured =
    sel.signups.length > 0 ||
    sel.checkinEvents.length > 0 ||
    sel.groupTypes.length > 0 ||
    sel.groups.length > 0;
  if (!configured) return { configured: false, people: 0, events: [], rows: [] };

  const attendance = eventAttendance(orgId);
  const byEvent = new Map<string, number>();
  for (const v of attendance.values()) {
    for (const l of v.events) byEvent.set(l, (byEvent.get(l) ?? 0) + 1);
  }

  const db = getDb();
  const ids = [...attendance.keys()];
  const names = new Map<string, { name: string; cls: string }>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db
      .prepare(
        `SELECT p.pco_id AS id, p.first_name AS f, p.last_name AS l,
                COALESCE(pa.classification,'unknown') AS cls
           FROM pco_people p
           LEFT JOIN person_activity pa
             ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
          WHERE p.org_id = ? AND p.pco_id IN (${ph(chunk)})`,
      )
      .all(orgId, ...chunk) as Array<{
      id: string;
      f: string | null;
      l: string | null;
      cls: string;
    }>) {
      names.set(r.id, { name: nameOf(r.f, r.l, r.id), cls: r.cls });
    }
  }

  return {
    configured: true,
    people: attendance.size,
    events: [...byEvent.entries()]
      .map(([name, people]) => ({ kind: "", id: name, name, people }))
      .sort((a, b) => b.people - a.people),
    rows: ids
      .map((id) => ({
        personId: id,
        name: names.get(id)?.name ?? `(unknown #${id})`,
        classification: names.get(id)?.cls ?? "unknown",
        events: attendance.get(id)?.events ?? [],
        lastAttendedAt: attendance.get(id)?.last ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── the working list ─────────────────────────────────────────────────

export function getWorkingList(orgId: number): WorkingList {
  const db = getDb();
  const email = getEmailSource(orgId);
  const age = getAgeSource(orgId);
  const attendance = eventAttendance(orgId);
  const eventsConfigured = getEventSource(orgId).configured;

  type Acc = Omit<SeniorRow, "standing">;
  const acc = new Map<string, Acc>();
  const take = (key: string, seed: Acc): Acc => {
    const cur = acc.get(key);
    if (cur) return cur;
    acc.set(key, seed);
    return seed;
  };

  // Age first, so everyone old enough is present even if silent.
  for (const r of age.rows) {
    take(r.personId, {
      personId: r.personId,
      name: r.name,
      nameMatch: false,
      sources: ["A"],
      signals: { ...NO_SIGNALS },
      lists: [],
      lastActivityAt: null,
      daysSince: null,
      sent: 0,
      opened: 0,
      clicked: 0,
      lastOpenedAt: null,
      events: [],
      classification: r.classification,
      inactive: false,
    });
  }

  // Then the mailing list, which brings people of any age — somebody on
  // the seniors list at 62 is on it for a reason.
  const unmatchedSeen = new Set<string>();
  const byAddress = new Set<string>();
  for (const r of email.rows) {
    const key = r.personId ?? `contact:${r.contactId}`;
    if (!r.personId) unmatchedSeen.add(r.contactId);
    const row = take(key, {
      personId: r.personId,
      name: r.name ?? "(no name on the contact)",
      nameMatch: false,
      sources: [],
      signals: { ...NO_SIGNALS },
      lists: [],
      lastActivityAt: null,
      daysSince: null,
      sent: 0,
      opened: 0,
      clicked: 0,
      lastOpenedAt: null,
      events: [],
      classification: "unknown",
      inactive: false,
    });
    if (!row.sources.includes("E")) row.sources.push("E");
    // Flagged only when the name is the sole link: one contact that matched
    // by address makes the record certain.
    if (r.personId && !r.nameMatch) byAddress.add(r.personId);
    else if (r.nameMatch) row.nameMatch = true;
    row.sent = Math.max(row.sent, r.sent);
    row.opened = Math.max(row.opened, r.opened);
    row.clicked = Math.max(row.clicked, r.clicked);
    if (r.lastOpenedAt && (!row.lastOpenedAt || r.lastOpenedAt > row.lastOpenedAt)) {
      row.lastOpenedAt = r.lastOpenedAt;
    }
    for (const l of r.lists) if (!row.lists.includes(l)) row.lists.push(l);
  }

  for (const r of acc.values()) {
    if (r.personId && byAddress.has(r.personId)) r.nameMatch = false;
  }

  // Then the events.
  for (const [pid, v] of attendance) {
    const row = acc.get(pid);
    if (row) {
      if (!row.sources.includes("R")) row.sources.push("R");
      row.events = v.events;
      continue;
    }
    // Somebody at a seniors event who is neither on the list nor old
    // enough on file. They belong here: they turned up.
    const p = db
      .prepare(
        `SELECT p.first_name AS f, p.last_name AS l,
                COALESCE(pa.classification,'unknown') AS cls,
                (p.inactivated_at IS NOT NULL
                 OR LOWER(COALESCE(p.status,'')) = 'inactive') AS inactive
           FROM pco_people p
           LEFT JOIN person_activity pa
             ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
          WHERE p.org_id = ? AND p.pco_id = ?`,
      )
      .get(orgId, pid) as
      | { f: string | null; l: string | null; cls: string; inactive: number }
      | undefined;
    if (!p) continue;
    acc.set(pid, {
      personId: pid,
      name: nameOf(p.f, p.l, pid),
      nameMatch: false,
      sources: ["R"],
      signals: { ...NO_SIGNALS },
      lists: [],
      lastActivityAt: null,
      daysSince: null,
      sent: 0,
      opened: 0,
      clicked: 0,
      lastOpenedAt: null,
      events: v.events,
      classification: p.cls,
      inactive: p.inactive === 1,
    });
  }

  // One query for everybody, rather than one per row.
  const withId = [...acc.values()].filter((r) => r.personId);
  const sig = pcoSignals(
    orgId,
    withId.map((r) => r.personId as string),
  );
  for (const r of acc.values()) {
    const got = r.personId ? sig.get(r.personId) : undefined;
    r.signals = {
      pco: got?.pco ?? false,
      // Opening one of the ministry's emails is the signal. Receiving one
      // is not, which is the distinction the whole page turns on.
      email: r.opened > 0,
    };
    // Either signal counts. Somebody whose only trace is opening last
    // week's newsletter was last seen last week, not never.
    const pco = got?.lastActivityAt ?? null;
    const mail = r.lastOpenedAt;
    r.lastActivityAt =
      pco && mail ? (pco > mail ? pco : mail) : (pco ?? mail);
    r.daysSince = daysSince(r.lastActivityAt);
  }

  const standingOf = (r: Acc): Standing => {
    // Already with you beats everything else it could say.
    if (r.events.length > 0) return "in_ministry";
    // On the list: the only question is whether it reaches them.
    if (r.sources.includes("E")) {
      return r.opened > 0 ? "reads_email" : "ignores_email";
    }
    // Old enough, on no list, at no event. The three cases differ in what
    // can be done about them, which is why they are not one bucket.
    // Nothing ever recorded reads the same as nothing for a year: there is
    // no trace to work from either way.
    if (r.signals.pco) return "active_elsewhere";
    if (r.daysSince === null) return "gone_quiet";
    return r.daysSince > 365 ? "gone_quiet" : "active_elsewhere";
  };

  // Nobody inactive in PCO, and nobody deceased. The age source already
  // left them out; the mailing list and the event rosters do not, and a
  // list the ministry is meant to act on should not open with people who
  // have left or died. An unmatched contact has no PCO record to judge,
  // so it stays.
  const ids = withId.map((r) => r.personId as string);
  const excluded = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of db
      .prepare(
        `SELECT p.pco_id AS id FROM pco_people p
          WHERE p.org_id = ? AND p.pco_id IN (${ph(chunk)})
            AND NOT (${ALIVE_SQL})`,
      )
      .all(orgId, ...chunk) as Array<{ id: string }>) {
      excluded.add(r.id);
    }
  }
  for (const [key, r] of acc) {
    if (r.personId && excluded.has(r.personId)) acc.delete(key);
  }

  const rows: SeniorRow[] = [...acc.values()]
    .map((r) => ({ ...r, standing: standingOf(r) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byStanding = Object.fromEntries(
    STANDING_ORDER.map((k) => [k, 0]),
  ) as Record<Standing, number>;
  for (const r of rows) byStanding[r.standing]++;

  return {
    rows,
    byStanding,
    neverInvited: rows.filter(
      (r) => r.sources.includes("A") && !r.sources.includes("E") && !r.sources.includes("R"),
    ).length,
    eventsConfigured,
  };
}

// ── the picker ───────────────────────────────────────────────────────

/** Everything that could be a seniors event, with what each would bring.
 *
 *  Two years of registrations, the live check-in events, and the group
 *  types and groups — four kinds because PCO keeps them apart, and all
 *  four can be the thing a ministry actually runs. The people count is
 *  there so a tick is an informed one: most of these are small, and one
 *  or two are not.
 */
export function listPickerOptions(orgId: number): PickerOption[] {
  const db = getDb();
  const sel = getSeniorsSelection(orgId);
  const out: PickerOption[] = [];

  for (const r of db
    .prepare(
      `SELECT s.pco_id AS id, s.name AS name, s.pco_created_at AS when_,
              (SELECT COUNT(DISTINCT a.person_id)
                 FROM pco_registration_attendees a
                WHERE a.org_id = s.org_id AND a.signup_id = s.pco_id
                  AND a.canceled = 0 AND a.person_id IS NOT NULL) AS people
         FROM pco_registration_signups s
        WHERE s.org_id = ?
          AND s.pco_created_at >= date('now','-${EVENT_PICKER_YEARS} years')
        ORDER BY s.pco_created_at DESC`,
    )
    .all(orgId) as Array<{
    id: string;
    name: string | null;
    when_: string | null;
    people: number;
  }>) {
    out.push({
      kind: "signup",
      id: r.id,
      name: r.name ?? "(unnamed registration)",
      people: r.people,
      when: r.when_,
      selected: sel.signups.includes(r.id),
    });
  }

  for (const r of db
    .prepare(
      `SELECT e.pco_id AS id, e.name AS name,
              (SELECT MAX(c.event_time_starts_at) FROM pco_check_ins c
                WHERE c.org_id = e.org_id AND c.event_id = e.pco_id) AS when_,
              (SELECT COUNT(DISTINCT c.person_id) FROM pco_check_ins c
                WHERE c.org_id = e.org_id AND c.event_id = e.pco_id
                  AND c.person_id IS NOT NULL
                  AND c.event_time_starts_at >= date('now','-${EVENT_PICKER_YEARS} years')) AS people
         FROM pco_check_in_events e
        WHERE e.org_id = ? AND e.archived_at IS NULL`,
    )
    .all(orgId) as Array<{
    id: string;
    name: string | null;
    when_: string | null;
    people: number;
  }>) {
    out.push({
      kind: "checkin_event",
      id: r.id,
      name: r.name ?? "(unnamed event)",
      people: r.people,
      when: r.when_,
      selected: sel.checkinEvents.includes(r.id),
    });
  }

  for (const r of db
    .prepare(
      `SELECT t.pco_id AS id, t.name AS name,
              (SELECT COUNT(DISTINCT m.person_id)
                 FROM pco_groups g
                 JOIN pco_group_memberships m
                   ON m.org_id = g.org_id AND m.group_id = g.pco_id
                  AND m.archived_at IS NULL
                WHERE g.org_id = t.org_id AND g.group_type_id = t.pco_id
                  AND g.archived_at IS NULL) AS people
         FROM pco_group_types t
        WHERE t.org_id = ?`,
    )
    .all(orgId) as Array<{ id: string; name: string | null; people: number }>) {
    out.push({
      kind: "group_type",
      id: r.id,
      name: r.name ?? "(unnamed group type)",
      people: r.people,
      when: null,
      selected: sel.groupTypes.includes(r.id),
    });
  }

  for (const r of db
    .prepare(
      `SELECT g.pco_id AS id, g.name AS name,
              (SELECT COUNT(DISTINCT m.person_id)
                 FROM pco_group_memberships m
                WHERE m.org_id = g.org_id AND m.group_id = g.pco_id
                  AND m.archived_at IS NULL) AS people
         FROM pco_groups g
        WHERE g.org_id = ? AND g.archived_at IS NULL`,
    )
    .all(orgId) as Array<{ id: string; name: string | null; people: number }>) {
    out.push({
      kind: "group",
      id: r.id,
      name: r.name ?? "(unnamed group)",
      people: r.people,
      when: null,
      selected: sel.groups.includes(r.id),
    });
  }

  return out;
}

/** The Constant Contact lists, for the same picker. */
export function listCcOptions(orgId: number): PickerOption[] {
  const sel = getSeniorsSelection(orgId);
  return (
    getDb()
      .prepare(
        `SELECT list_id AS id, name, COALESCE(membership_count,0) AS people
           FROM constant_contact_lists WHERE org_id = ?
          ORDER BY name COLLATE NOCASE`,
      )
      .all(orgId) as Array<{ id: string; name: string | null; people: number }>
  ).map((r) => ({
    kind: "signup" as const,
    id: r.id,
    name: r.name ?? "(unnamed list)",
    people: r.people,
    when: null,
    selected: sel.ccLists.includes(r.id),
  }));
}

export * from "./seniors-audit-shared";
