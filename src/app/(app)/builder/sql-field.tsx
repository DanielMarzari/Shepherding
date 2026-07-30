"use client";

import { useMemo, useRef, useState } from "react";
import type { DbSchema } from "@/lib/builder";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "AS", "AND", "OR", "NOT", "IN",
  "LIKE", "IS NULL", "IS NOT NULL", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE",
  "END", "COALESCE", "CAST", "SUBSTR", "strftime", "DESC", "ASC", "WITH",
  "UNION", "UNION ALL", "BETWEEN", "EXISTS", "COUNT", "SUM", "AVG", "MIN", "MAX", "ROUND",
];

type Kind = "table" | "column" | "keyword";
interface Sugg { text: string; kind: Kind }

// Reusable expressions — date windows, org scoping, common filters. Inserting
// one drops "col" as the selected placeholder so you can type the column.
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

// One-glyph key symbol per suggestion kind (shown in the dropdown).
const SIGIL: Record<Kind, string> = { table: "$", column: "#", keyword: "/" };
const SIGIL_COLOR: Record<Kind, string> = {
  table: "text-[color:var(--good-soft-fg)]",
  column: "text-accent",
  keyword: "text-subtle",
};

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

/** Tokenize SQL into colored spans. Tables/columns come from the live schema;
 *  an identifier right after a `.` is treated as a field. HTML-escaped. */
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
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflow = "hidden";
  div.style.width = `${ta.clientWidth}px`;
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

export function SqlField({
  value,
  onChange,
  onBlur,
  schema,
  rows = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  schema: DbSchema;
  rows?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [suggs, setSuggs] = useState<Sugg[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [snipOpen, setSnipOpen] = useState(false);

  const allColumns = useMemo(() => Array.from(new Set(Object.values(schema.columns).flat())), [schema.columns]);
  const tblSet = useMemo(() => new Set(schema.tables.map((t) => t.toLowerCase())), [schema.tables]);
  const colSet = useMemo(() => new Set(allColumns.map((c) => c.toLowerCase())), [allColumns]);

  function syncScroll() {
    const ta = taRef.current, pre = preRef.current;
    if (ta && pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
  }

  function tokenAt(text: string, caret: number): { word: string; start: number } {
    let s = caret;
    while (s > 0 && /[A-Za-z0-9_]/.test(text[s - 1])) s--;
    return { word: text.slice(s, caret), start: s };
  }

  function refresh(text: string, caret: number) {
    const { word, start } = tokenAt(text, caret);
    if (word.length < 1) { setOpen(false); return; }
    const prev = text.slice(0, start).trimEnd().split(/\s+/).pop()?.toUpperCase() ?? "";
    const afterFrom = prev === "FROM" || prev.endsWith("JOIN");
    const w = word.toLowerCase();
    const tables: Sugg[] = schema.tables.filter((t) => t.toLowerCase().includes(w)).map((t) => ({ text: t, kind: "table" }));
    const columns: Sugg[] = allColumns.filter((c) => c.toLowerCase().includes(w)).map((c) => ({ text: c, kind: "column" }));
    const keywords: Sugg[] = KEYWORDS.filter((k) => k.toLowerCase().startsWith(w)).map((k) => ({ text: k, kind: "keyword" }));
    const merged = (afterFrom ? [...tables, ...columns, ...keywords] : [...columns, ...tables, ...keywords])
      .sort((a, b) => Number(b.text.toLowerCase().startsWith(w)) - Number(a.text.toLowerCase().startsWith(w)) || a.text.length - b.text.length)
      .slice(0, 8);
    setSuggs(merged);
    setActive(0);
    if (merged.length && taRef.current) {
      const c = caretCoords(taRef.current, caret);
      const lh = parseFloat(getComputedStyle(taRef.current).lineHeight) || 16;
      const maxLeft = Math.max(0, taRef.current.clientWidth - 228);
      setPos({ top: c.top + lh + 4, left: Math.min(c.left, maxLeft) });
    }
    setOpen(merged.length > 0);
  }

  function accept(s: Sugg) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? value.length;
    const { start } = tokenAt(value, caret);
    const insert = s.kind === "keyword" ? s.text + " " : s.text;
    const next = value.slice(0, start) + insert + value.slice(caret);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      ta.focus();
      const p = start + insert.length;
      ta.setSelectionRange(p, p);
    });
  }

  function insertSnippet(sql: string) {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    onChange(value.slice(0, start) + sql + value.slice(end));
    setSnipOpen(false);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const rel = sql.indexOf("col");
      if (rel >= 0) ta.setSelectionRange(start + rel, start + rel + 3);
      else { const p = start + sql.length; ta.setSelectionRange(p, p); }
    });
  }

  // Shared box metrics so the highlight layer aligns exactly with the textarea.
  const boxClass = "w-full px-2.5 py-1.5 text-xs font-mono leading-5 border rounded-lg";

  return (
    <div className="relative">
      <div className="relative">
        <pre
          ref={preRef}
          aria-hidden
          className={`${boxClass} border-transparent absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none text-fg`}
          dangerouslySetInnerHTML={{ __html: value ? highlightSql(value, tblSet, colSet) + "\n" : '<span class="text-subtle">SELECT …</span>' }}
        />
        <textarea
          ref={taRef}
          value={value}
          rows={rows}
          spellCheck={false}
          onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? 0); }}
          onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0); }}
          onClick={(e) => refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggs.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggs.length) % suggs.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(suggs[active]); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.(); }}
          className={`${boxClass} relative bg-bg border-border-soft resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          style={{ color: "transparent", caretColor: "var(--fg)" }}
        />
      </div>
      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setSnipOpen((o) => !o)}
          className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1 cursor-pointer"
        >
          <span className="font-mono">+</span> Snippets
        </button>
        {snipOpen && (
          <ul className="absolute z-30 left-0 top-6 w-64 max-h-56 overflow-auto rounded-lg border border-border-soft bg-bg-elev-2 shadow-xl text-xs p-1">
            {SNIPPETS.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertSnippet(s.sql); }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-accent/15 cursor-pointer"
                >
                  <div className="font-medium text-fg">{s.label}</div>
                  <div className="font-mono text-[10px] text-subtle truncate">{s.sql}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <ul
          role="listbox"
          style={{ top: pos.top, left: pos.left }}
          className="absolute z-30 w-[220px] max-h-52 overflow-auto rounded-lg border border-border-soft bg-bg-elev-2 shadow-xl text-xs"
        >
          {suggs.map((s, i) => (
            <li key={`${s.kind}-${s.text}`}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); accept(s); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer ${i === active ? "bg-accent/15 text-fg" : "text-muted hover:bg-bg/60"}`}
              >
                <span className={`w-4 shrink-0 text-center font-mono font-semibold ${SIGIL_COLOR[s.kind]}`} title={s.kind}>{SIGIL[s.kind]}</span>
                <span className="font-mono truncate">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
