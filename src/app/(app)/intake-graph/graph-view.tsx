"use client";

import { useEffect, useRef } from "react";
import type { GraphData } from "@/lib/intake-graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Force-directed "who knows who" web. Shepherd-team members are blue, everyone
 *  else grey; a person can be known by several people (multiple edges). */
export function IntakeGraphView({ data, height = 480 }: { data: GraphData; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const modRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current || data.nodes.length === 0) return;
      if (!modRef.current) modRef.current = await import("echarts");
      if (cancelled || !ref.current) return;
      if (!chartRef.current) chartRef.current = modRef.current.init(ref.current, null, { renderer: "canvas" });
      chartRef.current.setOption({
        backgroundColor: "transparent",
        tooltip: { formatter: (p: any) => (p.dataType === "node" ? p.data.displayName : ""), backgroundColor: "#0b1220", borderColor: "rgba(148,163,184,0.3)", textStyle: { color: "#e2e8f0" } },
        legend: [{ data: ["Shepherd team", "Everyone else"], top: 0, textStyle: { color: "#94a3b8" } }],
        series: [{
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          categories: [{ name: "Shepherd team", itemStyle: { color: "#2563eb" } }, { name: "Everyone else", itemStyle: { color: "#9ca3af" } }],
          data: data.nodes.map((nd) => ({ id: nd.id, name: nd.id, displayName: nd.name, category: nd.onTeam ? 0 : 1, symbolSize: Math.min(34, 8 + nd.degree * 3.5) })),
          links: data.links.map((l) => ({ source: l.source, target: l.target })),
          label: { show: true, position: "right", color: "#94a3b8", fontSize: 10, formatter: (p: any) => p.data.displayName },
          force: { repulsion: 160, edgeLength: 80, gravity: 0.08 },
          lineStyle: { color: "source", opacity: 0.4, curveness: 0.1 },
          emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        }],
      }, true);
    })();
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    if (el) ro.observe(el);
    return () => { ro.disconnect(); chartRef.current?.dispose?.(); chartRef.current = null; };
  }, []);

  if (data.nodes.length === 0) {
    return <div className="py-14 text-center text-sm text-subtle">No connections yet — people appear here as they flag who they know.</div>;
  }
  return <div ref={ref} style={{ width: "100%", height }} />;
}
