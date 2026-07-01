// Client-safe block defaults + leaf-kind list. Kept out of lib/builder.ts
// (server-only) so the editor and the group child editor can add blocks on the
// client. lib/builder.ts re-imports DEFAULT_CONFIG for server-side inserts.
import type { BlockConfig, BlockKind } from "./builder";

/** Block kinds that can be nested inside a group container. */
export const LEAF_KINDS: BlockKind[] = ["stat", "kpi", "progress", "chart", "table", "leaderboard", "map", "text", "embed"];

export const DEFAULT_CONFIG: Record<BlockKind, BlockConfig> = {
  stat: {
    title: "New stat",
    sql: "SELECT COUNT(*) FROM pco_people",
    sub: "the value is the first column of the first row",
    span: 1,
  },
  kpi: {
    title: "New KPI",
    sql: "SELECT classification AS period, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value",
    sub: "big number = latest point · delta = vs previous",
    span: 2,
  },
  progress: {
    title: "Goal progress",
    sql: "SELECT COUNT(*) FROM person_activity WHERE classification IN ('shepherded','active')",
    goal: 500,
    sub: "engaged people toward the goal",
    span: 2,
  },
  chart: {
    title: "New chart",
    sql: "SELECT classification AS label, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value DESC",
    chartType: "bar",
    span: 3,
  },
  table: {
    title: "New table",
    sql: "SELECT classification, COUNT(*) AS people\nFROM person_activity\nGROUP BY classification\nORDER BY people DESC",
    span: 3,
  },
  leaderboard: {
    title: "Leaderboard",
    sql: "SELECT classification AS label, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value DESC",
    limit: 10,
    span: 3,
  },
  map: {
    title: "Map",
    sql: "SELECT lat, lng FROM geocode_cache\nWHERE ok = 1 AND lat IS NOT NULL\nLIMIT 500",
    sub: "col1 = lat, col2 = lng, col3 = label (optional)",
    span: 3,
  },
  text: {
    title: "",
    text: "Write **markdown** here — `#` headings, **bold**, _italic_, [links](https://example.com), and `-` lists.",
    span: 6,
  },
  divider: {
    title: "Section",
    sub: "",
    span: 6,
  },
  embed: {
    mode: "image",
    url: "",
    alt: "",
    title: "",
    span: 3,
  },
  filter: {
    title: "Filter",
    param: "status",
    filterType: "dropdown",
    sql: "SELECT DISTINCT classification FROM person_activity ORDER BY classification",
    defaultValue: "",
    targets: [],
    span: 2,
  },
  pagelist: {
    title: "Pages",
    pages: [],
    layout: "grid",
    span: 6,
  },
  group: {
    title: "Group",
    layout: "list",
    children: [],
    span: 3,
  },
};
