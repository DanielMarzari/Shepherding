/** Print a list as its own document, which the browser's print dialog
 *  saves as a PDF.
 *
 *  Not a screenshot of the page: the page is built for a screen — chips,
 *  tooltips, a sticky shell, colours that mean something only on hover —
 *  and printed as-is it splits rows across pages and loses half its
 *  meaning. This writes a plain document instead, laid out for paper: a
 *  header that repeats on every page, rows that never break in half, each
 *  section starting on a fresh sheet so a category can be handed to
 *  whoever is working it. The data is already in the browser — nothing
 *  round-trips, and no PDF library comes along for one button.
 */

export interface PrintColumn {
  label: string;
  /** A CSS width. Leave one column without, to take what is left. */
  width?: string;
  align?: "left" | "right" | "center";
}

export interface PrintRow {
  cells: string[];
  /** Marks the first cell with the warning sign, explained in the legend. */
  flag?: boolean;
  /** Cells shown as a tick or a dash rather than text, by index. */
  ticks?: Record<number, boolean>;
}

export interface PrintSection {
  heading?: string;
  note?: string;
  rows: PrintRow[];
}

export interface PrintDoc {
  /** Used for the document title and so for the PDF's file name. */
  title: string;
  subtitle?: string;
  /** Lines under the subtitle: which filters made this list. */
  meta?: string[];
  /** A small table of counts before the sections, for a split printout. */
  overview?: Array<{ label: string; count: number }>;
  columns: PrintColumn[];
  sections: PrintSection[];
  /** Each section on a new page. Off for a single list. */
  pagePerSection?: boolean;
  /** What the warning sign means. Printed only when a row carries one. */
  flagLegend?: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A CSS string literal, for the page footer's `content:`. */
const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const WARN_SVG =
  '<svg class="warn" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".95" fill="currentColor"/></svg>';

/** `caption` goes in the table's head, so it repeats with the column
 *  headings on every page the table runs to: a category on its third page
 *  still says which category it is. */
function renderTable(cols: PrintColumn[], rows: PrintRow[], caption = ""): string {
  const align = (c: PrintColumn) =>
    c.align === "right" ? ' class="r"' : c.align === "center" ? ' class="c"' : "";
  const colgroup = cols
    .map((c) => (c.width ? `<col style="width:${c.width}">` : "<col>"))
    .join("");
  const head = cols.map((c) => `<th${align(c)}>${esc(c.label)}</th>`).join("");
  const body = rows
    .map((r) => {
      const tds = cols.map((c, i) => {
        if (r.ticks && i in r.ticks) {
          return `<td${align(c)}>${
            r.ticks[i] ? '<span class="yes">✓</span>' : '<span class="no">–</span>'
          }</td>`;
        }
        const text = esc(r.cells[i] ?? "");
        const flag = i === 0 && r.flag ? ` <span class="flag">${WARN_SVG}</span>` : "";
        return `<td${align(c)}>${text}${flag}</td>`;
      });
      return `<tr>${tds.join("")}</tr>`;
    })
    .join("");
  const cap = caption
    ? `<tr><th class="cap" colspan="${cols.length}">${caption}</th></tr>`
    : "";
  return `<table><colgroup>${colgroup}</colgroup><thead>${cap}<tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildPrintHtml(d: PrintDoc): string {
  const printed = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const flagged = d.sections.some((s) => s.rows.some((r) => r.flag));
  const total = d.sections.reduce((n, s) => n + s.rows.length, 0);

  const overview = d.overview?.length
    ? `<div class="overview">${d.overview
        .map(
          (o) =>
            `<div><span class="n">${o.count.toLocaleString()}</span><span class="l">${esc(o.label)}</span></div>`,
        )
        .join("")}</div>`
    : "";

  const sections = d.sections
    .map((s) => {
      const head = s.heading
        ? `<h2>${esc(s.heading)}<span class="count">${s.rows.length.toLocaleString()} ${
            s.rows.length === 1 ? "person" : "people"
          }</span></h2>${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}`
        : "";
      const body = s.rows.length
        ? renderTable(d.columns, s.rows, head)
        : `<div class="cap">${head}</div><p class="empty">Nobody.</p>`;
      return `<section>${body}</section>`;
    })
    .join("");

  // In the header, not at the end: the first sign is on page one.
  const legend = flagged && d.flagLegend
    ? `<p class="legend"><span class="flag">${WARN_SVG}</span> ${esc(d.flagLegend)}</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(d.title)}</title>
<style>
@page {
  size: letter portrait;
  margin: 0.55in 0.5in 0.6in;
  @bottom-left { content: ${cssString(`${d.title} · printed ${printed}`)}; font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #888; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Helvetica Neue", Arial, sans-serif; color: #888; }
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1c1c1a; font: 9.5pt/1.35 "Inter", "Helvetica Neue", Arial, sans-serif; }
header.doc { border-bottom: 1.5pt solid #1c1c1a; padding-bottom: 7pt; margin-bottom: 12pt; }
header.doc h1 { font-size: 17pt; line-height: 1.15; margin: 0; letter-spacing: -0.01em; font-weight: 650; }
header.doc .sub { font-size: 10pt; color: #444; margin-top: 2pt; }
header.doc .meta { font-size: 8pt; color: #777; margin-top: 4pt; }
header.doc .meta span + span::before { content: " · "; }
.overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(1.3in, 1fr)); gap: 6pt; margin: 0 0 16pt; }
.overview > div { border: 0.75pt solid #d6d6d0; border-radius: 4pt; padding: 5pt 7pt; break-inside: avoid; }
.overview .n { display: block; font-size: 13pt; font-weight: 650; font-variant-numeric: tabular-nums; }
.overview .l { display: block; font-size: 7.5pt; color: #555; line-height: 1.25; }
${d.pagePerSection ? "section + section { break-before: page; }" : "section + section { margin-top: 16pt; }"}
.cap { text-align: left; font-size: inherit; text-transform: none; letter-spacing: 0; color: inherit; font-weight: inherit; padding: 0 0 7pt; border-bottom: 0; }
h2 { font-size: 12.5pt; margin: 0; font-weight: 650; color: #1c1c1a; }
h2 .count { font-size: 9pt; font-weight: 400; color: #777; margin-left: 7pt; font-variant-numeric: tabular-nums; }
.note { font-size: 8pt; font-weight: 400; color: #555; margin: 2pt 0 0; max-width: 6in; line-height: 1.35; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { font-size: 7pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #666; text-align: left; padding: 4pt 6pt; border-bottom: 0.9pt solid #1c1c1a; }
td { padding: 3.6pt 6pt; border-bottom: 0.5pt solid #e3e3de; vertical-align: top; overflow-wrap: anywhere; }
tbody tr:nth-child(even) td { background: #f6f6f3; }
td:first-child { font-weight: 500; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.c { text-align: center; }
.yes { color: #1d6b48; font-weight: 700; }
.no { color: #b9b9b2; }
.flag { color: #b5650d; white-space: nowrap; }
.warn { width: 8.5pt; height: 8.5pt; vertical-align: -0.5pt; }
.legend { font-size: 8pt; color: #555; margin: 4pt 0 0; }
.empty { color: #888; font-style: italic; }
</style></head>
<body>
<header class="doc">
  <h1>${esc(d.title)}</h1>
  ${d.subtitle ? `<div class="sub">${esc(d.subtitle)}</div>` : ""}
  <div class="meta"><span>${total.toLocaleString()} ${total === 1 ? "person" : "people"}</span>${(d.meta ?? [])
    .map((m) => `<span>${esc(m)}</span>`)
    .join("")}<span>Printed ${esc(printed)}</span></div>
  ${legend}
</header>
${overview}
${sections}
</body></html>`;
}

/** Print through a hidden frame: no new tab, no popup blocker, and the
 *  page underneath is left exactly as it was. */
export function printDocument(d: PrintDoc): void {
  document.querySelectorAll("iframe[data-print-frame]").forEach((f) => f.remove());
  const frame = document.createElement("iframe");
  frame.setAttribute("data-print-frame", "");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);

  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(buildPrintHtml(d));
  doc.close();

  // Some browsers name the PDF after the top page rather than the frame,
  // so lend it the list's title for the length of the dialog.
  const pageTitle = document.title;
  const restore = () => {
    document.title = pageTitle;
    setTimeout(() => frame.remove(), 0);
  };
  win.addEventListener("afterprint", restore, { once: true });

  const go = () => {
    document.title = d.title;
    win.focus();
    win.print();
  };
  // Wait for the frame's fonts, or the first page can print in a fallback.
  (doc.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(go, 60));
}
