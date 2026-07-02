"use client";

import type { QueryResult } from "@/lib/builder";
import { EChartsBlock } from "../../builder/echarts-block";

const toResult = (data: Array<{ label: string; value: number }>): QueryResult => ({
  columns: ["label", "value"],
  rows: data.map((d) => [d.label, d.value]),
  truncated: false,
});

/** Small dashboard chart backed by the builder's ECharts renderer. */
export function CcChart({
  type,
  data,
  height = 260,
}: {
  type: "pie" | "donut" | "bar";
  data: Array<{ label: string; value: number }>;
  height?: number;
}) {
  if (data.length === 0) return <div className="py-8 text-center text-xs text-subtle">Not enough data yet.</div>;
  return <EChartsBlock config={{ chartType: type }} result={toResult(data)} height={height} />;
}
