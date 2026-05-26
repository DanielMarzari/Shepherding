import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface MirPersonRef {
  personId: string;
  name: string;
}

export interface MirSummary {
  id: number;
  title: string;
  targetAudience: string | null;
  lead: MirPersonRef | null;
  sponsor: MirPersonRef | null;
  /** Count of additional team members (excludes lead + sponsor). */
  memberCount: number;
  updatedAt: string;
}

export interface MirDoc extends MirSummary {
  resources: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
  /** Additional team members; lead + sponsor are NOT included here. */
  members: MirPersonRef[];
  authorUserId: number | null;
  createdAt: string;
}

interface RawSummary {
  id: number;
  title: string;
  targetAudience: string | null;
  leadPersonId: string | null;
  leadEncPii: string | null;
  sponsorPersonId: string | null;
  sponsorEncPii: string | null;
  memberCount: number;
  updatedAt: string;
}

function refFor(id: string | null, encPii: string | null): MirPersonRef | null {
  if (!id) return null;
  const pii = encPii ? decryptJson<PIIBlob>(encPii) : null;
  const name =
    [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
    `(unknown #${id})`;
  return { personId: id, name };
}

export function listMirs(orgId: number): MirSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.title,
              m.target_audience AS targetAudience,
              m.lead_person_id AS leadPersonId,
              lp.enc_pii AS leadEncPii,
              m.sponsor_person_id AS sponsorPersonId,
              sp.enc_pii AS sponsorEncPii,
              (SELECT COUNT(*) FROM mir_team_members tm
                WHERE tm.org_id = m.org_id AND tm.mir_id = m.id
                  AND tm.person_id != coalesce(m.lead_person_id, '')
                  AND tm.person_id != coalesce(m.sponsor_person_id, '')
              ) AS memberCount,
              m.updated_at AS updatedAt
         FROM mir_docs m
    LEFT JOIN pco_people lp
           ON lp.org_id = m.org_id AND lp.pco_id = m.lead_person_id
    LEFT JOIN pco_people sp
           ON sp.org_id = m.org_id AND sp.pco_id = m.sponsor_person_id
        WHERE m.org_id = ?
        ORDER BY m.updated_at DESC`,
    )
    .all(orgId) as RawSummary[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    targetAudience: r.targetAudience,
    lead: refFor(r.leadPersonId, r.leadEncPii),
    sponsor: refFor(r.sponsorPersonId, r.sponsorEncPii),
    memberCount: r.memberCount ?? 0,
    updatedAt: r.updatedAt,
  }));
}

export function getMir(orgId: number, id: number): MirDoc | null {
  const row = getDb()
    .prepare(
      `SELECT m.id, m.title,
              m.target_audience AS targetAudience,
              m.lead_person_id AS leadPersonId,
              lp.enc_pii AS leadEncPii,
              m.sponsor_person_id AS sponsorPersonId,
              sp.enc_pii AS sponsorEncPii,
              m.resources, m.activities, m.outputs, m.outcomes, m.impact,
              m.author_user_id AS authorUserId,
              m.created_at AS createdAt, m.updated_at AS updatedAt
         FROM mir_docs m
    LEFT JOIN pco_people lp
           ON lp.org_id = m.org_id AND lp.pco_id = m.lead_person_id
    LEFT JOIN pco_people sp
           ON sp.org_id = m.org_id AND sp.pco_id = m.sponsor_person_id
        WHERE m.org_id = ? AND m.id = ?`,
    )
    .get(orgId, id) as
    | (RawSummary & {
        resources: string | null;
        activities: string | null;
        outputs: string | null;
        outcomes: string | null;
        impact: string | null;
        authorUserId: number | null;
        createdAt: string;
      })
    | undefined;
  if (!row) return null;

  // Additional team members — anyone linked via mir_team_members EXCEPT
  // the lead and sponsor (those are surfaced separately).
  const memberRows = getDb()
    .prepare(
      `SELECT tm.person_id AS personId, p.enc_pii AS encPii
         FROM mir_team_members tm
    LEFT JOIN pco_people p
           ON p.org_id = tm.org_id AND p.pco_id = tm.person_id
        WHERE tm.org_id = ? AND tm.mir_id = ?
          AND tm.person_id != coalesce(?, '')
          AND tm.person_id != coalesce(?, '')`,
    )
    .all(
      orgId,
      id,
      row.leadPersonId ?? "",
      row.sponsorPersonId ?? "",
    ) as Array<{ personId: string; encPii: string | null }>;
  const members = memberRows
    .map((m) => refFor(m.personId, m.encPii))
    .filter((m): m is MirPersonRef => m !== null);
  members.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: row.id,
    title: row.title,
    targetAudience: row.targetAudience,
    lead: refFor(row.leadPersonId, row.leadEncPii),
    sponsor: refFor(row.sponsorPersonId, row.sponsorEncPii),
    memberCount: members.length,
    resources: row.resources,
    activities: row.activities,
    outputs: row.outputs,
    outcomes: row.outcomes,
    impact: row.impact,
    members,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
