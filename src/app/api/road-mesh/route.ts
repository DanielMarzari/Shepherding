import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/auth";
import { getRoadMesh } from "@/lib/road-network";

/** The road web, fetched by the map after it has drawn.
 *
 *  It used to be rendered into the page: 12,188 polylines and 242,524
 *  coordinate pairs, about 5.5 MB of the map's 11.9 MB response, parsed out
 *  of SQLite and serialised on every request before anybody saw anything.
 *  It is decoration over the dots, so it arrives after them now — and on the
 *  campus planner, only when the roads box is ticked.
 *
 *  It changes when the mesh is rebuilt, which is a manual action, so it is
 *  safe to let the browser hold it for an hour.
 */
export async function GET() {
  const session = await requireOrg();
  const mesh = getRoadMesh(session.orgId);
  return NextResponse.json(mesh, {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
