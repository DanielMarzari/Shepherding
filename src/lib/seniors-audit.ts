import "server-only";
import { getDb } from "./db";
import {
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


/** Names that carry SIA in capitals.
 *
 *  Seniors In Action is always written SIA, and GLOB is case-sensitive
 *  where LIKE is not — which is the whole difference between a usable
 *  signal and a useless one. Case-insensitively, "sia" also matches
 *  Malaysia, SE Asia, Iglesia de Fe, Colossians and Ephesians. In
 *  capitals it matches the SIA meetings, the SIA carpool trip, the SIA
 *  Bible studies and the Seniors In Action group type, and nothing else.
 *
 *  Still only a suggestion: the page sorts these first and offers to tick
 *  them, but nothing is counted until somebody says so.
 */
const SIA_GLOB = "*SIA*";

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

// ── source 1: the mailing list ───────────────────────────────────────

export function getEmailSource(orgId: number): EmailSource {
  const db = getDb();
  const listIds = getSeniorsCcLists(orgId);
  const empty: EmailSource = {
    lists: [],
    contacts: 0,
    matched: 0,
    unmatched: 0,
    campaigns: 0,
    sends: 0,
    opens: 0,
    openers: 0,
    rows: [],
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

  const contacts = db
    .prepare(
      `SELECT DISTINCT c.contact_id AS contactId, c.person_id AS personId,
              p.first_name AS f, p.last_name AS l
         FROM constant_contact_list_memberships m
         JOIN constant_contact_contacts c
           ON c.org_id = m.org_id AND c.contact_id = m.contact_id
         LEFT JOIN pco_people p
           ON p.org_id = c.org_id AND p.pco_id = c.person_id
        WHERE m.org_id = ? AND m.list_id IN (${ph(listIds)})`,
    )
    .all(orgId, ...listIds) as Array<{
    contactId: string;
    personId: string | null;
    f: string | null;
    l: string | null;
  }>;

  // Opens and sends per contact, over those campaigns only.
  const opened = new Map<string, { n: number; last: string | null }>();
  const sentTo = new Map<string, number>();
  if (aids.length) {
    for (const r of db
      .prepare(
        `SELECT contact_id AS cid, activity_type AS t,
                COUNT(*) AS n, MAX(occurred_at) AS last
           FROM constant_contact_activity
          WHERE org_id = ? AND campaign_activity_id IN (${ph(aids)})
            AND activity_type IN ('open','send')
          GROUP BY contact_id, activity_type`,
      )
      .all(orgId, ...aids) as Array<{
      cid: string;
      t: string;
      n: number;
      last: string | null;
    }>) {
      if (r.t === "open") opened.set(r.cid, { n: r.n, last: r.last });
      else sentTo.set(r.cid, r.n);
    }
  }

  const rows = contacts
    .map((c) => ({
      contactId: c.contactId,
      email: null as string | null,
      personId: c.personId,
      name: c.personId ? nameOf(c.f, c.l, c.personId) : null,
      // Where per-contact sends were not tracked, everyone on the list got
      // every campaign — which is what a list send means.
      sent: sentTo.get(c.contactId) ?? campaigns.length,
      opened: opened.get(c.contactId)?.n ?? 0,
      lastOpenedAt: opened.get(c.contactId)?.last ?? null,
    }))
    .sort((a, b) => b.opened - a.opened || (a.name ?? "~").localeCompare(b.name ?? "~"));

  return {
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name ?? "(unnamed list)",
      contacts: l.contacts,
    })),
    contacts: contacts.length,
    matched: contacts.filter((c) => c.personId).length,
    unmatched: contacts.filter((c) => !c.personId).length,
    campaigns: campaigns.length,
    sends: campaigns.reduce((s, c) => s + c.sends, 0),
    opens: campaigns.reduce((s, c) => s + c.opens, 0),
    openers: rows.filter((r) => r.opened > 0).length,
  rows,
  };
}

// ── source 2: old enough ─────────────────────────────────────────────

export function getAgeSource(orgId: number): AgeSource {
  const db = getDb();
  const ageMin = getSeniorsAgeMin(orgId);
  const bornOnOrBefore = new Date().getFullYear() - ageMin;

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

  const one = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(orgId, ...args) as { n: number }).n;

  return {
    ageMin,
    bornOnOrBefore,
    count: rows.length,
    inactive: one(
      `SELECT COUNT(*) AS n FROM pco_people p
        WHERE p.org_id = ? AND p.birth_year <= ?
          AND (p.inactivated_at IS NOT NULL
            OR LOWER(COALESCE(p.status,'')) = 'inactive')`,
      bornOnOrBefore,
    ),
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
function eventAttendance(orgId: number): Map<string, string[]> {
  const db = getDb();
  const out = new Map<string, string[]>();
  const add = (pid: string | null, label: string) => {
    if (!pid) return;
    const arr = out.get(pid) ?? [];
    if (!arr.includes(label)) arr.push(label);
    out.set(pid, arr);
  };

  const signups = getSeniorsSignups(orgId);
  if (signups.length) {
    for (const r of db
      .prepare(
        `SELECT a.person_id AS pid, s.name AS name
           FROM pco_registration_attendees a
           JOIN pco_registration_signups s
             ON s.org_id = a.org_id AND s.pco_id = a.signup_id
          WHERE a.org_id = ? AND a.signup_id IN (${ph(signups)})
            AND a.canceled = 0`,
      )
      .all(orgId, ...signups) as Array<{ pid: string | null; name: string | null }>) {
      add(r.pid, r.name ?? "(registration)");
    }
  }

  const events = getSeniorsCheckinEvents(orgId);
  if (events.length) {
    for (const r of db
      .prepare(
        `SELECT DISTINCT c.person_id AS pid, e.name AS name
           FROM pco_check_ins c
           JOIN pco_check_in_events e
             ON e.org_id = c.org_id AND e.pco_id = c.event_id
          WHERE c.org_id = ? AND c.event_id IN (${ph(events)})
            AND c.person_id IS NOT NULL`,
      )
      .all(orgId, ...events) as Array<{ pid: string | null; name: string | null }>) {
      add(r.pid, r.name ?? "(event)");
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
        `SELECT DISTINCT m.person_id AS pid, g.name AS name
           FROM pco_group_memberships m
           JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.archived_at IS NULL
            AND g.archived_at IS NULL AND (${where.join(" OR ")})`,
      )
      .all(orgId, ...args) as Array<{ pid: string | null; name: string | null }>) {
      add(r.pid, r.name ?? "(group)");
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
  if (!configured) return { configured: false, people: 0, events: [] };

  const attendance = eventAttendance(orgId);
  const byEvent = new Map<string, number>();
  for (const labels of attendance.values()) {
    for (const l of labels) byEvent.set(l, (byEvent.get(l) ?? 0) + 1);
  }

  return {
    configured: true,
    people: attendance.size,
    events: [...byEvent.entries()]
      .map(([name, people]) => ({ kind: "", id: name, name, people }))
      .sort((a, b) => b.people - a.people),
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
      sources: ["A"],
      sent: 0,
      opened: 0,
      events: [],
      classification: r.classification,
      inactive: false,
    });
  }

  // Then the mailing list, which brings people of any age — somebody on
  // the seniors list at 62 is on it for a reason.
  const unmatchedSeen = new Set<string>();
  for (const r of email.rows) {
    const key = r.personId ?? `contact:${r.contactId}`;
    if (!r.personId) unmatchedSeen.add(r.contactId);
    const row = take(key, {
      personId: r.personId,
      name: r.name ?? "(no PCO match)",
      sources: [],
      sent: 0,
      opened: 0,
      events: [],
      classification: "unknown",
      inactive: false,
    });
    if (!row.sources.includes("E")) row.sources.push("E");
    row.sent = Math.max(row.sent, r.sent);
    row.opened = Math.max(row.opened, r.opened);
  }

  // Then the events.
  for (const [pid, labels] of attendance) {
    const row = acc.get(pid);
    if (row) {
      if (!row.sources.includes("R")) row.sources.push("R");
      row.events = labels;
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
      sources: ["R"],
      sent: 0,
      opened: 0,
      events: labels,
      classification: p.cls,
      inactive: p.inactive === 1,
    });
  }

  const standingOf = (r: Acc): Standing => {
    if (r.events.length > 0) return "at_events";
    if (r.sources.includes("E")) {
      return r.opened > 0 ? "reads_email" : "ignores_email";
    }
    return r.classification === "unknown" ? "not_involved" : "active_elsewhere";
  };

  const rows: SeniorRow[] = [...acc.values()]
    .map((r) => ({ ...r, standing: standingOf(r) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byStanding = {
    at_events: 0,
    reads_email: 0,
    ignores_email: 0,
    active_elsewhere: 0,
    not_involved: 0,
  } as Record<Standing, number>;
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
              (s.name GLOB ?) AS sia,
              (SELECT COUNT(DISTINCT a.person_id)
                 FROM pco_registration_attendees a
                WHERE a.org_id = s.org_id AND a.signup_id = s.pco_id
                  AND a.canceled = 0 AND a.person_id IS NOT NULL) AS people
         FROM pco_registration_signups s
        WHERE s.org_id = ?
          AND s.pco_created_at >= date('now','-${EVENT_PICKER_YEARS} years')
        ORDER BY s.pco_created_at DESC`,
    )
    .all(SIA_GLOB, orgId) as Array<{
    id: string;
    name: string | null;
    when_: string | null;
    people: number;
    sia: number;
  }>) {
    out.push({
      kind: "signup",
      id: r.id,
      name: r.name ?? "(unnamed registration)",
      people: r.people,
      when: r.when_,
      selected: sel.signups.includes(r.id),
      suggested: r.sia === 1,
    });
  }

  for (const r of db
    .prepare(
      `SELECT e.pco_id AS id, e.name AS name, (e.name GLOB ?) AS sia,
              (SELECT MAX(c.event_time_starts_at) FROM pco_check_ins c
                WHERE c.org_id = e.org_id AND c.event_id = e.pco_id) AS when_,
              (SELECT COUNT(DISTINCT c.person_id) FROM pco_check_ins c
                WHERE c.org_id = e.org_id AND c.event_id = e.pco_id
                  AND c.person_id IS NOT NULL
                  AND c.event_time_starts_at >= date('now','-${EVENT_PICKER_YEARS} years')) AS people
         FROM pco_check_in_events e
        WHERE e.org_id = ? AND e.archived_at IS NULL`,
    )
    .all(SIA_GLOB, orgId) as Array<{
    id: string;
    name: string | null;
    when_: string | null;
    people: number;
    sia: number;
  }>) {
    out.push({
      kind: "checkin_event",
      id: r.id,
      name: r.name ?? "(unnamed event)",
      people: r.people,
      when: r.when_,
      selected: sel.checkinEvents.includes(r.id),
      suggested: r.sia === 1,
    });
  }

  for (const r of db
    .prepare(
      `SELECT t.pco_id AS id, t.name AS name, (t.name GLOB ?) AS sia,
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
    .all(SIA_GLOB, orgId) as Array<{
    id: string;
    name: string | null;
    people: number;
    sia: number;
  }>) {
    out.push({
      kind: "group_type",
      id: r.id,
      name: r.name ?? "(unnamed group type)",
      people: r.people,
      when: null,
      selected: sel.groupTypes.includes(r.id),
      suggested: r.sia === 1,
    });
  }

  for (const r of db
    .prepare(
      `SELECT g.pco_id AS id, g.name AS name, (g.name GLOB ?) AS sia,
              (SELECT COUNT(DISTINCT m.person_id)
                 FROM pco_group_memberships m
                WHERE m.org_id = g.org_id AND m.group_id = g.pco_id
                  AND m.archived_at IS NULL) AS people
         FROM pco_groups g
        WHERE g.org_id = ? AND g.archived_at IS NULL`,
    )
    .all(SIA_GLOB, orgId) as Array<{
    id: string;
    name: string | null;
    people: number;
    sia: number;
  }>) {
    out.push({
      kind: "group",
      id: r.id,
      name: r.name ?? "(unnamed group)",
      people: r.people,
      when: null,
      selected: sel.groups.includes(r.id),
      suggested: r.sia === 1,
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
        `SELECT list_id AS id, name, COALESCE(membership_count,0) AS people,
              (name GLOB ? OR name LIKE '%enior%') AS sia
           FROM constant_contact_lists WHERE org_id = ?
          ORDER BY name COLLATE NOCASE`,
      )
      .all(SIA_GLOB, orgId) as Array<{
      id: string;
      name: string | null;
      people: number;
      sia: number;
    }>
  ).map((r) => ({
    kind: "signup" as const,
    id: r.id,
    name: r.name ?? "(unnamed list)",
    people: r.people,
    when: null,
    selected: sel.ccLists.includes(r.id),
    suggested: r.sia === 1,
  }));
}

export * from "./seniors-audit-shared";
