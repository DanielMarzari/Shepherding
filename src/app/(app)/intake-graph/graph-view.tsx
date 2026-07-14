"use client";

import { useEffect, useRef } from "react";
import type { GraphData, GraphNode } from "@/lib/intake-graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Obsidian-style palette
const C_TEAM = "#4c8dff"; // shepherd team — blue
const C_KNOWN = "#c8ccd4"; // connected, not on team — light grey
const C_UNKNOWN = "#4a5160"; // not yet known — dim grey field
const C_EDGE = "rgba(148, 163, 184, 0.22)";

interface Pos { x: number; y: number }

/** Deterministic layout, computed once (no live force sim — nothing spins):
 *  connected nodes get a small spring/repulsion sim; everyone else fills a
 *  phyllotaxis (sunflower) field around the cluster, like Obsidian's dot sea. */
function layout(data: GraphData): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const connected = data.nodes.filter((n) => n.degree > 0);
  const isolated = data.nodes.filter((n) => n.degree === 0);

  // Seeded pseudo-random so the layout is stable across reloads.
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  // ── connected cluster: tiny custom force sim ─────────────────────
  const idx = new Map(connected.map((n, i) => [n.id, i]));
  const px = new Float64Array(connected.length);
  const py = new Float64Array(connected.length);
  for (let i = 0; i < connected.length; i++) {
    const a = rand() * Math.PI * 2;
    const r = 40 + rand() * 120;
    px[i] = Math.cos(a) * r;
    py[i] = Math.sin(a) * r;
  }
  const edges: Array<[number, number]> = [];
  for (const l of data.links) {
    const a = idx.get(l.source), b = idx.get(l.target);
    if (a != null && b != null) edges.push([a, b]);
  }
  const n = connected.length;
  if (n > 0) {
    const iterations = n > 600 ? 120 : 260;
    for (let it = 0; it < iterations; it++) {
      const t = 1 - it / iterations; // cooling
      // repulsion (O(n²) — fine for the connected subset)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = px[i] - px[j], dy = py[i] - py[j];
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 1; }
          const f = (2600 / d2) * t;
          const d = Math.sqrt(d2);
          px[i] += (dx / d) * f; py[i] += (dy / d) * f;
          px[j] -= (dx / d) * f; py[j] -= (dy / d) * f;
        }
      }
      // springs
      for (const [a, b] of edges) {
        const dx = px[b] - px[a], dy = py[b] - py[a];
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = ((d - 90) / d) * 0.06 * t;
        px[a] += dx * f; py[a] += dy * f;
        px[b] -= dx * f; py[b] -= dy * f;
      }
      // gentle centering
      for (let i = 0; i < n; i++) { px[i] *= 1 - 0.012 * t; py[i] *= 1 - 0.012 * t; }
    }
  }
  let clusterR = 60;
  for (let i = 0; i < n; i++) {
    clusterR = Math.max(clusterR, Math.hypot(px[i], py[i]));
    pos.set(connected[i].id, { x: px[i], y: py[i] });
  }

  // ── the not-yet-known field: sunflower spiral around the cluster ──
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const startR = clusterR + 70;
  for (let i = 0; i < isolated.length; i++) {
    const r = startR + 11 * Math.sqrt(i + 1);
    const a = i * GOLDEN + rand() * 0.05;
    pos.set(isolated[i].id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pos;
}

function category(nd: GraphNode): number {
  if (nd.onTeam) return 0;
  return nd.degree > 0 ? 1 : 2;
}

/** Obsidian-style "who knows who" web: static layout, pan/zoom roam, hover to
 *  light up a node's neighborhood. Blue = shepherd team, grey = known, dim
 *  field = not yet known by anyone. */
export function IntakeGraphView({ data, height = 520 }: { data: GraphData; height?: number }) {
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

      const pos = layout(data);
      const connectedCount = data.nodes.filter((nd) => nd.degree > 0).length;
      const showLabels = connectedCount > 0 && connectedCount <= 150;

      chartRef.current.setOption({
        backgroundColor: "transparent",
        tooltip: {
          formatter: (p: any) => (p.dataType === "node" ? p.data.displayName : ""),
          backgroundColor: "#0b1220", borderColor: "rgba(148,163,184,0.3)", textStyle: { color: "#e2e8f0", fontSize: 12 },
        },
        series: [{
          type: "graph",
          layout: "none",
          roam: true,
          scaleLimit: { min: 0.25, max: 8 },
          categories: [
            { name: "Shepherd team", itemStyle: { color: C_TEAM } },
            { name: "Known", itemStyle: { color: C_KNOWN } },
            { name: "Not yet known", itemStyle: { color: C_UNKNOWN } },
          ],
          data: data.nodes.map((nd) => {
            const cat = category(nd);
            const p = pos.get(nd.id)!;
            return {
              id: nd.id,
              name: nd.id,
              displayName: nd.name,
              category: cat,
              x: p.x,
              y: p.y,
              symbolSize: cat === 0 ? Math.min(26, 10 + nd.degree * 2) : cat === 1 ? Math.min(18, 7 + nd.degree * 1.5) : 3.5,
              itemStyle: cat === 2
                ? { color: C_UNKNOWN, opacity: 0.75 }
                : { color: cat === 0 ? C_TEAM : C_KNOWN, shadowBlur: 14, shadowColor: cat === 0 ? "rgba(76,141,255,0.55)" : "rgba(200,204,212,0.35)" },
              label: cat !== 2 && showLabels
                ? { show: true, position: "right", color: "#8b93a3", fontSize: 10, formatter: nd.name }
                : { show: false },
            };
          }),
          links: data.links.map((l) => ({ source: l.source, target: l.target })),
          lineStyle: { color: C_EDGE, width: 1, curveness: 0.12 },
          emphasis: {
            focus: "adjacency",
            label: { show: true, color: "#e2e8f0", fontSize: 11, formatter: (p: any) => p.data.displayName },
            lineStyle: { width: 2, color: "rgba(76,141,255,0.7)" },
          },
          blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.05 } },
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
    return <div className="py-14 text-center text-sm text-subtle">No one to show yet.</div>;
  }
  return (
    <div className="rounded-lg overflow-hidden border border-border-soft" style={{ background: "#0a0e17" }}>
      <div ref={ref} style={{ width: "100%", height }} />
    </div>
  );
}
