// Pull LVPC's new residential development pipeline (Residential_2024_points)
// and emit a static WGS84 snapshot, matching the lv-churches.ts pattern.
import { writeFileSync } from "node:fs";

const BASE =
  "https://services2.arcgis.com/ZktcQDbWRlii7YHf/arcgis/rest/services/Residential_2024_points/FeatureServer/0/query";

function sanitize(s) {
  // ArcGIS sometimes embeds raw control chars (newlines in dev names) that make
  // the JSON invalid for strict parsers — the response is otherwise single-line,
  // so replacing every control char with a space is safe.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 0x20 ? " " : s[i];
  }
  return out;
}

async function fetchAll() {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "SUB_NAME,LAND_USE,Dev_Type,PHASE,Municiplty,COUNTY,LOTS_UNITS",
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
    resultRecordCount: "2000",
  });
  const res = await fetch(`${BASE}?${params}`);
  const txt = await res.text();
  const json = JSON.parse(sanitize(txt));
  return json.features ?? [];
}

const clean = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();

const feats = await fetchAll();
const rows = [];
for (const f of feats) {
  const g = f.geometry;
  if (!g || typeof g.x !== "number" || typeof g.y !== "number") continue;
  const a = f.attributes;
  rows.push({
    name: clean(a.SUB_NAME) || "Residential development",
    lat: +g.y.toFixed(5),
    lng: +g.x.toFixed(5),
    units: Math.max(0, Math.round(a.LOTS_UNITS || 0)),
    type: clean(a.LAND_USE) || clean(a.Dev_Type) || "Residential",
    phase: clean(a.PHASE),
    muni: clean(a.Municiplty),
  });
}
rows.sort((x, y) => y.units - x.units);

const totalUnits = rows.reduce((s, r) => s + r.units, 0);
const asOf = new Date().toISOString().slice(0, 10);
const body = `// Generated ${asOf}: LVPC (Lehigh Valley Planning Commission) new residential
// development pipeline — approved / in-progress subdivisions from their public
// ArcGIS "Residential_2024_points" layer, reprojected to WGS84. ${rows.length} projects,
// ${totalUnits.toLocaleString()} housing units. This is the forward-looking "where are
// future families going" signal the Census (today's population) can't give.
// Refresh yearly by re-running scripts/gen-lvpc.mjs.
export interface NewHome {
  name: string;
  lat: number;
  lng: number;
  /** Planned housing units/lots in the project. */
  units: number;
  /** Land-use type (Single Family, Townhome, Apartment, …). */
  type: string;
  /** Development phase code (P = proposed, etc.). */
  phase: string;
  /** Municipality (with county tag). */
  muni: string;
}
export const LVPC_NEW_HOMES: NewHome[] = [
${rows.map((r) => "  " + JSON.stringify(r)).join(",\n")},
];
export const LVPC_NEW_HOMES_TOTAL_UNITS = ${totalUnits};
export const LVPC_NEW_HOMES_AS_OF = ${JSON.stringify(asOf)};
`;

const out = process.argv[2];
writeFileSync(out, body);
console.log(`Wrote ${rows.length} projects, ${totalUnits} units -> ${out}`);
