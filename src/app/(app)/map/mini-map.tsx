"use client";

import { useEffect, useRef } from "react";
import { loadLeaflet } from "./member-map";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Small satellite map centered tightly on one campus, so you can see the
 *  building and lot. Esri World Imagery (keyless). */
export function MiniMap({
  lat,
  lng,
  label,
  zoom = 16,
  height = "240px",
}: {
  lat: number;
  lng: number;
  label?: string;
  zoom?: number;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    const el = ref.current;
    let cancelled = false;
    loadLeaflet().then((L: any) => {
      if (cancelled || !el || el.dataset.init) return;
      el.dataset.init = "1";
      const map = L.map(el, { scrollWheelZoom: false, attributionControl: false }).setView([lat, lng], zoom);
      mapRef.current = map;
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "&copy; Esri",
      }).addTo(map);
      const m = L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 });
      if (label) m.bindTooltip(label);
      m.addTo(map);
      setTimeout(() => { try { map.invalidateSize(); } catch { /* unmounted */ } }, 120);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      if (el) delete el.dataset.init;
    };
  }, [lat, lng, zoom, label]);

  return <div ref={ref} className="w-full rounded-xl overflow-hidden border border-border-soft" style={{ height, background: "#0b1220" }} />;
}
