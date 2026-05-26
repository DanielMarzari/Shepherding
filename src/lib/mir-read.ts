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
  updatedAt: string;
}

export interface MirDoc extends MirSummary {
  resources: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
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
  return {
    id: row.id,
    title: row.title,
    targetAudience: row.targetAudience,
    lead: refFor(row.leadPersonId, row.leadEncPii),
    sponsor: refFor(row.sponsorPersonId, row.sponsorEncPii),
    resources: row.resources,
    activities: row.activities,
    outputs: row.outputs,
    outcomes: row.outcomes,
    impact: row.impact,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
