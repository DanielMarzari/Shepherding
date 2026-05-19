import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { TargetKind, TargetOption } from "./assignments-types";

export type { TargetKind, TargetOption } from "./assignments-types";
export { TARGET_KIND_LABELS } from "./assignments-types";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

const SHEPHERD_TEAM_LIST_NAME = "REFERENCE - Shepherd Team";

export interface ShepherdPerson {
  personId: string;
  fullName: string;
  initials: string;
}

export interface Assignment {
  id: number;
  shepherdPersonId: string;
  targetKind: TargetKind;
  targetId: string;
  targetName: string;
  note: string | null;
  createdAt: string;
}

/** Roster of people on the "REFERENCE - Shepherd Team" PCO list. These
 *  are the only people who can have assignments — the page lets you
 *  manage who each of them oversees. */
export function listShepherds(orgId: number): ShepherdPerson[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.pco_id AS personId, p.enc_pii AS encPii
         FROM pco_list_memberships m
         JOIN pco_lists l
           ON l.org_id = m.org_id AND l.pco_id = m.list_id
         JOIN pco_people p
           ON p.org_id = m.org_id AND p.pco_id = m.person_id
        WHERE m.org_id = ? AND l.name = ?`,
    )
    .all(orgId, SHEPHERD_TEAM_LIST_NAME) as Array<{
    personId: string;
    encPii: string | null;
  }>;
  const out: ShepherdPerson[] = rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const first = pii?.first_name ?? null;
    const last = pii?.last_name ?? null;
    const fullName =
      [first, last].filter(Boolean).join(" ") || `(unknown #${r.personId})`;
    const initials =
      ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??";
    return { personId: r.personId, fullName, initials };
  });
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}

/** Pickable targets of a given kind. The same shape (id + display
 *  name) regardless of kind, so the add-assignment UI doesn't have
 *  to special-case anything. Person and team_position queries
 *  decrypt / join to produce readable labels. */
export function listTargetOptions(
  orgId: number,
  kind: TargetKind,
): TargetOption[] {
  const db = getDb();
  switch (kind) {
    case "group": {
      const rows = db
        .prepare(
          `SELECT pco_id AS id, name
             FROM pco_groups
            WHERE org_id = ? AND archived_at IS NULL
            ORDER BY name COLLATE NOCASE`,
        )
        .all(orgId) as Array<{ id: string; name: string | null }>;
      return rows.map((r) => ({ id: r.id, name: r.name ?? "(unnamed)" }));
    }
    case "group_type": {
      const rows = db
        .prepare(
          `SELECT pco_id AS id, name
             FROM pco_group_types
            WHERE org_id = ?
            ORDER BY name COLLATE NOCASE`,
        )
        .all(orgId) as Array<{ id: string; name: string | null }>;
      return rows.map((r) => ({ id: r.id, name: r.name ?? "(unnamed)" }));
    }
    case "team": {
      const rows = db
        .prepare(
          `SELECT t.pco_id AS id, t.name AS name, st.name AS serviceTypeName
             FROM pco_teams t
        LEFT JOIN pco_service_types st
               ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
            WHERE t.org_id = ?
              AND t.archived_at IS NULL
              AND t.deleted_at IS NULL
            ORDER BY t.name COLLATE NOCASE`,
        )
        .all(orgId) as Array<{
        id: string;
        name: string | null;
        serviceTypeName: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.serviceTypeName
          ? `${r.name ?? "(unnamed)"} — ${r.serviceTypeName}`
          : r.name ?? "(unnamed)",
      }));
    }
    case "service_type": {
      const rows = db
        .prepare(
          `SELECT pco_id AS id, name
             FROM pco_service_types
            WHERE org_id = ? AND archived_at IS NULL
            ORDER BY name COLLATE NOCASE`,
        )
        .all(orgId) as Array<{ id: string; name: string | null }>;
      return rows.map((r) => ({ id: r.id, name: r.name ?? "(unnamed)" }));
    }
    case "team_position": {
      const rows = db
        .prepare(
          `SELECT tp.pco_id AS id, tp.name AS name, t.name AS teamName
             FROM pco_team_positions tp
        LEFT JOIN pco_teams t
               ON t.org_id = tp.org_id AND t.pco_id = tp.team_id
            WHERE tp.org_id = ?
            ORDER BY t.name COLLATE NOCASE, tp.name COLLATE NOCASE`,
        )
        .all(orgId) as Array<{
        id: string;
        name: string | null;
        teamName: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.teamName
          ? `${r.name ?? "(unnamed)"} — ${r.teamName}`
          : r.name ?? "(unnamed)",
      }));
    }
    case "person": {
      // Only other staff shepherds are pickable — peer hierarchy. We
      // dedupe via DISTINCT in case PCO has the same person on the
      // list twice for some reason.
      const rows = db
        .prepare(
          `SELECT DISTINCT p.pco_id AS id, p.enc_pii AS encPii
             FROM pco_list_memberships m
             JOIN pco_lists l
               ON l.org_id = m.org_id AND l.pco_id = m.list_id
             JOIN pco_people p
               ON p.org_id = m.org_id AND p.pco_id = m.person_id
            WHERE m.org_id = ? AND l.name = ?`,
        )
        .all(orgId, SHEPHERD_TEAM_LIST_NAME) as Array<{
        id: string;
        encPii: string | null;
      }>;
      const out = rows.map((r) => {
        const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
        const name =
          [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
          `(unknown #${r.id})`;
        return { id: r.id, name };
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    }
  }
}

/** Every assignment for the org, with the target's display name already
 *  resolved. One row per (shepherd, target) pair. Used both to render
 *  the per-shepherd chips and to compute "this group is overseen by X". */
export function listAssignments(orgId: number): Assignment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, shepherd_person_id AS shepherdPersonId,
              target_kind AS targetKind, target_id AS targetId,
              note, created_at AS createdAt
         FROM shepherd_assignments
        WHERE org_id = ?
        ORDER BY created_at DESC`,
    )
    .all(orgId) as Array<{
    id: number;
    shepherdPersonId: string;
    targetKind: TargetKind;
    targetId: string;
    note: string | null;
    createdAt: string;
  }>;

  if (rows.length === 0) return [];

  // Hydrate target names in a single pass per kind so we don't run
  // N queries when a shepherd oversees a lot of things.
  const targetNamesByKind = new Map<TargetKind, Map<string, string>>();
  const kinds = new Set<TargetKind>(rows.map((r) => r.targetKind));
  for (const kind of kinds) {
    const map = new Map<string, string>();
    for (const opt of listTargetOptions(orgId, kind)) {
      map.set(opt.id, opt.name);
    }
    targetNamesByKind.set(kind, map);
  }

  return rows.map((r) => {
    const name =
      targetNamesByKind.get(r.targetKind)?.get(r.targetId) ??
      `(missing #${r.targetId})`;
    return {
      id: r.id,
      shepherdPersonId: r.shepherdPersonId,
      targetKind: r.targetKind,
      targetId: r.targetId,
      targetName: name,
      note: r.note,
      createdAt: r.createdAt,
    };
  });
}

