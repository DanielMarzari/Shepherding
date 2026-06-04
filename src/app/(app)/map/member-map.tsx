"use client";

import { useEffect, useRef } from "react";
import type { MemberPoint } from "@/lib/geocode";

const LEAFLET_VERSION = "1.9.4";
const CLASS_COLOR: Record<string, string> = {
  shepherded: "#5dc8a8",
  active: "#3b82f6",
  present: "#f59e0b",
  inactive: "#94a3b8",
};
const CHURCH_COLOR = "#ef4444";

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

export function MemberMap({
  church,
  points,
}: {
  church: { lat: number; lng: number; name: string; address: string };
  points: MemberPoint[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    let map: any;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !el || el.dataset.init) return;
        el.dataset.init = "1";
        map = L.map(el, { scrollWheelZoom: true }).setView(
          [church.lat, church.lng],
          11,
        );
        L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 18,
            attribution: "&copy; OpenStreetMap contributors",
          },
        ).addTo(map);

        // Member dots.
        for (const p of points) {
          L.circleMarker([p.lat, p.lng], {
            radius: 4,
            color: CLASS_COLOR[p.classification] ?? CLASS_COLOR.inactive,
            weight: 1,
            fillColor: CLASS_COLOR[p.classification] ?? CLASS_COLOR.inactive,
            fillOpacity: 0.7,
          })
            .bindTooltip(`${p.name} · ${p.classification}`)
            .addTo(map);
        }

        // Church marker (distinct, drawn last so it's on top).
        L.circleMarker([church.lat, church.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: CHURCH_COLOR,
          fillOpacity: 1,
        })
          .bindTooltip(`${church.name} — ${church.address}`, { permanent: false })
          .addTo(map);
      })
      .catch(() => {
        if (el) {
          el.innerHTML =
            '<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:13px">Map failed to load.</div>';
        }
      });

    return () => {
      cancelled = true;
      if (map) map.remove();
      if (el) delete el.dataset.init;
    };
  }, [church, points]);

  return (
    <div
      ref={ref}
      className="w-full rounded-xl overflow-hidden border border-border-soft"
      style={{ height: "70vh", minHeight: 420, background: "var(--bg-elev-2)" }}
    />
  );
}
