// SQL-editor color theme — the role→color mapping + style toggles an admin
// sets in Settings › Appearance. Client-safe (no DB); the DB read/write lives
// in builder-theme-store.ts. Colors map to the --sql-c-* palette in globals.css.

export const SQL_COLORS = ["blue", "pink", "green", "yellow", "orange", "red", "purple", "teal", "slate"] as const;
export type SqlColor = (typeof SQL_COLORS)[number];

/** Which role each token type carries, plus display toggles. */
export interface SqlTheme {
  kw: SqlColor;
  tbl: SqlColor;
  col: SqlColor;
  fn: SqlColor;
  /** Tables / fields render as a filled chip (false = colored text only). */
  tblChip: boolean;
  colChip: boolean;
  /** Keywords ALL-CAPS; functions italic. */
  caps: boolean;
  fnital: boolean;
}

export const DEFAULT_SQL_THEME: SqlTheme = {
  kw: "blue", tbl: "pink", col: "yellow", fn: "green",
  tblChip: true, colChip: true, caps: false, fnital: false,
};

export const SQL_ROLE_LABELS: Array<{ key: "kw" | "tbl" | "col" | "fn"; label: string }> = [
  { key: "kw", label: "Keywords" },
  { key: "tbl", label: "Tables" },
  { key: "col", label: "Fields" },
  { key: "fn", label: "Functions" },
];

/** Coerce arbitrary stored JSON into a valid theme (unknown values → default). */
export function normalizeSqlTheme(raw: unknown): SqlTheme {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = (v: unknown, d: SqlColor): SqlColor =>
    typeof v === "string" && (SQL_COLORS as readonly string[]).includes(v) ? (v as SqlColor) : d;
  const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
  return {
    kw: color(r.kw, DEFAULT_SQL_THEME.kw),
    tbl: color(r.tbl, DEFAULT_SQL_THEME.tbl),
    col: color(r.col, DEFAULT_SQL_THEME.col),
    fn: color(r.fn, DEFAULT_SQL_THEME.fn),
    tblChip: bool(r.tblChip, DEFAULT_SQL_THEME.tblChip),
    colChip: bool(r.colChip, DEFAULT_SQL_THEME.colChip),
    caps: bool(r.caps, DEFAULT_SQL_THEME.caps),
    fnital: bool(r.fnital, DEFAULT_SQL_THEME.fnital),
  };
}

export function isDefaultSqlTheme(t: SqlTheme): boolean {
  return (Object.keys(DEFAULT_SQL_THEME) as (keyof SqlTheme)[]).every((k) => t[k] === DEFAULT_SQL_THEME[k]);
}

/** CSS the (app) layout injects to override the --sql-* role vars for this org.
 *  Every value derives from the fixed color enum + booleans, so it's safe to
 *  inline. */
export function sqlThemeStyle(t: SqlTheme): string {
  const chip = (on: boolean, name: SqlColor) => (on ? `var(--sql-c-${name}-bg)` : "transparent");
  const root =
    `:root{` +
    `--sql-kw:var(--sql-c-${t.kw});` +
    `--sql-tbl:var(--sql-c-${t.tbl});--sql-tbl-bg:${chip(t.tblChip, t.tbl)};` +
    `--sql-col:var(--sql-c-${t.col});--sql-col-bg:${chip(t.colChip, t.col)};` +
    `--sql-fn:var(--sql-c-${t.fn});` +
    `}`;
  const caps = t.caps ? ".sql-kw{text-transform:uppercase}" : "";
  const ital = t.fnital ? ".sql-fn{font-style:italic}" : "";
  return root + caps + ital;
}
