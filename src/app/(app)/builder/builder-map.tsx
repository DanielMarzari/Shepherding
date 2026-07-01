"use client";

import { useEffect, useRef } from "react";
import type { QueryResult } from "@/lib/builder";

/* eslint-disable @typescript-eslint/no-explicit-any */

const LEAFLET_VERSION = "1.9.4";
const FC: [number, number] = [40.6935, -75.5844]; // Faith Church, Allentown PA
// OpenFreeMap "Liberty" — the same outdoor vector style the campus planner uses.
const OUTDOOR_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function loadScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ex = document.getElementById(id) as HTMLScriptElement | null;
    if (ex) {
      if (ex.dataset.loaded) resolve();
      else { ex.addEventListener("load", () => resolve()); ex.addEventListener("error", () => reject(new Error(`${id} failed`))); }
      return;
    }
    const s = document.createElement("script");
    s.id = id; s.src = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error(`${id} failed`));
    document.body.appendChild(s);
  });
}

function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (!document.getElementById("leaflet-css")) {
    const link = document.createElement("link");
    link.id = "leaflet-css"; link.rel = "stylesheet";
    link.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
    document.head.appendChild(link);
  }
  return loadScript("leaflet-js", `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`).then(() => (window as any).L);
}

function loadMaplibre(): Promise<void> {
  const w = window as any;
  if (w.maplibregl && w.L?.maplibreGL) return Promise.resolve();
  if (!document.getElementById("maplibre-css")) {
    const link = document.createElement("link");
    link.id = "maplibre-css"; link.rel = "stylesheet";
    link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    document.head.appendChild(link);
  }
  return loadScript("maplibre-gl-js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js")
    .then(() => loadScript("maplibre-gl-leaflet-js", "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.0/leaflet-maplibre-gl.js"));
}

/** Outdoor vector basemap, falling back to an Esri gray raster if GL fails. */
async function outdoorBasemap(L: any): Promise<any> {
  try {
    await loadMaplibre();
    return (L as any).maplibreGL({ style: OUTDOOR_STYLE, attribution: "&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap" });
  } catch {
    return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "&copy; Esri" });
  }
}

/** Plots a query as points: col1 = lat, col2 = lng, col3 = label (opt), col4 = size (opt). */
export function BuilderMap({ result, height = 300 }: { result: QueryResult | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    if (!result || result.error) return;
    loadLeaflet().then(async (L: any) => {
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { scrollWheelZoom: false, attributionControl: false, preferCanvas: true }).setView(FC, 10);
        const base = await outdoorBasemap(L);
        if (cancelled) return;
        base.addTo(mapRef.current);
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
        const m = L.circleMarker([lat, lng], { radius, color: "#1d4ed8", weight: 1, fillColor: "#2563eb", fillOpacity: 0.6 });
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

  useEffect(() => { const id = setTimeout(() => mapRef.current?.invalidateSize?.(), 60); return () => clearTimeout(id); }, [height]);
  useEffect(() => () => { mapRef.current?.remove?.(); mapRef.current = null; }, []);

  if (!result) return <div className="py-6 text-center text-xs text-subtle">No data yet.</div>;
  if (result.error) return <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-3 py-2 text-xs text-warn-soft-fg">{result.error}</div>;
  return <div ref={ref} className="rounded-lg overflow-hidden border border-border-soft" style={{ width: "100%", height, background: "#e5e7eb" }} />;
}
