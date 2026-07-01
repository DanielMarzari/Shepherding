"use client";

import { useEffect, useRef } from "react";
import type { BlockConfig, QueryResult } from "@/lib/builder";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PALETTE = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#0891b2", "#ca8a04", "#db2777", "#dc2626", "#65a30d", "#7c3aed"];
const AXIS = "rgba(148,163,184,0.25)";
const SPLIT = "rgba(148,163,184,0.10)";
const TEXT = "#94a3b8";

/** Chart types offered in the editor, grouped, with the query shape each expects. */
export const CHART_TYPES: Array<{ group: string; items: Array<{ id: string; label: string; hint: string }> }> = [
  {
    group: "Trend",
    items: [
      { id: "line", label: "Line", hint: "col1 = x (category), col2+ = series values" },
      { id: "area", label: "Area", hint: "col1 = x, col2+ = series values" },
      { id: "step", label: "Step line", hint: "col1 = x, col2+ = values" },
      { id: "freq-polygon", label: "Freq. polygon", hint: "col1 = bin, col2 = frequency" },
      { id: "ogive", label: "Ogive (cumulative)", hint: "col1 = bin, col2 = frequency" },
      { id: "streamgraph", label: "Streamgraph", hint: "col1 = time, col2 = series name, col3 = value" },
      { id: "timeline", label: "Timeline", hint: "col1 = date, col2+ = values" },
    ],
  },
  {
    group: "Comparison",
    items: [
      { id: "bar", label: "Bar", hint: "col1 = category, col2+ = series values" },
      { id: "stacked-bar", label: "Stacked bar", hint: "col1 = category, col2+ = stacked series" },
      { id: "combo", label: "Combo (bar+line)", hint: "col1 = category, col2 = bar, col3+ = lines" },
      { id: "radar", label: "Radar / spider", hint: "col1 = axis, col2+ = series" },
      { id: "population-pyramid", label: "Population pyramid", hint: "col1 = group, col2 = left, col3 = right" },
    ],
  },
  {
    group: "Part-to-whole",
    items: [
      { id: "pie", label: "Pie", hint: "col1 = name, col2 = value" },
      { id: "donut", label: "Donut", hint: "col1 = name, col2 = value" },
      { id: "nested-pie", label: "Nested pie", hint: "col1 = name, col2 = inner, col3 = outer" },
      { id: "funnel", label: "Funnel", hint: "col1 = name, col2 = value" },
      { id: "treemap", label: "Treemap / proportional area", hint: "level cols… + last col = value" },
      { id: "sunburst", label: "Sunburst", hint: "level cols… + last col = value" },
      { id: "gauge", label: "Progress / gauge", hint: "col2 of row 1 = value (0–100)" },
      { id: "pictogram", label: "Pictogram", hint: "col1 = category, col2 = value" },
    ],
  },
  {
    group: "Distribution",
    items: [
      { id: "histogram", label: "Histogram", hint: "col1 = a numeric column (auto-binned)" },
      { id: "boxplot", label: "Box & whisker", hint: "col1 = group, col2 = numeric values" },
      { id: "scatter", label: "Scatter", hint: "col1 = x, col2 = y" },
      { id: "bubble", label: "Bubble", hint: "col1 = x, col2 = y, col3 = size" },
    ],
  },
  {
    group: "Correlation & matrix",
    items: [
      { id: "heatmap", label: "Heatmap", hint: "col1 = x, col2 = y, col3 = value" },
      { id: "correlation", label: "Correlation matrix", hint: "col1 = x, col2 = y, col3 = value" },
    ],
  },
  {
    group: "Hierarchy & flow",
    items: [
      { id: "tree", label: "Tree", hint: "level cols… (last col optional value)" },
      { id: "sankey", label: "Sankey / alluvial", hint: "col1 = source, col2 = target, col3 = value" },
      { id: "chord", label: "Chord", hint: "col1 = source, col2 = target, col3 = value" },
      { id: "network", label: "Network graph", hint: "col1 = source, col2 = target, col3 = value" },
    ],
  },
];
export const CHART_LABEL: Record<string, string> = Object.fromEntries(
  CHART_TYPES.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

/** SVG path glyphs used as the repeating unit for pictogram charts. */
export const ICONS: Record<string, string> = {
  person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  car: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  dollar: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z",
  cross: "M14 6V2h-4v4H6v4h4v12h4V10h4V6z",
  book: "M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1z",
};
export const PICTO_ICONS: Array<{ id: string; label: string }> = [
  { id: "person", label: "Person" },
  { id: "people", label: "People" },
  { id: "home", label: "Home" },
  { id: "car", label: "Car" },
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "dollar", label: "Dollar" },
  { id: "cross", label: "Cross" },
  { id: "book", label: "Book" },
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function axisStyle(kind: "category" | "value", data?: string[]) {
  return {
    type: kind,
    ...(data ? { data } : {}),
    axisLine: { lineStyle: { color: AXIS } },
    axisLabel: { color: TEXT, hideOverlap: true },
    splitLine: { lineStyle: { color: SPLIT } },
  };
}
function base(extra: any) {
  return {
    backgroundColor: "transparent",
    color: PALETTE,
    textStyle: { color: TEXT },
    tooltip: { trigger: "item", backgroundColor: "#0b1220", borderColor: "rgba(148,163,184,0.3)", textStyle: { color: "#e2e8f0" } },
    legend: { type: "scroll", top: 0, textStyle: { color: TEXT } },
    ...extra,
  };
}

function quartiles(vals: number[]): [number, number, number, number, number] {
  const s = [...vals].sort((a, b) => a - b);
  const q = (p: number) => {
    if (s.length === 0) return 0;
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return [s[0] ?? 0, q(0.25), q(0.5), q(0.75), s[s.length - 1] ?? 0];
}
function buildTree(rows: unknown[][], levels: number, valueIdx: number): any[] {
  const root: any = { name: "root", children: [] };
  for (const r of rows) {
    let node = root;
    for (let l = 0; l < levels; l++) {
      const name = String(r[l] ?? "");
      let child = node.children.find((c: any) => c.name === name);
      if (!child) { child = { name, children: [] }; node.children.push(child); }
      node = child;
    }
    node.value = (node.value ?? 0) + num(r[valueIdx]);
  }
  const strip = (n: any): any => (n.children.length ? { name: n.name, children: n.children.map(strip) } : { name: n.name, value: n.value ?? 0 });
  return root.children.map(strip);
}

function buildOption(type: string, result: QueryResult, opts: { icon?: string } = {}): any {
  const cols = result.columns;
  const rows = result.rows;
  if (rows.length === 0) return base({ title: { text: "No rows", left: "center", top: "middle", textStyle: { color: TEXT, fontSize: 12 } } });
  const cats = rows.map((r) => String(r[0] ?? ""));
  const seriesNames = cols.slice(1);
  const seriesData = (j: number) => rows.map((r) => num(r[j + 1]));

  const catValue = (opts: { area?: boolean; stack?: boolean; step?: boolean; smooth?: boolean; lineType?: boolean }) =>
    base({
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: TEXT }, type: "scroll" },
      grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
      xAxis: axisStyle("category", cats),
      yAxis: axisStyle("value"),
      series: seriesNames.map((name, j) => ({
        name, type: opts.lineType ? "line" : "bar",
        data: seriesData(j),
        ...(opts.stack ? { stack: "total" } : {}),
        ...(opts.area ? { areaStyle: { opacity: 0.25 } } : {}),
        ...(opts.step ? { step: "middle" } : {}),
        ...(opts.smooth ? { smooth: true } : {}),
      })),
    });

  const nameValue = (r: unknown[]) => ({ name: String(r[0] ?? ""), value: num(r[1]) });

  switch (type) {
    case "bar": return catValue({});
    case "stacked-bar": return catValue({ stack: true });
    case "line": return catValue({ lineType: true, smooth: true });
    case "timeline": return catValue({ lineType: true, smooth: true });
    case "step": return catValue({ lineType: true, step: true });
    case "freq-polygon": return catValue({ lineType: true, smooth: false });
    case "area": return catValue({ lineType: true, area: true, smooth: true });
    case "ogive": {
      let acc = 0; const data = rows.map((r) => (acc += num(r[1])));
      return base({ tooltip: { trigger: "axis" }, grid: { left: 8, right: 14, top: 20, bottom: 6, containLabel: true }, xAxis: axisStyle("category", cats), yAxis: axisStyle("value"), series: [{ type: "line", smooth: true, areaStyle: { opacity: 0.15 }, data }] });
    }
    case "combo": return base({
      tooltip: { trigger: "axis" }, legend: { top: 0, textStyle: { color: TEXT } }, grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
      xAxis: axisStyle("category", cats), yAxis: axisStyle("value"),
      series: seriesNames.map((name, j) => ({ name, type: j === 0 ? "bar" : "line", smooth: true, data: seriesData(j) })),
    });
    case "pie":
    case "donut": return base({
      series: [{ type: "pie", radius: type === "donut" ? ["45%", "70%"] : "68%", data: rows.map(nameValue), label: { color: TEXT }, itemStyle: { borderColor: "#0b1220", borderWidth: 1 } }],
    });
    case "nested-pie": return base({
      series: [
        { type: "pie", radius: [0, "38%"], label: { position: "inner", color: "#fff", fontSize: 10 }, data: rows.map(nameValue) },
        { type: "pie", radius: ["50%", "70%"], data: rows.map((r) => ({ name: String(r[0] ?? ""), value: num(r[2] ?? r[1]) })), label: { color: TEXT } },
      ],
    });
    case "funnel": return base({ series: [{ type: "funnel", data: rows.map(nameValue), label: { color: TEXT } }] });
    case "gauge": {
      const v = num(rows[0]?.[1]);
      return base({ tooltip: { show: false }, series: [{ type: "gauge", progress: { show: true, width: 12 }, axisLine: { lineStyle: { width: 12 } }, pointer: { show: false }, detail: { valueAnimation: true, color: "#e2e8f0", fontSize: 22 }, data: [{ value: v }] }] });
    }
    case "pictogram": {
      const sym = ICONS[opts.icon ?? ""] ? `path://${ICONS[opts.icon as string]}` : "circle";
      return base({
        tooltip: { trigger: "axis" }, grid: { left: 8, right: 14, top: 16, bottom: 6, containLabel: true }, xAxis: axisStyle("category", cats), yAxis: axisStyle("value"),
        series: [{ type: "pictorialBar", symbol: sym, symbolRepeat: true, symbolSize: [16, 16], symbolClip: true, itemStyle: { color: PALETTE[0] }, data: seriesData(0) }],
      });
    }
    case "radar": {
      const indicators = cats.map((c, i) => ({ name: c, max: Math.max(1, ...seriesNames.map((_, j) => num(rows[i][j + 1]))) }));
      return base({
        radar: { indicator: indicators, axisName: { color: TEXT }, splitLine: { lineStyle: { color: SPLIT } }, axisLine: { lineStyle: { color: AXIS } } },
        series: [{ type: "radar", data: seriesNames.map((name, j) => ({ name, value: rows.map((r) => num(r[j + 1])) })) }],
      });
    }
    case "population-pyramid": return base({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } }, legend: { top: 0, textStyle: { color: TEXT } }, grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
      xAxis: { ...axisStyle("value"), axisLabel: { color: TEXT, formatter: (v: number) => Math.abs(v).toLocaleString() } },
      yAxis: axisStyle("category", cats),
      series: [
        { name: cols[1] ?? "Left", type: "bar", stack: "p", data: rows.map((r) => -num(r[1])) },
        { name: cols[2] ?? "Right", type: "bar", stack: "p", data: rows.map((r) => num(r[2])) },
      ],
    });
    case "scatter":
    case "bubble": return base({
      grid: { left: 8, right: 14, top: 16, bottom: 6, containLabel: true }, xAxis: axisStyle("value"), yAxis: axisStyle("value"),
      series: [{ type: "scatter", symbolSize: type === "bubble" ? (d: number[]) => Math.max(6, Math.sqrt(num(d[2])) * 3) : 8, data: rows.map((r) => [num(r[0]), num(r[1]), num(r[2])]) }],
    });
    case "histogram": {
      const vals = rows.map((r) => num(r[0]));
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
      const w = (hi - lo) / bins || 1;
      const counts = new Array(bins).fill(0);
      for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
      const labels = counts.map((_, i) => `${(lo + i * w).toFixed(1)}`);
      return base({ tooltip: { trigger: "axis" }, grid: { left: 8, right: 14, top: 16, bottom: 6, containLabel: true }, xAxis: axisStyle("category", labels), yAxis: axisStyle("value"), series: [{ type: "bar", barCategoryGap: "2%", data: counts }] });
    }
    case "boxplot": {
      const groups = new Map<string, number[]>();
      for (const r of rows) { const k = String(r[0] ?? ""); (groups.get(k) ?? groups.set(k, []).get(k)!).push(num(r[1])); }
      const names = [...groups.keys()];
      return base({ tooltip: { trigger: "item" }, grid: { left: 8, right: 14, top: 16, bottom: 6, containLabel: true }, xAxis: axisStyle("category", names), yAxis: axisStyle("value"), series: [{ type: "boxplot", data: names.map((n) => quartiles(groups.get(n)!)) }] });
    }
    case "heatmap":
    case "correlation": {
      const xs = [...new Set(rows.map((r) => String(r[0] ?? "")))];
      const ys = [...new Set(rows.map((r) => String(r[1] ?? "")))];
      const data = rows.map((r) => [xs.indexOf(String(r[0] ?? "")), ys.indexOf(String(r[1] ?? "")), num(r[2])]);
      const max = Math.max(1, ...data.map((d) => d[2]));
      return base({
        tooltip: { position: "top" }, grid: { left: 8, right: 14, top: 16, bottom: 40, containLabel: true },
        xAxis: axisStyle("category", xs), yAxis: axisStyle("category", ys),
        visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: TEXT }, inRange: { color: ["#0b1220", "#2563eb", "#f97316"] } },
        series: [{ type: "heatmap", data, label: { show: false } }],
      });
    }
    case "treemap": return base({ series: [{ type: "treemap", roam: false, data: buildTree(rows, cols.length - 1, cols.length - 1), label: { color: "#fff" }, breadcrumb: { show: false } }] });
    case "sunburst": return base({ series: [{ type: "sunburst", data: buildTree(rows, cols.length - 1, cols.length - 1), radius: [0, "90%"], label: { color: "#fff", minAngle: 8 } }] });
    case "tree": return base({ tooltip: { trigger: "item" }, series: [{ type: "tree", data: [{ name: cols[0] ?? "root", children: buildTree(rows, cols.length - 1, cols.length - 1) }], top: 8, bottom: 8, left: 40, right: 80, symbolSize: 7, label: { color: TEXT, position: "left", align: "right" }, leaves: { label: { position: "right", align: "left" } }, lineStyle: { color: AXIS } }] });
    case "sankey":
    case "chord":
    case "network": {
      const nodeSet = new Set<string>();
      for (const r of rows) { nodeSet.add(String(r[0] ?? "")); nodeSet.add(String(r[1] ?? "")); }
      const nodes = [...nodeSet].map((name) => ({ name }));
      const links = rows.map((r) => ({ source: String(r[0] ?? ""), target: String(r[1] ?? ""), value: num(r[2]) || 1 }));
      if (type === "sankey") return base({ tooltip: { trigger: "item" }, series: [{ type: "sankey", data: nodes, links, label: { color: TEXT }, lineStyle: { color: "gradient", opacity: 0.4 } }] });
      return base({
        tooltip: { trigger: "item" },
        series: [{ type: "graph", layout: type === "chord" ? "circular" : "force", circular: { rotateLabel: true }, roam: true, data: nodes.map((n) => ({ ...n, symbolSize: 14 })), links: links.map((l) => ({ ...l, lineStyle: { width: Math.max(1, Math.log2(l.value + 1)) } })), force: { repulsion: 120, edgeLength: 80 }, label: { show: true, color: TEXT }, lineStyle: { color: "source", opacity: 0.5, curveness: type === "chord" ? 0.3 : 0.1 } }],
      });
    }
    case "streamgraph": {
      const times = [...new Set(rows.map((r) => String(r[0] ?? "")))];
      const data = rows.map((r) => [String(r[0] ?? ""), num(r[2]), String(r[1] ?? "")]);
      return base({ tooltip: { trigger: "item" }, singleAxis: { type: "category", data: times, axisLabel: { color: TEXT }, axisLine: { lineStyle: { color: AXIS } }, top: 20, bottom: 20 }, series: [{ type: "themeRiver", data, label: { color: TEXT } }] });
    }
    default: return catValue({});
  }
}

export function EChartsBlock({ config, result, height = 280 }: { config: BlockConfig; result: QueryResult | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const modRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!result || result.error || !ref.current) return;
      if (!modRef.current) modRef.current = await import("echarts");
      if (cancelled || !ref.current) return;
      if (!chartRef.current) chartRef.current = modRef.current.init(ref.current, null, { renderer: "canvas" });
      try { chartRef.current.setOption(buildOption(config.chartType || "bar", result, { icon: config.icon }), true); } catch { /* bad shape */ }
    })();
    return () => { cancelled = true; };
  }, [config.chartType, config.icon, result]);

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    if (el) ro.observe(el);
    return () => { ro.disconnect(); chartRef.current?.dispose?.(); chartRef.current = null; };
  }, []);

  if (!result) return <div className="py-6 text-center text-xs text-subtle">No data yet.</div>;
  if (result.error)
    return <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-3 py-2 text-xs text-warn-soft-fg">{result.error}</div>;
  return <div ref={ref} style={{ width: "100%", height }} />;
}
