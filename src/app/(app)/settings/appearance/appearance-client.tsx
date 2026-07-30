"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { SQL_COLORS, SQL_ROLE_LABELS, DEFAULT_SQL_THEME, isDefaultSqlTheme, type SqlColor, type SqlTheme } from "@/lib/builder-theme";
import { saveSqlThemeAction } from "./actions";

// A fixed, pre-tokenized sample so the preview needs no tokenizer client-side.
const SAMPLE_HTML =
  '<span class="sql-cmt">-- new to PCO in the last week</span>\n' +
  '<span class="sql-kw">SELECT</span> <span class="sql-col">membership_type</span>\n' +
  '<span class="sql-kw">FROM</span> <span class="sql-tbl">pco_people</span>\n' +
  '<span class="sql-kw">WHERE</span> <span class="sql-fn">date</span>(<span class="sql-col">pco_created_at</span>) &gt;= <span class="sql-fn">date</span>(<span class="sql-str">\'now\'</span>, <span class="sql-str">\'-7 days\'</span>)';

export function AppearanceClient({ initial, isAdmin }: { initial: SqlTheme; isAdmin: boolean }) {
  const [t, setT] = useState<SqlTheme>(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (patch: Partial<SqlTheme>) => { setT((p) => ({ ...p, ...patch })); setSaved(null); };

  const previewVars = {
    ["--sql-kw"]: `var(--sql-c-${t.kw})`,
    ["--sql-tbl"]: `var(--sql-c-${t.tbl})`,
    ["--sql-tbl-bg"]: t.tblChip ? `var(--sql-c-${t.tbl}-bg)` : "transparent",
    ["--sql-col"]: `var(--sql-c-${t.col})`,
    ["--sql-col-bg"]: t.colChip ? `var(--sql-c-${t.col}-bg)` : "transparent",
    ["--sql-fn"]: `var(--sql-c-${t.fn})`,
  } as CSSProperties;

  const save = () => start(async () => {
    const res = await saveSqlThemeAction(t);
    setSaved(res.message);
  });

  return (
    <div className="space-y-5">
      <pre
        className={`sqlprev ${t.caps ? "caps" : ""} ${t.fnital ? "ital" : ""} rounded-xl border border-border-soft bg-bg p-4 text-xs font-mono leading-5 whitespace-pre-wrap overflow-x-auto`}
        style={previewVars}
        dangerouslySetInnerHTML={{ __html: SAMPLE_HTML }}
      />

      <div className="rounded-xl border border-border-soft bg-bg-elev divide-y divide-border-soft">
        {SQL_ROLE_LABELS.map((role) => (
          <div key={role.key} className="flex items-center gap-3 px-4 py-3 flex-wrap">
            <span className="w-20 text-sm font-medium shrink-0">{role.label}</span>
            <div className="flex gap-1.5 flex-wrap">
              {SQL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={`${role.label} ${c}`}
                  disabled={!isAdmin}
                  onClick={() => set({ [role.key]: c } as Partial<SqlTheme>)}
                  className={`w-6 h-6 rounded-md border cursor-pointer transition-transform disabled:cursor-not-allowed ${t[role.key] === c ? "ring-2 ring-accent ring-offset-1 ring-offset-bg-elev border-transparent" : "border-border-soft hover:scale-110"}`}
                  style={{ background: `var(--sql-c-${c as SqlColor})` }}
                />
              ))}
            </div>
            {(role.key === "tbl" || role.key === "col") && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input type="checkbox" disabled={!isAdmin} checked={role.key === "tbl" ? t.tblChip : t.colChip}
                  onChange={(e) => set(role.key === "tbl" ? { tblChip: e.target.checked } : { colChip: e.target.checked })} />
                chip
              </label>
            )}
            {role.key === "kw" && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input type="checkbox" disabled={!isAdmin} checked={t.caps} onChange={(e) => set({ caps: e.target.checked })} />
                ALL CAPS
              </label>
            )}
            {role.key === "fn" && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input type="checkbox" disabled={!isAdmin} checked={t.fnital} onChange={(e) => set({ fnital: e.target.checked })} />
                italic
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={save} disabled={!isAdmin || pending}
          className="px-3.5 py-2 rounded-lg bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50 cursor-pointer">
          {pending ? "Saving…" : "Save colors"}
        </button>
        <button type="button" onClick={() => set(DEFAULT_SQL_THEME)} disabled={!isAdmin || isDefaultSqlTheme(t)}
          className="px-3.5 py-2 rounded-lg border border-border-soft text-sm disabled:opacity-40 cursor-pointer">
          Reset to default
        </button>
        {saved && <span className="text-xs text-[color:var(--good-soft-fg)]">{saved}</span>}
        {!isAdmin && <span className="text-xs text-muted">Only admins can change the editor colors.</span>}
      </div>
    </div>
  );
}
