import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { decryptJson } from "@/lib/encryption";

/** One person's display name, for a map dot somebody clicked.
 *
 *  The map used to carry all 25,834 names into the page so a hover could
 *  show one. Now a dot knows only its id, and this answers for the one that
 *  was clicked — which also means the congregation's names are no longer
 *  shipped wholesale to every viewer of the map.
 */
export async function GET(req: Request) {
  const session = await requireOrg();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const row = getDb()
    .prepare(
      `SELECT first_name AS f, last_name AS l, enc_pii AS enc
         FROM pco_people WHERE org_id = ? AND pco_id = ?`,
    )
    .get(session.orgId, id) as
    | { f: string | null; l: string | null; enc: string | null }
    | undefined;
  if (!row) return NextResponse.json({ name: "Member" });

  let name = [row.f, row.l].filter(Boolean).join(" ");
  if (!name && row.enc) {
    const pii = decryptJson<{ first_name?: string | null; last_name?: string | null }>(row.enc);
    name = [pii?.first_name, pii?.last_name].filter(Boolean).join(" ");
  }
  return NextResponse.json({ name: name || "Member" });
}
