"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberPoint } from "@/lib/geocode";
import type { SecondCampus, Cohort } from "@/lib/map-analysis";

const LEAFLET_VERSION = "1.9.4";
const CLASS_COLOR: Record<string, string> = {
  shepherded: "#5dc8a8",
  active: "#3b82f6",
  present: "#f59e0b",
  inactive: "#94a3b8",
};
const MEMBER_COLOR = "#5dc8a8";
const NONMEMBER_COLOR = "#94a3b8";
const CHURCH_COLOR = "#ef4444";
const SECOND_COLOR = "#a855f7";

type ColorBy = "shepherding" | "membership";
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
  secondCampuses,
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
  secondCampuses: SecondCampus[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const secondRef = useRef<any>(null);

  const [colorBy, setColorBy] = useState<ColorBy>("shepherding");
  const [hiddenShep, setHiddenShep] = useState<string[]>([]);
  const [hiddenMem, setHiddenMem] = useState<string[]>([]);
  const [secondCohort, setSecondCohort] = useState<Cohort | "none">("all");
  const [loaded, setLoaded] = useState(false);

  // Restore saved preferences once (after mount → avoids SSR/hydration
  // mismatch from reading localStorage during render).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setColorBy(lsGet("shepherdly.map.colorBy", "shepherding"));
    setHiddenShep(lsGet("shepherdly.map.hidden.shepherding", []));
    setHiddenMem(lsGet("shepherdly.map.hidden.membership", []));
    setSecondCohort(lsGet("shepherdly.map.secondCohort", "all"));
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const hidden = colorBy === "membership" ? hiddenMem : hiddenShep;
  const cats = colorBy === "membership" ? MEM_CATS : SHEP_CATS;

  // Build base map per data change.
  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !el || el.dataset.init) return;
        el.dataset.init = "1";
        LRef.current = L;
        const map = L.map(el, { scrollWheelZoom: true }).setView([church.lat, church.lng], 11);
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        draw();
        L.circleMarker([church.lat, church.lng], {
          radius: 8, color: "#fff", weight: 2, fillColor: CHURCH_COLOR, fillOpacity: 1,
        }).bindTooltip(`${church.name} — ${church.address}`).addTo(map);
        drawSecond();
      })
      .catch(() => {
        if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
      });
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = layerRef.current = secondRef.current = null;
      if (el) delete el.dataset.init;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, church, secondCampuses]);

  function draw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    const hideSet = new Set(hidden);
    for (const p of points) {
      const cat = catOf(p, colorBy);
      if (hideSet.has(cat)) continue;
      const c = colorOfCat(cat, colorBy);
      L.circleMarker([p.lat, p.lng], {
        radius: 4, color: c, weight: 1, fillColor: c, fillOpacity: 0.7,
      }).bindTooltip(`${p.name} · ${cat}`).addTo(layer);
    }
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
      radius: 10, color: "#fff", weight: 2, fillColor: SECOND_COLOR, fillOpacity: 1,
    }).bindTooltip(`2nd campus for ${sc.cohort} (${sc.label}) — serves ${sc.served}, avg ${sc.avgMilesBefore.toFixed(1)}→${sc.avgMilesAfter.toFixed(1)} mi`);
    secondRef.current.addTo(map);
  }

  // Redraw dots when filters/mode change.
  useEffect(() => {
    if (loaded) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy, hiddenShep, hiddenMem, loaded]);
  // Redraw 2nd-campus marker when selection changes.
  useEffect(() => {
    drawSecond();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondCohort]);

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

  const cohortOptions = secondCampuses.map((s) => s.cohort);

  return (
    <div className="space-y-2">
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
          {cohortOptions.length > 0 && (
            <>
              <span className="text-muted ml-2 mr-1">2nd campus:</span>
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

      <div
        ref={ref}
        className="w-full rounded-xl overflow-hidden border border-border-soft"
        style={{ height: "70vh", minHeight: 420, background: "var(--bg-elev-2)" }}
      />
    </div>
  );
}
