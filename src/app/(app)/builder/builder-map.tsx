"use client";

import { useEffect, useRef } from "react";
import type { QueryResult } from "@/lib/builder";

/* eslint-disable @typescript-eslint/no-explicit-any */

const LEAFLET_VERSION = "1.9.4";
const FC: [number, number] = [40.6935, -75.5844]; // Faith Church, Allentown PA

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
    if (ex) { ex.addEventListener("load", () => resolve((window as any).L)); return; }
    const s = document.createElement("script");
    s.id = "leaflet-js";
    s.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    s.onload = () => resolve((window as any).L);
    s.onerror = () => reject(new Error("Leaflet load failed"));
    document.body.appendChild(s);
  });
}

/** Plots a query as points: col1 = lat, col2 = lng, col3 = label (opt), col4 = size (opt). */
export function BuilderMap({ result }: { result: QueryResult | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    if (!result || result.error) return;
    loadLeaflet().then((L: any) => {
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { scrollWheelZoom: false, attributionControl: false, preferCanvas: true }).setView(FC, 10);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 19 }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      const group = L.layerGroup();
      const pts: [number, number][] = [];
      let maxV = 0;
      for (const r of result.rows) { const v = Number(r[3]); if (Number.isFinite(v)) maxV = Math.max(maxV, v); }
      for (const r of result.rows) {
        const lat = Number(r[0]), lng = Number(r[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const v = Number(r[3]);
        const radius = maxV > 0 && Number.isFinite(v) ? 4 + 11 * Math.sqrt(v / maxV) : 5;
        const m = L.circleMarker([lat, lng], { radius, color: "#2563eb", weight: 1, fillColor: "#2563eb", fillOpacity: 0.5 });
        if (r[2] != null && String(r[2]).trim()) m.bindPopup(String(r[2]));
        m.addTo(group);
        pts.push([lat, lng]);
      }
      group.addTo(map);
      layerRef.current = group;
      if (pts.length) { try { map.fitBounds(pts as any, { padding: [24, 24], maxZoom: 13 }); } catch { /* single/invalid */ } }
      setTimeout(() => map.invalidateSize(), 60);
    });
    return () => { cancelled = true; };
  }, [result]);

  useEffect(() => () => { mapRef.current?.remove?.(); mapRef.current = null; }, []);

  if (!result) return <div className="py-6 text-center text-xs text-subtle">No data yet.</div>;
  if (result.error) return <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-3 py-2 text-xs text-warn-soft-fg">{result.error}</div>;
  return <div ref={ref} className="rounded-lg overflow-hidden border border-border-soft" style={{ width: "100%", height: 300 }} />;
}
