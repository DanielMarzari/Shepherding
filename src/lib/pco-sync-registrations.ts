import "server-only";
import { getDb, prepareCached } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Registrations sync — signups and their attendees.
 *
 *  This is where the Discover courses live. They are not groups and not
 *  check-in events, which is why "# of people who attend adult discipleship
 *  events" had no answer: Discover Jesus, Discover Evangelism, Discover
 *  Baptism, Discover the Bible, Discover Community, Discover Next Steps and
 *  Discover Disciple-Making are all Registrations signups.
 *
 *  An attendee's person id is in the same namespace as pco_people.pco_id, so
 *  attendance joins to the rest of the app. It only comes back with
 *  `include=person`; the bare attendee payload has no person on it at all. */

export interface RegistrationSyncResult {
  signups: { fetched: number; upserted: number };
  attendees: { fetched: number; upserted: number };
  signupsScanned: number;
}

export async function syncRegistrationsAll(
  client: PCOClient,
  orgId: number,
  thresholdMonths: number,
): Promise<RegistrationSyncResult> {
  const result: RegistrationSyncResult = {
    signups: { fetched: 0, upserted: 0 },
    attendees: { fetched: 0, upserted: 0 },
    signupsScanned: 0,
  };

  // 1) Every signup. ~931 rows, ten pages — cheap enough to take in full each
  //    time, and it keeps a renamed or newly-archived signup current.
  const signups: Array<{ id: string; updatedAt: string | null }> = [];
  for await (const { page } of client.paginate<PCOResource>(
    "/registrations/v2/signups?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const s of arr) {
      result.signups.fetched++;
      const a = (s.attributes ?? {}) as Record<string, unknown>;
      upsertSignup(orgId, {
        pcoId: s.id,
        name: (a.name as string | undefined) ?? null,
        isArchived: a.archived === true ? 1 : 0,
        open: a.open === true ? 1 : 0,
        pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
      });
      result.signups.upserted++;
      signups.push({ id: s.id, updatedAt: (a.updated_at as string | undefined) ?? null });
    }
  }

  // 2) Attendees, one request per signup — so only fetch the ones worth
  //    re-reading. A signup we have never pulled attendees for is always
  //    fetched (that is the first-run backfill); after that only signups
  //    touched inside the window are re-read. A closed 2017 course does not
  //    change, and re-reading all 931 every night would be ~1,900 calls.
  const cutoff = new Date(Date.now() - thresholdMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const seen = db.prepare(
    `SELECT 1 FROM pco_registration_attendees WHERE org_id = ? AND signup_id = ? LIMIT 1`,
  );
  for (const s of signups) {
    const known = !!seen.get(orgId, s.id);
    if (known && s.updatedAt && s.updatedAt < cutoff) continue;
    result.signupsScanned++;
    const rows: AttendeeRow[] = [];
    for await (const { page } of client.paginate<PCOResource>(
      `/registrations/v2/signups/${s.id}/attendees?per_page=100&include=person`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      for (const at of arr) {
        result.attendees.fetched++;
        const a = (at.attributes ?? {}) as Record<string, unknown>;
        const personRel = at.relationships?.person?.data;
        rows.push({
          pcoId: at.id,
          signupId: s.id,
          personId: !Array.isArray(personRel) && personRel ? personRel.id : null,
          canceled: a.canceled === true ? 1 : 0,
          waitlisted: a.waitlisted === true ? 1 : 0,
          pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        });
      }
    }
    replaceAttendees(orgId, s.id, rows);
    result.attendees.upserted += rows.length;
  }
  return result;
}

function upsertSignup(
  orgId: number,
  s: {
    pcoId: string;
    name: string | null;
    isArchived: number;
    open: number;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  },
) {
  prepareCached(
    `INSERT INTO pco_registration_signups
      (org_id, pco_id, name, is_archived, open, pco_created_at, pco_updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name = excluded.name,
       is_archived = excluded.is_archived,
       open = excluded.open,
       pco_created_at = excluded.pco_created_at,
       pco_updated_at = excluded.pco_updated_at,
       synced_at = excluded.synced_at`,
  ).run(orgId, s.pcoId, s.name, s.isArchived, s.open, s.pcoCreatedAt, s.pcoUpdatedAt);
}

interface AttendeeRow {
  pcoId: string;
  signupId: string;
  personId: string | null;
  canceled: number;
  waitlisted: number;
  pcoCreatedAt: string | null;
}

/** Replace a signup's attendee list wholesale — a withdrawn attendee is deleted
 *  in PCO rather than flagged, so an upsert-only pass would keep them forever. */
function replaceAttendees(orgId: number, signupId: string, rows: AttendeeRow[]) {
  const db = getDb();
  const del = prepareCached(`DELETE FROM pco_registration_attendees WHERE org_id = ? AND signup_id = ?`);
  const ins = prepareCached(
    `INSERT INTO pco_registration_attendees
      (org_id, pco_id, signup_id, person_id, canceled, waitlisted, pco_created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       signup_id = excluded.signup_id,
       person_id = excluded.person_id,
       canceled = excluded.canceled,
       waitlisted = excluded.waitlisted,
       pco_created_at = excluded.pco_created_at,
       synced_at = excluded.synced_at`,
  );
  const tx = db.transaction(() => {
    del.run(orgId, signupId);
    for (const r of rows) {
      ins.run(orgId, r.pcoId, r.signupId, r.personId, r.canceled, r.waitlisted, r.pcoCreatedAt);
    }
  });
  tx();
}
