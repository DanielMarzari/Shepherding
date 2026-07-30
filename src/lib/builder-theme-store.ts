import "server-only";
import { getDb } from "./db";
import { DEFAULT_SQL_THEME, normalizeSqlTheme, type SqlTheme } from "./builder-theme";

/** The org's saved SQL-editor theme, or null if it has never been customized
 *  (in which case the built-in default in globals.css applies). */
export function getSqlThemeRow(orgId: number): SqlTheme | null {
  const row = getDb()
    .prepare(`SELECT theme_json FROM builder_theme WHERE org_id = ?`)
    .get(orgId) as { theme_json: string } | undefined;
  if (!row) return null;
  try {
    return normalizeSqlTheme(JSON.parse(row.theme_json));
  } catch {
    return null;
  }
}

/** The theme to edit in Settings — the saved one, or the default. */
export function getSqlTheme(orgId: number): SqlTheme {
  return getSqlThemeRow(orgId) ?? DEFAULT_SQL_THEME;
}

export function saveSqlTheme(orgId: number, theme: SqlTheme): void {
  getDb()
    .prepare(
      `INSERT INTO builder_theme (org_id, theme_json, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id) DO UPDATE SET
         theme_json = excluded.theme_json,
         updated_at = excluded.updated_at`,
    )
    .run(orgId, JSON.stringify(normalizeSqlTheme(theme)));
}
