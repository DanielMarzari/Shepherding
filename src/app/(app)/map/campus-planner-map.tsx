"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberPoint } from "@/lib/geocode";
import type { RoadLine } from "@/lib/road-mesh";
import { LEHIGH_VALLEY_REGION } from "@/lib/lehigh-valley";
import { LV_TRACTS } from "@/lib/lv-census";
import {
  loadLeaflet,
  makeBasemapLayer,
  OUTDOOR_BASEMAP,
  CENSUS_METRICS,
  lerpHex,
  metricVal,
  type CensusMetric,
  type CensusTractView,
} from "./member-map";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PlannerTract extends CensusTractView {
  clat: number;
  clng: number;
}

const CLASS_COLOR: Record<string, string> = {
  shepherded: "#eab308",
  active: "#2563eb",
  present: "#9ca3af",
  inactive: "#cbd5e1",
};
const FC_COLOR = "#dc2626";
const LV_COLOR = "#7c3aed";
const DOT_BLUE = "#2563eb";
const SHEP_CATS = ["shepherded", "active", "present", "inactive"];

function hav(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function pir(lng: number, lat: number, r: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function tractCostAt(lat: number, lng: number, byGeoid: Map<string, PlannerTract>): number | null {
  for (const f of LV_TRACTS.features) {
    const g = f.geometry as any;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const hit = polys.some((p: number[][][]) => {
      if (!pir(lng, lat, p[0])) return false;
      for (let i = 1; i < p.length; i++) if (pir(lng, lat, p[i])) return false;
      return true;
    });
    if (hit) return byGeoid.get(f.properties.geoid)?.cost ?? null;
  }
  return null;
}

interface Stats {
  lat: number;
  lng: number;
  closer: number;
  byClass: Record<string, number>;
  avgNearest: number;
  baselineAvg: number;
  estCost: number | null;
  unreached: number;
  churches: number;
}

function lsGet(k: string, f: any) {
  try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; }
}
function lsSet(k: string, v: any) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}

export function CampusPlannerMap({
  church,
  points,
  tracts,
  mesh,
  initial,
  height = "66vh",
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
  tracts: PlannerTract[];
  mesh?: { roads: RoadLine[] };
  initial: { lat: number; lng: number };
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const fcRef = useRef<any>(null);
  const lvRef = useRef<any>(null);

  const byGeoid = useRef(new Map(tracts.map((t) => [t.geoid, t]))).current;

  const [showDots, setShowDots] = useState(true);
  const [metric, setMetric] = useState<CensusMetric | "none">("need");
  const [showRoads, setShowRoads] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setShowDots(lsGet("shepherdly.planner.dots", true));
    setMetric(lsGet("shepherdly.planner.metric", "need"));
    setShowRoads(lsGet("shepherdly.planner.roads", false));
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function compute(lat: number, lng: number): Stats {
    const byClass: Record<string, number> = { shepherded: 0, active: 0, present: 0, inactive: 0 };
    let closer = 0, nearestSum = 0, baseSum = 0;
    for (const p of points) {
      const dNew = hav(p.lat, p.lng, lat, lng);
      const dFc = hav(p.lat, p.lng, church.lat, church.lng);
      nearestSum += Math.min(dNew, dFc);
      baseSum += dFc;
      if (dNew < dFc) {
        closer++;
        byClass[p.classification] = (byClass[p.classification] ?? 0) + 1;
      }
    }
    let unreached = 0, churches = 0;
    for (const t of tracts) {
      const dNew = hav(t.clat, t.clng, lat, lng);
      const dFc = hav(t.clat, t.clng, church.lat, church.lng);
      if (dNew < dFc) unreached += t.unchurched;
      if (dNew <= 3) churches += t.churches; // within ~3 miles
    }
    const n = points.length || 1;
    return {
      lat, lng, closer, byClass,
      avgNearest: nearestSum / n,
      baselineAvg: baseSum / n,
      estCost: tractCostAt(lat, lng, byGeoid),
      unreached, churches,
    };
  }

  function renderOverlay() {
    const L = LRef.current;
    const layer = overlayRef.current;
    if (!L || !layer) return;
    layer.clearLayers();

    if (metric !== "none") {
      let max = 0, min = Infinity;
      for (const t of tracts) {
        const v = metricVal(t, metric);
        if (v > max) max = v;
        if (v < min) min = v;
      }
      const lo = metric === "cost" || metric === "churches" ? min : 0;
      const span = Math.max(metric === "churches" ? 0.001 : 1, max - lo);
      const sch = CENSUS_METRICS[metric];
      L.geoJSON(LV_TRACTS, {
        style: (f: any) => {
          const t = byGeoid.get(f.properties.geoid);
          const v = t ? metricVal(t, metric) : lo;
          return { fillColor: lerpHex(sch.from, sch.to, (v - lo) / span), fillOpacity: 0.6, color: "#fff", weight: 0.4, opacity: 0.4 };
        },
        onEachFeature: (f: any, ly: any) => {
          const t = byGeoid.get(f.properties.geoid);
          if (t) ly.bindTooltip(`<b>${t.name}</b><br>pop ${Math.round(t.pop).toLocaleString()} · ~${Math.round(t.unchurched).toLocaleString()} unchurched · ${t.churches} churches<br>${t.ourCount} of our people · land $${Math.round(t.cost).toLocaleString()}`, { sticky: true });
        },
      }).addTo(layer);
    }

    if (showRoads && mesh && mesh.roads.length) {
      L.polyline(mesh.roads.map((r) => r.coords), { color: "#1d4ed8", weight: 1.2, opacity: 0.5, interactive: false }).addTo(layer);
    }

    if (showDots) {
      for (const p of points) {
        const c = CLASS_COLOR[p.classification] ?? CLASS_COLOR.inactive;
        L.circleMarker([p.lat, p.lng], { radius: 3, color: "#1f2937", weight: 0.4, fillColor: c, fillOpacity: 0.85 }).addTo(layer);
      }
    }

    // anchors above everything
    lvRef.current?.bringToFront?.();
    fcRef.current?.bringToFront?.();
    markerRef.current?.setZIndexOffset?.(1000);
  }

  // init
  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    loadLeaflet().then(async (L: any) => {
      if (cancelled || !el || el.dataset.init) return;
      el.dataset.init = "1";
      LRef.current = L;
      const map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView([church.lat, church.lng], 11);
      mapRef.current = map;
      const tile = await makeBasemapLayer(L, OUTDOOR_BASEMAP);
      if (cancelled) return;
      tile.addTo(map);
      tile.bringToBack?.();

      lvRef.current = L.geoJSON(LEHIGH_VALLEY_REGION, {
        interactive: false,
        style: { color: LV_COLOR, weight: 1.5, opacity: 0.85, fillColor: LV_COLOR, fillOpacity: 0.06 },
      }).addTo(map);
      const lvBounds = lvRef.current.getBounds();
      try { map.fitBounds(lvBounds, { padding: [12, 12] }); } catch { /* noop */ }

      overlayRef.current = L.layerGroup().addTo(map);
      renderOverlay();

      fcRef.current = L.circleMarker([church.lat, church.lng], {
        radius: 8, color: "#fff", weight: 2, fillColor: FC_COLOR, fillOpacity: 1,
      }).bindTooltip(`${church.name} — ${church.address}`).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${DOT_BLUE};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      markerRef.current = L.marker([initial.lat, initial.lng], { draggable: true, icon, zIndexOffset: 1000 })
        .bindTooltip("Drag me to test a campus location", { direction: "top" })
        .addTo(map);
      setStats(compute(initial.lat, initial.lng));
      markerRef.current.on("drag", (e: any) => {
        const ll = e.target.getLatLng();
        setStats(compute(ll.lat, ll.lng));
      });

      setTimeout(() => {
        try { map.invalidateSize(); map.fitBounds(lvBounds, { padding: [12, 12] }); } catch { /* noop */ }
      }, 120);
    }).catch(() => {
      if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
    });
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = overlayRef.current = markerRef.current = fcRef.current = lvRef.current = null;
      if (el) delete el.dataset.init;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-render overlay when layer toggles change
  useEffect(() => {
    if (loaded) renderOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDots, metric, showRoads, loaded]);

  function toggleDots() { const v = !showDots; setShowDots(v); lsSet("shepherdly.planner.dots", v); }
  function toggleRoads() { const v = !showRoads; setShowRoads(v); lsSet("shepherdly.planner.roads", v); }
  function pickMetric(m: CensusMetric | "none") { setMetric(m); lsSet("shepherdly.planner.metric", m); }

  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row gap-3">
        {/* MAP */}
        <div className="order-2 lg:order-1 flex-1 min-w-0">
          <div ref={ref} className="w-full rounded-xl overflow-hidden border border-border-soft" style={{ height, minHeight: 380, background: "#e5e7eb" }} />
        </div>
        {/* SETTINGS */}
        <div className="order-1 lg:order-2 lg:w-60 shrink-0 space-y-3 text-xs">
          <div className="space-y-1.5">
            <div className="text-muted font-medium">Layers (stack to compare)</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showDots} onChange={toggleDots} />
              <span className="text-muted">Our people (dots)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showRoads} onChange={toggleRoads} disabled={!mesh?.roads.length} />
              <span className="text-muted">Roads driven</span>
            </label>
          </div>
          <div className="space-y-1.5">
            <div className="text-muted font-medium">Shade tracts by</div>
            <div className="flex flex-wrap gap-1.5">
              {(["none", ...Object.keys(CENSUS_METRICS)] as (CensusMetric | "none")[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pickMetric(m)}
                  className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${metric === m ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"}`}
                  title={m === "none" ? "no shading" : CENSUS_METRICS[m as CensusMetric].legend}
                >
                  {m === "none" ? "None" : CENSUS_METRICS[m as CensusMetric].label}
                </button>
              ))}
            </div>
            {metric !== "none" && (
              <>
                <div className="h-2.5 w-full rounded-full" style={{ background: `linear-gradient(to right, ${CENSUS_METRICS[metric].from}, ${CENSUS_METRICS[metric].to})` }} />
                <span className="text-subtle">low → high {CENSUS_METRICS[metric].legend}</span>
              </>
            )}
          </div>
          <div className="space-y-1.5 text-muted">
            <div className="font-medium">Legend</div>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3.5 h-3.5 rounded-full" style={{ background: DOT_BLUE, border: "2px solid #fff", boxShadow: "0 0 0 1px #0006" }} />candidate campus (drag)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: FC_COLOR }} />Faith Church</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm border" style={{ background: `${LV_COLOR}22`, borderColor: LV_COLOR }} />Lehigh Valley</span>
          </div>
        </div>
      </div>

      {/* LIVE STATS */}
      {stats && (
        <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4">
          <div className="text-xs text-muted mb-2">
            Candidate campus at {stats.lat.toFixed(4)}, {stats.lng.toFixed(4)} — drag the blue dot to update
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Metric label="Closer than Faith Church" value={`${stats.closer.toLocaleString()} homes`} sub={SHEP_CATS.map((c) => `${stats.byClass[c] ?? 0} ${c}`).join(" · ")} />
            <Metric label="Avg distance to nearest campus" value={`${stats.avgNearest.toFixed(1)} mi`} sub={`vs ${stats.baselineAvg.toFixed(1)} mi to FC only`} />
            <Metric label="Est. land cost" value={stats.estCost != null ? usd(stats.estCost) : "—"} sub="median home value here" />
            <Metric label="Unreached it would serve" value={`~${Math.round(stats.unreached).toLocaleString()}`} sub="unchurched closer to here than FC" />
            <Metric label="Existing churches nearby" value={`${stats.churches}`} sub="within ~3 miles" />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg/40 p-3">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className="tnum text-base font-semibold">{value}</div>
      <div className="text-[11px] text-subtle mt-0.5">{sub}</div>
    </div>
  );
}
