"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberPoint } from "@/lib/geocode";
import type { SecondCampus, Cohort } from "@/lib/map-analysis";
import type { MeshSegment } from "@/lib/road-mesh";

const LEAFLET_VERSION = "1.9.4";
// Colors tuned for a pale (muted) basemap.
const CLASS_COLOR: Record<string, string> = {
  shepherded: "#eab308", // yellow
  active: "#2563eb", // blue
  present: "#9ca3af", // grey
  inactive: "#64748b", // darker grey (distinct from "present")
};
const MEMBER_COLOR = "#0d9488";
const NONMEMBER_COLOR = "#64748b";
const CHURCH_COLOR = "#dc2626";
const SECOND_COLOR = "#9333ea";
const MESH_COLOR = "#1d4ed8";
// Thickness/opacity hierarchy for the web: thin residential streets →
// thick arterials/highways (the segments the most households funnel onto).
const MESH_TIERS = [
  { weight: 0.5, opacity: 0.35 },
  { weight: 1.0, opacity: 0.45 },
  { weight: 1.7, opacity: 0.55 },
  { weight: 2.6, opacity: 0.68 },
  { weight: 3.8, opacity: 0.82 },
  { weight: 5.2, opacity: 1.0 },
];

type ColorBy = "shepherding" | "membership";
type MapMode = "members" | "roads" | "campus";

interface Basemap {
  id: string;
  label: string;
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
  dark: boolean;
}
// Keyless tile providers on different CDNs, so at least some resolve on
// any network (CARTO's cartocdn.com was failing DNS for the user).
const BASEMAPS: Basemap[] = [
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
const DEFAULT_BASEMAP = "gray";
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
  mode = "members",
  height = "62vh",
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
  secondCampuses?: SecondCampus[];
  mesh?: { segments: MeshSegment[]; maxUsage: number };
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

  const showDotControls = mode !== "roads";
  const [colorBy, setColorBy] = useState<ColorBy>("shepherding");
  const [hiddenShep, setHiddenShep] = useState<string[]>([]);
  const [hiddenMem, setHiddenMem] = useState<string[]>([]);
  const [secondCohort, setSecondCohort] = useState<Cohort | "none">("all");
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setColorBy(lsGet("shepherdly.map.colorBy", "shepherding"));
    setHiddenShep(lsGet("shepherdly.map.hidden.shepherding", []));
    setHiddenMem(lsGet("shepherdly.map.hidden.membership", []));
    setSecondCohort(lsGet("shepherdly.map.secondCohort", "all"));
    setBasemapId(lsGet("shepherdly.map.basemap", DEFAULT_BASEMAP));
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
      .then((L) => {
        if (cancelled || !el || el.dataset.init) return;
        el.dataset.init = "1";
        LRef.current = L;
        const map = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView(
          [church.lat, church.lng],
          11,
        );
        mapRef.current = map;
        tileRef.current = L.tileLayer(basemap.url, {
          subdomains: basemap.subdomains ?? "abc",
          maxZoom: basemap.maxZoom,
          attribution: basemap.attribution,
        }).addTo(map);

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
      })
      .catch(() => {
        if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
      });
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = layerRef.current = secondRef.current = meshRef.current = tileRef.current = churchRef.current = null;
      if (el) delete el.dataset.init;
    };
    // Only re-init the whole map when the underlying data/mode changes —
    // NOT on filter toggles. (secondCampuses/mesh are referentially
    // unstable props; their redraws are handled by dedicated effects.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, church, mode]);

  // Swap the basemap tiles when the user picks a different provider.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(basemap.url, {
      subdomains: basemap.subdomains ?? "abc",
      maxZoom: basemap.maxZoom,
      attribution: basemap.attribution,
    }).addTo(map);
    tileRef.current.bringToBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapId]);

  function drawMesh() {
    const L = LRef.current;
    const layer = meshRef.current;
    if (!L || !layer || !mesh || mesh.segments.length === 0) return;
    layer.clearLayers();
    const maxU = Math.max(1, mesh.maxUsage);
    const N = MESH_TIERS.length;
    const tiers: Array<Array<[number, number][]>> = MESH_TIERS.map(() => []);
    for (const s of mesh.segments) {
      const t = Math.min(N - 1, Math.floor((Math.log(s.usage) / Math.log(maxU + 1)) * N));
      tiers[t].push([[s.ay, s.ax], [s.by, s.bx]]);
    }
    tiers.forEach((segs, i) => {
      if (segs.length === 0) return;
      L.polyline(segs, {
        color: MESH_COLOR,
        weight: MESH_TIERS[i].weight,
        opacity: MESH_TIERS[i].opacity,
        interactive: false,
      }).addTo(layer);
    });
    churchRef.current?.bringToFront();
  }

  function draw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
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
      const cat = catOf(p, colorBy);
      if (hideSet.has(cat)) continue;
      const c = colorOfCat(cat, colorBy);
      L.circleMarker([p.lat, p.lng], {
        radius: 4, color: "#1f2937", weight: 0.6, fillColor: c, fillOpacity: 0.9,
      }).bindTooltip(`${p.name} · ${cat}`).addTo(layer);
    }
    churchRef.current?.bringToFront();
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
  }, [mesh?.segments.length, mesh?.maxUsage]);

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
            roads driven (thicker = more households)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHURCH_COLOR }} />
            Faith Church
          </span>
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
