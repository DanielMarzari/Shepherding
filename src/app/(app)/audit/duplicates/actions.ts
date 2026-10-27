"use server";

import { requireOrg } from "@/lib/auth";
import {
  type DuplicateConfidence,
  listDuplicatePairs,
} from "@/lib/audit-read";

const PCO = "https://people.planningcenteronline.com/people/";

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Build the CSV for the current filter, on demand.
 *
 *  The export used to be a client component holding every pair as a prop,
 *  which meant the whole table was serialised into the page whether or not
 *  anybody pressed the button. Now the rows are read when it is pressed.
 */
export async function duplicatesCsvAction(
  confidence: string | null,
  returningOnly: boolean,
): Promise<string> {
  const session = await requireOrg();
  const pairs = listDuplicatePairs(session.orgId, {
    confidence:
      confidence === "high" || confidence === "low"
        ? (confidence as DuplicateConfidence)
        : undefined,
    returningOnly,
  });
  const lines = [
    "Person A,A link,Person B,B link,Confidence,Possibly returning,Reasons",
  ];
  for (const p of pairs) {
    lines.push(
      [
        cell(p.a.fullName),
        cell(`${PCO}${p.a.pcoId}`),
        cell(p.b.fullName),
        cell(`${PCO}${p.b.pcoId}`),
        p.confidence,
        p.oneActiveOneInactive ? "yes" : "no",
        cell(p.reasons.join(" | ")),
      ].join(","),
    );
  }
  return lines.join("\n");
}
