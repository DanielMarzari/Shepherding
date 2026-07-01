"use client";

import { useRef, useState } from "react";
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

// One-glyph key symbol per suggestion kind (shown in the dropdown).
const SIGIL: Record<Kind, string> = { table: "$", column: "#", keyword: "/" };
const SIGIL_COLOR: Record<Kind, string> = {
  table: "text-[color:var(--good-soft-fg)]",
  column: "text-accent",
  keyword: "text-subtle",
};

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
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  schema: DbSchema;
  rows?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [suggs, setSuggs] = useState<Sugg[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const allColumns = Array.from(new Set(Object.values(schema.columns).flat()));

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

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        rows={rows}
        spellCheck={false}
        placeholder="SELECT …"
        onChange={(e) => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0); }}
        onClick={(e) => refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggs.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggs.length) % suggs.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(suggs[active]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.(); }}
        className="w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-xs font-mono resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
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
