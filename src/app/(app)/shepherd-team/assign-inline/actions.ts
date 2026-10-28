"use server";

import { requireOrg } from "@/lib/auth";
import {
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
  listTargetOptions,
} from "@/lib/assignments-read";
import { getOversight, optionReachCounts } from "@/lib/shepherd-oversight";
import type { AssignedPerson, Connection } from "@/lib/shepherd-oversight";

export interface RowDetail {
  personId: string;
  name: string;
  bandwidth: number;
  bandwidthSet: boolean;
  byRole: number;
  connections: Connection[];
  assignedPeople: AssignedPerson[];
  targetsByKind: Record<TargetKind, TargetOption[]>;
  counts: Record<string, number>;
}

/** Everything one expanded row needs, fetched when it opens.
 *
 *  Not loaded with the page. The work here is what the single-shepherd
 *  page already does for one person — connection reach counts and the
 *  picker's option lists — and doing it for 25 shepherds before anybody
 *  has clicked a name is exactly the cost this layout exists to avoid.
 *  One expand pays for one shepherd.
 */
export async function loadRowAction(personId: string): Promise<RowDetail | null> {
  const session = await requireOrg();
  const o = getOversight(session.orgId, personId);
  if (!o) return null;

  const targetsByKind = Object.fromEntries(
    (Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((k) => [
      k,
      listTargetOptions(session.orgId, k),
    ]),
  ) as Record<TargetKind, TargetOption[]>;

  return {
    personId: o.personId,
    name: o.name,
    bandwidth: o.bandwidth,
    bandwidthSet: o.bandwidthSet,
    byRole: o.byRole,
    connections: o.connections,
    assignedPeople: o.assignedPeople,
    targetsByKind,
    counts: optionReachCounts(session.orgId),
  };
}
