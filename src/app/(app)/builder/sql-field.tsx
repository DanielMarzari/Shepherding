"use client";

import { useMemo, useRef, useState } from "react";
import type { DbSchema } from "@/lib/builder";

// ── Static data ──────────────────────────────────────────────────────
const KEYWORDS = [
  "SELECT", "DISTINCT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "AND", "OR", "NOT", "AS", "CASE", "WHEN", "THEN",
  "ELSE", "END", "UNION ALL", "UNION", "ASC", "DESC", "IS NULL", "IS NOT NULL", "WITH",
];
const FUNCTIONS: Array<{ name: string; tpl: string; hint?: string }> = [
  { name: "count", tpl: "count()", hint: "rows" }, { name: "sum", tpl: "sum()", hint: "total" },
  { name: "avg", tpl: "avg()", hint: "average" }, { name: "min", tpl: "min()" }, { name: "max", tpl: "max()" },
  { name: "coalesce", tpl: "coalesce()", hint: "first non-null" }, { name: "round", tpl: "round()" },
  { name: "date", tpl: "date()", hint: "'now','-7 days'" }, { name: "datetime", tpl: "datetime()" },
  { name: "strftime", tpl: "strftime()", hint: "format date" }, { name: "substr", tpl: "substr()" },
  { name: "cast", tpl: "cast( as )" }, { name: "like", tpl: "like ", hint: "pattern" },
  { name: "in", tpl: "in ()" }, { name: "between", tpl: "between " }, { name: "exists", tpl: "exists ()" },
];
// Reusable expressions — date windows, org scoping, common filters. "col" is
// dropped as the selected placeholder so you type the column immediately.
const SNIPPETS: Array<{ label: string; sql: string }> = [
  { label: "Within last 7 days", sql: "date(col) >= date('now','-7 days')" },
  { label: "Within last 30 days", sql: "date(col) >= date('now','-30 days')" },
  { label: "Within last month", sql: "date(col) >= date('now','-1 month')" },
  { label: "Within last 3 months", sql: "date(col) >= date('now','-3 months')" },
  { label: "Within last year", sql: "date(col) >= date('now','-1 year')" },
  { label: "This org", sql: "org_id = :orgId" },
  { label: "Adults only", sql: "is_minor = 0" },
  { label: "Exclude inactive", sql: "lower(coalesce(status,'')) != 'inactive' AND inactivated_at IS NULL" },
  { label: "Not archived", sql: "archived_at IS NULL" },
  { label: "Engaged (shepherded / active / present)", sql: "classification IN ('shepherded','active','present')" },
];

// ── Syntax highlighting ──────────────────────────────────────────────
const HL_KW = new Set([
  "select", "distinct", "from", "where", "group", "by", "order", "having", "limit", "offset",
  "as", "on", "and", "or", "not", "is", "null", "join", "left", "right", "inner", "outer",
  "union", "all", "case", "when", "then", "else", "end", "asc", "desc", "with",
]);
const HL_FN = new Set([
  "count", "sum", "avg", "min", "max", "coalesce", "round", "date", "datetime", "strftime",
  "substr", "cast", "nullif", "ifnull", "lower", "upper", "abs", "length", "julianday", "total", "group_concat",
]);
const HL_OP = new Set(["like", "in", "between", "exists", "glob"]);
const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tokenize SQL into colored spans (schema-aware). HTML-escaped. */
function highlightSql(src: string, tbl: Set<string>, col: Set<string>): string {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") { let j = i; while (j < n && src[j] !== "\n") j++; out += `<span class="sql-cmt">${esc(src.slice(i, j))}</span>`; i = j; continue; }
    if (c === "'") { let j = i + 1; while (j < n && !(src[j] === "'" && src[j - 1] !== "\\")) j++; j = Math.min(n, j + 1); out += `<span class="sql-str">${esc(src.slice(i, j))}</span>`; i = j; continue; }
    if (c === ":" && isWord(src[i + 1] ?? "")) { let j = i + 1; while (j < n && isWord(src[j])) j++; out += `<span class="sql-param">${esc(src.slice(i, j))}</span>`; i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9.]/.test(src[j])) j++; out += `<span class="sql-num">${esc(src.slice(i, j))}</span>`; i = j; continue; }
    if (isWord(c)) {
      let j = i; while (j < n && isWord(src[j])) j++;
      const w = src.slice(i, j), lw = w.toLowerCase();
      let p = i - 1; while (p >= 0 && (src[p] === " " || src[p] === "\t")) p--;
      const afterDot = src[p] === ".";
      let nx = j; while (nx < n && src[nx] === " ") nx++;
      const callish = src[nx] === "(";
      let cls = "";
      if (tbl.has(lw)) cls = "sql-tbl";
      else if (HL_FN.has(lw) && callish) cls = "sql-fn";
      else if (HL_OP.has(lw)) cls = "sql-fn";
      else if (HL_KW.has(lw)) cls = "sql-kw";
      else if (afterDot || col.has(lw)) cls = "sql-col";
      out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w);
      i = j; continue;
    }
    out += esc(c); i++;
  }
  return out;
}

/** Pixel position of the caret inside a textarea, via a mirror element. */
function caretCoords(ta: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const div = document.createElement("div");
  const s = getComputedStyle(ta);
  const copy = [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textTransform", "tabSize",
  ] as const;
  for (const p of copy) div.style[p as never] = s[p as never];
  div.style.position = "absolute"; div.style.visibility = "hidden";
  div.style.whiteSpace = "pre"; div.style.overflow = "hidden";
  div.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ta.value.slice(pos) || ".";
  div.appendChild(marker);
  document.body.appendChild(div);
  const top = marker.offsetTop - ta.scrollTop;
  const left = marker.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}

type Tab = "keywords" | "tables" | "fields" | "functions" | "snippets";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "keywords", label: "Keywords" }, { id: "tables", label: "Tables" },
  { id: "fields", label: "Fields" }, { id: "functions", label: "Functions" }, { id: "snippets", label: "Snippets" },
];
interface Item { label: string; ins: string; meta?: string; back?: number; snippet?: boolean; }
interface Sugg { label: string; insert: string }

export function SqlField({
  value, onChange, onBlur, schema, rows = 8,
}: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; schema: DbSchema; rows?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutRef = useRef<HTMLDivElement>(null);
  const [suggs, setSuggs] = useState<Sugg[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [tab, setTab] = useState<Tab>("keywords");
  const [filter, setFilter] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

  const allColumns = useMemo(() => Array.from(new Set(Object.values(schema.columns).flat())), [schema.columns]);
  const tblSet = useMemo(() => new Set(schema.tables.map((t) => t.toLowerCase())), [schema.tables]);
  const colSet = useMemo(() => new Set(allColumns.map((c) => c.toLowerCase())), [allColumns]);
  const lineCount = value.split("\n").length;

  function syncScroll() {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
    if (gutRef.current) gutRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  /** table→table and alias→table from FROM/JOIN clauses. */
  function aliasMap(text: string): Record<string, string> {
    const m: Record<string, string> = {};
    const re = /\b(?:from|join)\s+([a-z_]\w*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi;
    let x: RegExpExecArray | null;
    while ((x = re.exec(text))) {
      const t = x[1].toLowerCase();
      if (tblSet.has(t)) { m[t] = t; if (x[2] && !HL_KW.has(x[2].toLowerCase())) m[x[2].toLowerCase()] = t; }
    }
    return m;
  }

  /** Completion context: @tables, #fields, alias.fields, from/join tables, or a bare word. */
  function detect(text: string, caret: number): { items: Sugg[]; start: number } | null {
    const pre = text.slice(0, caret);
    const tables = (q: string): Sugg[] => schema.tables.filter((t) => t.toLowerCase().includes(q)).slice(0, 8).map((t) => ({ label: t, insert: t }));
    let m: RegExpExecArray | null;
    if ((m = /@(\w*)$/.exec(pre))) { const it = tables(m[1].toLowerCase()); return it.length ? { items: it, start: caret - m[0].length } : null; }
    if ((m = /#(\w*)$/.exec(pre))) {
      const q = m[1].toLowerCase();
      const refs = Object.values(aliasMap(text));
      const pool = refs.length ? Array.from(new Set(refs.flatMap((t) => schema.columns[t] ?? []))) : allColumns;
      const it = pool.filter((c) => c.toLowerCase().includes(q)).slice(0, 8).map((c) => ({ label: c, insert: c }));
      return it.length ? { items: it, start: caret - m[0].length } : null;
    }
    if ((m = /([a-zA-Z_]\w*)\.(\w*)$/.exec(pre))) {
      const base = aliasMap(text)[m[1].toLowerCase()];
      if (base) { const q = m[2].toLowerCase(); const it = (schema.columns[base] ?? []).filter((c) => c.toLowerCase().includes(q)).slice(0, 8).map((c) => ({ label: c, insert: c })); return it.length ? { items: it, start: caret - m[2].length } : null; }
    }
    if ((m = /\b(?:from|join)\s+(\w*)$/i.exec(pre))) { const it = tables(m[1].toLowerCase()); return it.length ? { items: it, start: caret - m[1].length } : null; }
    // bare word → tables + columns + keywords
    let s = caret; while (s > 0 && isWord(text[s - 1])) s--;
    const word = text.slice(s, caret);
    if (word.length < 1) return null;
    const w = word.toLowerCase();
    const merged: Sugg[] = [
      ...schema.tables.filter((t) => t.toLowerCase().includes(w)).map((t) => ({ label: t, insert: t })),
      ...allColumns.filter((c) => c.toLowerCase().includes(w)).map((c) => ({ label: c, insert: c })),
      ...KEYWORDS.filter((k) => k.toLowerCase().startsWith(w)).map((k) => ({ label: k, insert: k + " " })),
    ].sort((a, b) => Number(b.label.toLowerCase().startsWith(w)) - Number(a.label.toLowerCase().startsWith(w)) || a.label.length - b.label.length).slice(0, 8);
    return merged.length ? { items: merged, start: s } : null;
  }

  function refresh(text: string, caret: number) {
    const r = detect(text, caret);
    if (!r) { setOpen(false); return; }
    setSuggs(r.items); setStart(r.start); setActive(0);
    if (taRef.current) {
      const c = caretCoords(taRef.current, caret);
      const lh = parseFloat(getComputedStyle(taRef.current).lineHeight) || 16;
      const maxLeft = Math.max(0, taRef.current.clientWidth - 228);
      setPos({ top: c.top + lh + 4, left: Math.min(c.left, maxLeft) });
    }
    setOpen(true);
  }

  function acceptSugg(s: Sugg) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const next = value.slice(0, start) + s.insert + value.slice(caret);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => { if (!ta) return; ta.focus(); const p = start + s.insert.length; ta.setSelectionRange(p, p); });
  }

  /** Insert panel text at the caret; snippets select "col", functions land inside "(". */
  function insertText(text: string, opts: { back?: number; snippet?: boolean } = {}) {
    const ta = taRef.current;
    const s = ta?.selectionStart ?? value.length;
    const e = ta?.selectionEnd ?? s;
    onChange(value.slice(0, s) + text + value.slice(e));
    requestAnimationFrame(() => {
      if (!ta) return; ta.focus();
      if (opts.snippet) { const rel = text.indexOf("col"); if (rel >= 0) { ta.setSelectionRange(s + rel, s + rel + 3); return; } }
      const p = s + text.length - (opts.back ?? 0);
      ta.setSelectionRange(p, p);
    });
  }

  const items: Item[] = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list: Item[];
    if (tab === "keywords") list = KEYWORDS.map((k) => ({ label: k, ins: k + " " }));
    else if (tab === "tables") list = schema.tables.map((t) => ({ label: t, ins: t }));
    else if (tab === "fields") list = allColumns.map((c) => ({ label: c, ins: c }));
    else if (tab === "functions") list = FUNCTIONS.map((f) => ({ label: f.name, ins: f.tpl, meta: f.hint, back: f.tpl.indexOf("(") >= 0 ? f.tpl.length - f.tpl.indexOf("(") - 1 : 0 }));
    else list = SNIPPETS.map((s) => ({ label: s.label, ins: s.sql, meta: s.sql, snippet: true }));
    return q ? list.filter((it) => it.label.toLowerCase().includes(q) || (it.meta ?? "").toLowerCase().includes(q)) : list;
  }, [tab, filter, schema.tables, allColumns]);

  const cls = "font-mono text-xs leading-5";

  return (
    <div className="relative">
      <div className="relative border border-border-soft rounded-lg bg-bg overflow-hidden focus-within:ring-2 focus-within:ring-accent">
        <div ref={gutRef} aria-hidden className={`${cls} absolute left-0 top-0 w-8 pt-1.5 pr-1.5 text-right text-subtle select-none pointer-events-none whitespace-pre overflow-hidden`}>
          {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
        </div>
        <pre ref={preRef} aria-hidden className={`${cls} absolute inset-0 pl-9 pr-2.5 py-1.5 whitespace-pre overflow-hidden pointer-events-none text-fg`}
          dangerouslySetInnerHTML={{ __html: value ? highlightSql(value, tblSet, colSet) + "\n" : '<span class="text-subtle">SELECT …  (type @ for tables, # for fields)</span>' }} />
        <textarea
          ref={taRef} value={value} rows={rows} spellCheck={false} wrap="off"
          onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? 0); }}
          onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0); }}
          onClick={(e) => refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggs.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggs.length) % suggs.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptSugg(suggs[active]); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.(); }}
          className={`${cls} relative block w-full pl-9 pr-2.5 py-1.5 bg-transparent resize-y overflow-x-auto whitespace-pre focus:outline-none`}
          style={{ color: "transparent", caretColor: "var(--fg)" }}
        />
      </div>

      {open && (
        <ul role="listbox" style={{ top: pos.top, left: pos.left }} className="absolute z-30 w-[220px] max-h-52 overflow-auto rounded-lg border border-border-soft bg-bg-elev-2 shadow-xl text-xs">
          {suggs.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); acceptSugg(s); }}
                className={`w-full text-left px-2 py-1.5 font-mono truncate cursor-pointer ${i === active ? "bg-accent/15 text-fg" : "text-muted hover:bg-bg/60"}`}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1.5">
        <button type="button" onClick={() => setPanelOpen((o) => !o)} className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer">
          <span className="font-mono">{panelOpen ? "▾" : "▸"}</span> Insert
        </button>
        {panelOpen && (
          <div className="mt-1 rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
            <div className="flex border-b border-border-soft">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => { setTab(t.id); setFilter(""); }}
                  className={`flex-1 text-[11px] py-1.5 cursor-pointer border-b-2 -mb-px transition-colors ${tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…"
              className="w-full bg-bg border-b border-border-soft px-2.5 py-1.5 text-xs font-mono focus:outline-none" />
            <div className="max-h-40 overflow-auto p-1">
              {items.length === 0 ? (
                <div className="px-2 py-3 text-center text-[11px] text-subtle">No matches.</div>
              ) : items.map((it, i) => (
                <button key={`${it.label}-${i}`} type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertText(it.ins, { back: it.back, snippet: it.snippet }); }}
                  className={`w-full text-left px-2 py-1 rounded hover:bg-accent/15 cursor-pointer ${tab === "snippets" ? "" : "font-mono text-xs flex items-baseline gap-2"}`}>
                  {tab === "snippets" ? (
                    <><div className="text-xs font-medium text-fg">{it.label}</div><div className="font-mono text-[10px] text-subtle truncate">{it.meta}</div></>
                  ) : (
                    <><span className="truncate">{it.label}</span>{it.meta && <span className="ml-auto text-[10px] text-subtle shrink-0">{it.meta}</span>}</>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
