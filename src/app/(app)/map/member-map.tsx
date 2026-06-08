"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberPoint } from "@/lib/geocode";
import type { SecondCampus, Cohort } from "@/lib/map-analysis";
import type { RoadLine } from "@/lib/road-mesh";
import { LEHIGH_VALLEY_REGION, LEHIGH_VALLEY_VALID_AREA } from "@/lib/lehigh-valley";
import { LV_TRACTS } from "@/lib/lv-census";

const LV_COLOR = "#7c3aed"; // Lehigh Valley region + its 5-mile valid area

export interface CensusTractView {
  geoid: string;
  name: string;
  pop: number;
  unchurched: number;
  ourCount: number;
  reachPct: number;
  need: number;
}
type CensusMetric = "need" | "unchurched" | "reach";
const CENSUS_METRICS: Record<CensusMetric, { label: string; from: string; to: string; legend: string }> = {
  need: { label: "Need", from: "#fef3c7", to: "#b91c1c", legend: "unchurched & unreached" },
  unchurched: { label: "Unchurched", from: "#dbeafe", to: "#1e3a8a", legend: "unchurched people" },
  reach: { label: "Our reach", from: "#e5e7eb", to: "#15803d", legend: "our people per population" },
};
function lerpHex(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const metricVal = (t: CensusTractView, m: CensusMetric) =>
  m === "need" ? t.need : m === "unchurched" ? t.unchurched : t.reachPct;

const LEAFLET_VERSION = "1.9.4";
// Colors tuned for a pale (muted) basemap.
const CLASS_COLOR: Record<string, string> = {
  shepherded: "#eab308", // yellow
  active: "#2563eb", // blue
  present: "#9ca3af", // grey
  inactive: "#64748b", // darker grey (distinct from "present")
};
const MEMBER_COLOR = "#2563eb"; // blue
const NONMEMBER_COLOR = "#f97316"; // orange — clearly distinct from member
const CHURCH_COLOR = "#dc2626";
const SECOND_COLOR = "#9333ea";
const MESH_COLOR = "#1d4ed8";

type ColorBy = "shepherding" | "membership";
type MapMode = "members" | "roads" | "campus" | "census";

interface Basemap {
  id: string;
  label: string;
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
  dark: boolean;
  /** Vector style (OpenFreeMap / MapLibre GL) rather than raster tiles. */
  vector?: boolean;
}
// Keyless providers on different CDNs, so at least some resolve on any
// network (CARTO's cartocdn.com was failing DNS for the user).
const BASEMAPS: Basemap[] = [
  {
    id: "outdoor",
    label: "Outdoor",
    // OpenFreeMap "Liberty" — the aesthetic vector style ROAM uses.
    url: "https://tiles.openfreemap.org/styles/liberty",
    vector: true,
    maxZoom: 19,
    attribution: "&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap",
    dark: false,
  },
  {
    id: "gray",
    label: "Gray (muted)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    attribution: "&copy; Esri",
    dark: false,
  },
  {
    id: "osm",
    label: "Standard",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
    dark: false,
  },
  {
    id: "streets",
    label: "Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: "&copy; Esri",
    dark: false,
  },
  {
    id: "topo",
    label: "Topographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: "&copy; Esri",
    dark: false,
  },
];
const DEFAULT_BASEMAP = "outdoor";
const SHEP_CATS = ["shepherded", "active", "present", "inactive"];
const MEM_CATS = ["member", "non-member"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (!document.getElementById("leaflet-css")) {
    const link = document.createElement("link");
    link.id = "leaflet-css";
    link.rel = "stylesheet";
    link.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
    document.head.appendChild(link);
  }
  return new Promise((resolve, reject) => {
    const ex = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (ex) {
      ex.addEventListener("load", () => resolve((window as any).L));
      return;
    }
    const s = document.createElement("script");
    s.id = "leaflet-js";
    s.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    s.onload = () => resolve((window as any).L);
    s.onerror = () => reject(new Error("Leaflet load failed"));
    document.body.appendChild(s);
  });
}

function loadScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ex = document.getElementById(id) as HTMLScriptElement | null;
    if (ex) {
      if (ex.dataset.loaded) resolve();
      else {
        ex.addEventListener("load", () => resolve());
        ex.addEventListener("error", () => reject(new Error(`${id} failed`)));
      }
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error(`${id} failed`));
    document.body.appendChild(s);
  });
}

/** Lazy-load MapLibre GL + the Leaflet bridge for vector basemaps. */
function loadMaplibre(): Promise<void> {
  const w = window as any;
  if (w.maplibregl && w.L?.maplibreGL) return Promise.resolve();
  if (!document.getElementById("maplibre-css")) {
    const link = document.createElement("link");
    link.id = "maplibre-css";
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    document.head.appendChild(link);
  }
  return loadScript("maplibre-gl-js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js")
    .then(() => loadScript("maplibre-gl-leaflet-js", "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.0/leaflet-maplibre-gl.js"));
}

/** Build a basemap layer — a MapLibre GL vector layer for vector styles,
 *  else a raster tile layer. Falls back to raster Gray if GL fails. */
async function makeBasemapLayer(L: any, bm: Basemap): Promise<any> {
  if (bm.vector) {
    try {
      await loadMaplibre();
      return (L as any).maplibreGL({ style: bm.url, attribution: bm.attribution });
    } catch {
      // fall through to a safe raster basemap
      return L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 16, attribution: "&copy; Esri" },
      );
    }
  }
  return L.tileLayer(bm.url, {
    subdomains: bm.subdomains ?? "abc",
    maxZoom: bm.maxZoom,
    attribution: bm.attribution,
  });
}

const catOf = (p: MemberPoint, mode: ColorBy) =>
  mode === "membership" ? (p.isMember ? "member" : "non-member") : p.classification;
const colorOfCat = (cat: string, mode: ColorBy) =>
  mode === "membership"
    ? cat === "member"
      ? MEMBER_COLOR
      : NONMEMBER_COLOR
    : CLASS_COLOR[cat] ?? CLASS_COLOR.inactive;

function lsGet(key: string, fallback: any) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key: string, val: any) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

export function MemberMap({
  church,
  points,
  secondCampuses = [],
  mesh,
  census,
  mode = "members",
  height = "62vh",
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
  secondCampuses?: SecondCampus[];
  mesh?: { roads: RoadLine[] };
  census?: { tracts: CensusTractView[]; needCampus?: { lat: number; lng: number } | null };
  mode?: MapMode;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const secondRef = useRef<any>(null);
  const meshRef = useRef<any>(null);
  const tileRef = useRef<any>(null);
  const churchRef = useRef<any>(null);
  const lvRef = useRef<any>(null);
  const censusRef = useRef<any>(null);
  const needCampusRef = useRef<any>(null);

  const showDotControls = mode === "members" || mode === "campus";
  const [colorBy, setColorBy] = useState<ColorBy>("shepherding");
  const [hiddenShep, setHiddenShep] = useState<string[]>([]);
  const [hiddenMem, setHiddenMem] = useState<string[]>([]);
  const [secondCohort, setSecondCohort] = useState<Cohort | "none">("all");
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP);
  const [censusMetric, setCensusMetric] = useState<CensusMetric>("need");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setColorBy(lsGet("shepherdly.map.colorBy", "shepherding"));
    setHiddenShep(lsGet("shepherdly.map.hidden.shepherding", []));
    setHiddenMem(lsGet("shepherdly.map.hidden.membership", []));
    setSecondCohort(lsGet("shepherdly.map.secondCohort", "all"));
    setBasemapId(lsGet("shepherdly.map.basemap", DEFAULT_BASEMAP));
    setCensusMetric(lsGet("shepherdly.map.censusMetric", "need"));
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];

  const hidden = colorBy === "membership" ? hiddenMem : hiddenShep;
  const cats = colorBy === "membership" ? MEM_CATS : SHEP_CATS;

  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    loadLeaflet()
      .then(async (L) => {
        if (cancelled || !el || el.dataset.init) return;
        el.dataset.init = "1";
        LRef.current = L;
        const map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(
          [church.lat, church.lng],
          11,
        );
        mapRef.current = map;
        tileRef.current = await makeBasemapLayer(L, basemap);
        if (cancelled) return;
        tileRef.current.addTo(map);
        tileRef.current.bringToBack?.();

        // Census choropleth sits under the region outline + markers.
        if (mode === "census") {
          censusRef.current = L.layerGroup().addTo(map);
          drawCensus();
        }

        // Lehigh Valley region (filled) + 5-mile valid 2nd-campus area
        // (dashed). Under the data, over the basemap.
        const lvRegion = L.geoJSON(LEHIGH_VALLEY_REGION, {
          interactive: false,
          style: { color: LV_COLOR, weight: 1.5, opacity: 0.85, fillColor: LV_COLOR, fillOpacity: 0.08 },
        });
        const lvArea = L.geoJSON(LEHIGH_VALLEY_VALID_AREA, {
          interactive: false,
          style: { color: LV_COLOR, weight: 1.5, opacity: 0.6, dashArray: "6 5", fill: false },
        });
        lvRef.current = L.layerGroup([lvRegion, lvArea]).addTo(map);

        if (mode === "roads") {
          meshRef.current = L.layerGroup().addTo(map);
          drawMesh();
        }
        layerRef.current = L.layerGroup().addTo(map);
        draw();

        churchRef.current = L.circleMarker([church.lat, church.lng], {
          radius: 8, color: "#fff", weight: 2, fillColor: CHURCH_COLOR, fillOpacity: 1,
        }).bindTooltip(`${church.name} — ${church.address}`).addTo(map);
        churchRef.current.bringToFront();

        if (mode === "campus") drawSecond();
        if (mode === "census" && census?.needCampus) {
          needCampusRef.current = L.circleMarker([census.needCampus.lat, census.needCampus.lng], {
            radius: 11, color: "#fff", weight: 2, fillColor: SECOND_COLOR, fillOpacity: 1,
          }).bindTooltip("Need-based 2nd campus — centers the biggest unreached, unchurched areas").addTo(map);
          needCampusRef.current.bringToFront();
        }
      })
      .catch(() => {
        if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
      });
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = layerRef.current = secondRef.current = meshRef.current = tileRef.current = churchRef.current = lvRef.current = censusRef.current = needCampusRef.current = null;
      if (el) delete el.dataset.init;
    };
    // Only re-init the whole map when the underlying data/mode changes —
    // NOT on filter toggles. (secondCampuses/mesh are referentially
    // unstable props; their redraws are handled by dedicated effects.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, church, mode]);

  // Swap the basemap when the user picks a different provider.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    let stale = false;
    const prev = tileRef.current;
    makeBasemapLayer(L, basemap).then((layer) => {
      if (stale || !mapRef.current) return;
      if (prev) map.removeLayer(prev);
      tileRef.current = layer;
      layer.addTo(map);
      layer.bringToBack?.();
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapId]);

  function drawMesh() {
    const L = LRef.current;
    const layer = meshRef.current;
    if (!L || !layer || !mesh || mesh.roads.length === 0) return;
    layer.clearLayers();
    // Each road drawn once, uniform — presence is the signal, not weight.
    L.polyline(
      mesh.roads.map((r) => r.coords),
      { color: MESH_COLOR, weight: 1.5, opacity: 0.7, interactive: false },
    ).addTo(layer);
    churchRef.current?.bringToFront();
  }

  function draw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (mode === "census") return; // census has no member dots
    // On the roads map, dots are tiny grey context so the web is the star.
    if (mode === "roads") {
      for (const p of points) {
        L.circleMarker([p.lat, p.lng], {
          radius: 2, color: "#475569", weight: 0, fillColor: "#475569", fillOpacity: 0.45,
        }).addTo(layer);
      }
      return;
    }
    const hideSet = new Set(hidden);
    for (const p of points) {
      // In membership view, "non-member" excludes inactive people — they
      // aren't a non-member we're trying to reach, just gone quiet.
      if (colorBy === "membership" && !p.isMember && p.classification === "inactive") continue;
      const cat = catOf(p, colorBy);
      if (hideSet.has(cat)) continue;
      const c = colorOfCat(cat, colorBy);
      L.circleMarker([p.lat, p.lng], {
        radius: 4, color: "#1f2937", weight: 0.6, fillColor: c, fillOpacity: 0.9,
      }).bindTooltip(`${p.name} · ${cat}`).addTo(layer);
    }
    churchRef.current?.bringToFront();
    secondRef.current?.bringToFront();
  }

  function drawSecond() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (secondRef.current) {
      map.removeLayer(secondRef.current);
      secondRef.current = null;
    }
    if (secondCohort === "none") return;
    const sc = secondCampuses.find((s) => s.cohort === secondCohort);
    if (!sc) return;
    secondRef.current = L.circleMarker([sc.lat, sc.lng], {
      radius: 11, color: "#fff", weight: 2, fillColor: SECOND_COLOR, fillOpacity: 1,
    }).bindTooltip(`2nd campus for ${sc.cohort} (${sc.label}) — serves ${sc.served}, avg ${sc.avgMilesBefore.toFixed(1)}→${sc.avgMilesAfter.toFixed(1)} mi`);
    secondRef.current.addTo(map);
    // Both anchors stay above the dots.
    churchRef.current?.bringToFront();
    secondRef.current.bringToFront();
  }

  function drawCensus() {
    const L = LRef.current;
    const layer = censusRef.current;
    if (!L || !layer || !census) return;
    layer.clearLayers();
    const vals = new Map(census.tracts.map((t) => [t.geoid, t]));
    let max = 0;
    for (const t of census.tracts) {
      const v = metricVal(t, censusMetric);
      if (v > max) max = v;
    }
    max = max || 1;
    const scheme = CENSUS_METRICS[censusMetric];
    L.geoJSON(LV_TRACTS, {
      style: (f: any) => {
        const t = vals.get(f.properties.geoid);
        const v = t ? metricVal(t, censusMetric) : 0;
        return { fillColor: lerpHex(scheme.from, scheme.to, v / max), fillOpacity: 0.72, color: "#ffffff", weight: 0.4, opacity: 0.5 };
      },
      onEachFeature: (f: any, lyr: any) => {
        const t = vals.get(f.properties.geoid);
        const tip = t
          ? `<b>${t.name}</b><br>pop ${Math.round(t.pop).toLocaleString()} · ~${Math.round(t.unchurched).toLocaleString()} unchurched<br>${t.ourCount} of our people (${t.reachPct.toFixed(1)}%)`
          : f.properties.name ?? "tract";
        lyr.bindTooltip(tip, { sticky: true });
      },
    }).addTo(layer);
    // Keep the region outline + anchors above the choropleth.
    lvRef.current?.eachLayer?.((l: any) => l.bringToFront?.());
    churchRef.current?.bringToFront?.();
    needCampusRef.current?.bringToFront?.();
  }

  useEffect(() => {
    if (loaded && mode !== "roads") draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy, hiddenShep, hiddenMem, loaded]);
  useEffect(() => {
    if (mode === "campus") drawSecond();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondCohort, secondCampuses.length]);
  // Redraw the web only when the mesh data actually changes (stable key),
  // not on every render — keeps filter/basemap changes from rebuilding it.
  useEffect(() => {
    if (mode === "roads") drawMesh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh?.roads.length]);
  useEffect(() => {
    if (mode === "census") drawCensus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [censusMetric, census?.tracts.length]);

  function toggleCat(cat: string) {
    if (colorBy === "membership") {
      const next = hiddenMem.includes(cat) ? hiddenMem.filter((c) => c !== cat) : [...hiddenMem, cat];
      setHiddenMem(next);
      lsSet("shepherdly.map.hidden.membership", next);
    } else {
      const next = hiddenShep.includes(cat) ? hiddenShep.filter((c) => c !== cat) : [...hiddenShep, cat];
      setHiddenShep(next);
      lsSet("shepherdly.map.hidden.shepherding", next);
    }
  }
  function pickColorBy(m: ColorBy) {
    setColorBy(m);
    lsSet("shepherdly.map.colorBy", m);
  }
  function pickCohort(c: Cohort | "none") {
    setSecondCohort(c);
    lsSet("shepherdly.map.secondCohort", c);
  }
  function pickBasemap(id: string) {
    setBasemapId(id);
    lsSet("shepherdly.map.basemap", id);
  }
  function pickCensusMetric(m: CensusMetric) {
    setCensusMetric(m);
    lsSet("shepherdly.map.censusMetric", m);
  }

  const cohortOptions = secondCampuses.map((s) => s.cohort);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted mr-1">Basemap:</span>
        <select
          value={basemapId}
          onChange={(e) => pickBasemap(e.target.value)}
          className="bg-bg-elev-2 border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer"
        >
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <span className="text-subtle ml-1">
          if tiles don&apos;t load, try another provider
        </span>
      </div>
      {showDotControls && (
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted mr-1">Color by:</span>
            {(["shepherding", "membership"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickColorBy(m)}
                className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                  colorBy === m ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"
                }`}
              >
                {m === "shepherding" ? "Shepherding" : "Membership"}
              </button>
            ))}
            {mode === "campus" && cohortOptions.length > 0 && (
              <>
                <span className="text-muted ml-2 mr-1">Plan for:</span>
                <select
                  value={secondCohort}
                  onChange={(e) => pickCohort(e.target.value as Cohort | "none")}
                  className="bg-bg-elev-2 border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer"
                >
                  <option value="none">hide</option>
                  {cohortOptions.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "Everyone" : c}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHURCH_COLOR }} />
              Faith Church
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: `${LV_COLOR}22`, borderColor: LV_COLOR }} />
              Lehigh Valley
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: LV_COLOR }} />
              2nd-campus area (+5 mi)
            </span>
            {mode === "campus" && (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SECOND_COLOR }} />
                2nd campus
              </span>
            )}
            {cats.map((cat) => {
              const on = !hidden.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCat(cat)}
                  className="inline-flex items-center gap-1.5 cursor-pointer"
                  title={on ? "Click to hide" : "Click to show"}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: colorOfCat(cat, colorBy), opacity: on ? 1 : 0.3 }}
                  />
                  <span className={on ? "text-muted" : "text-subtle line-through"}>{cat}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {mode === "roads" && (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-1 rounded-full" style={{ background: MESH_COLOR }} />
            roads your people drive to Faith Church
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHURCH_COLOR }} />
            Faith Church
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: `${LV_COLOR}22`, borderColor: LV_COLOR }} />
            Lehigh Valley
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: LV_COLOR }} />
            2nd-campus area (+5 mi)
          </span>
        </div>
      )}
      {mode === "census" && (
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted mr-1">Color by:</span>
            {(Object.keys(CENSUS_METRICS) as CensusMetric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickCensusMetric(m)}
                className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                  censusMetric === m ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"
                }`}
                title={CENSUS_METRICS[m].legend}
              >
                {CENSUS_METRICS[m].label}
              </button>
            ))}
            <span
              className="ml-2 inline-block h-2.5 w-24 rounded-full"
              style={{ background: `linear-gradient(to right, ${CENSUS_METRICS[censusMetric].from}, ${CENSUS_METRICS[censusMetric].to})` }}
            />
            <span className="text-subtle">low → high {CENSUS_METRICS[censusMetric].legend}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHURCH_COLOR }} />
              Faith Church
            </span>
            {census?.needCampus && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SECOND_COLOR }} />
                need-based 2nd campus
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: `${LV_COLOR}22`, borderColor: LV_COLOR }} />
              Lehigh Valley
            </span>
          </div>
        </div>
      )}

      <div
        ref={ref}
        className="w-full rounded-xl overflow-hidden border border-border-soft"
        style={{ height, minHeight: 360, background: basemap.dark ? "#0b1220" : "#e5e7eb" }}
      />
    </div>
  );
}
