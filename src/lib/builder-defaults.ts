// Client-safe block defaults + leaf-kind list. Kept out of lib/builder.ts
// (server-only) so the editor and the group child editor can add blocks on the
// client. lib/builder.ts re-imports DEFAULT_CONFIG for server-side inserts.
import type { BlockConfig, BlockKind } from "./builder";

/** Block kinds that can be nested inside a group container. */
export const LEAF_KINDS: BlockKind[] = ["stat", "kpi", "progress", "chart", "table", "leaderboard", "map", "text", "embed"];

/** Preset semantic text colors — a fixed palette (no arbitrary colors) so pages
 *  stay on-theme. Used for whole-element coloring and per-table-column coloring. */
export type ColorPreset = "normal" | "low" | "success" | "warning" | "error" | "highlight";
export const COLOR_PRESETS: Array<{ id: ColorPreset; label: string; className: string }> = [
  { id: "normal", label: "Normal", className: "" },
  { id: "low", label: "Low (grey)", className: "text-muted" },
  { id: "success", label: "Success", className: "text-good-soft-fg" },
  { id: "warning", label: "Warning", className: "text-warn-soft-fg" },
  { id: "error", label: "Error", className: "text-bad-soft-fg" },
  { id: "highlight", label: "Highlight", className: "text-accent" },
];
/** Tailwind text-color class for a preset id (empty = default text color). */
export const colorClass = (c: string | undefined): string =>
  COLOR_PRESETS.find((p) => p.id === c)?.className ?? "";

export const DEFAULT_CONFIG: Record<BlockKind, BlockConfig> = {
  stat: {
    title: "New stat",
    sql: "SELECT COUNT(*) FROM pco_people",
    sub: "the value is the first column of the first row",
    span: 2,
  },
  kpi: {
    title: "New KPI",
    sql: "SELECT classification AS period, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value",
    sub: "big number = latest point · delta = vs previous",
    span: 4,
  },
  progress: {
    title: "Goal progress",
    sql: "SELECT COUNT(*) FROM person_activity WHERE classification IN ('shepherded','active')",
    goal: 500,
    sub: "engaged people toward the goal",
    span: 4,
  },
  chart: {
    title: "New chart",
    sql: "SELECT classification AS label, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value DESC",
    chartType: "bar",
    span: 6,
  },
  table: {
    title: "New table",
    sql: "SELECT classification, COUNT(*) AS people\nFROM person_activity\nGROUP BY classification\nORDER BY people DESC",
    span: 6,
  },
  leaderboard: {
    title: "Leaderboard",
    sql: "SELECT classification AS label, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value DESC",
    limit: 10,
    span: 6,
  },
  map: {
    title: "Map",
    sql: "SELECT lat, lng FROM geocode_cache\nWHERE ok = 1 AND lat IS NOT NULL\nLIMIT 500",
    sub: "col1 = lat, col2 = lng, col3 = label (optional)",
    span: 6,
  },
  linkcard: {
    title: "People",
    sql: "SELECT 'Pick a data source, or return name + pcoId columns' AS name, NULL AS pcoId",
    sub: "one card per row · links out to PCO",
    span: 12,
  },
  text: {
    title: "",
    text: "Write **markdown** here — `#` headings, **bold**, _italic_, [links](https://example.com), and `-` lists.",
    span: 12,
  },
  divider: {
    title: "Section",
    sub: "",
    span: 12,
  },
  embed: {
    mode: "image",
    url: "",
    alt: "",
    title: "",
    span: 6,
  },
  filter: {
    title: "Filter",
    param: "status",
    filterType: "dropdown",
    sql: "SELECT DISTINCT classification FROM person_activity ORDER BY classification",
    defaultValue: "",
    targets: [],
    span: 4,
  },
  pagelist: {
    title: "Pages",
    pages: [],
    layout: "grid",
    span: 12,
  },
  group: {
    title: "Group",
    layout: "list",
    children: [],
    span: 6,
  },
};
