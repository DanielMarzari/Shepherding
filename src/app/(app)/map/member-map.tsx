"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberPoint } from "@/lib/geocode";

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

interface SecondCampus {
  lat: number;
  lng: number;
  label: string;
}

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
    const existing = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).L));
      return;
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject(new Error("Failed to load Leaflet"));
    document.body.appendChild(script);
  });
}

function colorFor(p: MemberPoint, mode: ColorBy): string {
  if (mode === "membership") return p.isMember ? MEMBER_COLOR : NONMEMBER_COLOR;
  return CLASS_COLOR[p.classification] ?? CLASS_COLOR.inactive;
}

export function MemberMap({
  church,
  points,
  secondCampus,
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
  secondCampus?: SecondCampus | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const secondRef = useRef<any>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("shepherding");
  const [showSecond, setShowSecond] = useState(true);

  // Build the base map once per data change.
  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !el || el.dataset.init) return;
        el.dataset.init = "1";
        LRef.current = L;
        const map = L.map(el, { scrollWheelZoom: true }).setView(
          [church.lat, church.lng],
          11,
        );
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        layerRef.current = L.layerGroup().addTo(map);
        drawMarkers(colorBy);

        // Church (always on top of dots → added after layer).
        L.circleMarker([church.lat, church.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: CHURCH_COLOR,
          fillOpacity: 1,
        })
          .bindTooltip(`${church.name} — ${church.address}`)
          .addTo(map);

        if (secondCampus) {
          secondRef.current = L.circleMarker([secondCampus.lat, secondCampus.lng], {
            radius: 9,
            color: "#ffffff",
            weight: 2,
            fillColor: SECOND_COLOR,
            fillOpacity: 1,
          }).bindTooltip(`Suggested 2nd campus (${secondCampus.label})`);
          if (showSecond) secondRef.current.addTo(map);
        }
      })
      .catch(() => {
        if (el)
          el.innerHTML =
            '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
      });

    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      layerRef.current = null;
      secondRef.current = null;
      if (el) delete el.dataset.init;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, church, secondCampus]);

  // Redraw dots when the color mode changes.
  function drawMarkers(mode: ColorBy) {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const p of points) {
      const c = colorFor(p, mode);
      L.circleMarker([p.lat, p.lng], {
        radius: 4,
        color: c,
        weight: 1,
        fillColor: c,
        fillOpacity: 0.7,
      })
        .bindTooltip(
          `${p.name} · ${mode === "membership" ? (p.isMember ? "member" : "non-member") : p.classification}`,
        )
        .addTo(layer);
    }
  }
  useEffect(() => {
    drawMarkers(colorBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy]);

  // Toggle the 2nd-campus marker.
  useEffect(() => {
    const map = mapRef.current;
    const m = secondRef.current;
    if (!map || !m) return;
    if (showSecond) m.addTo(map);
    else map.removeLayer(m);
  }, [showSecond]);

  const legend =
    colorBy === "shepherding"
      ? [
          ["Shepherded", CLASS_COLOR.shepherded],
          ["Active", CLASS_COLOR.active],
          ["Present", CLASS_COLOR.present],
          ["Inactive", CLASS_COLOR.inactive],
        ]
      : [
          ["Member", MEMBER_COLOR],
          ["Non-member", NONMEMBER_COLOR],
        ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted mr-1">Color by:</span>
          {(["shepherding", "membership"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setColorBy(m)}
              className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                colorBy === m
                  ? "border-accent bg-bg-elev-2 text-fg"
                  : "border-border-soft text-muted hover:text-fg"
              }`}
            >
              {m === "shepherding" ? "Shepherding" : "Membership"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHURCH_COLOR }} />
            Faith Church
          </span>
          {legend.map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-muted">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
          {secondCampus && (
            <label className="inline-flex items-center gap-1.5 text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showSecond}
                onChange={(e) => setShowSecond(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SECOND_COLOR }} />
              2nd campus
            </label>
          )}
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
