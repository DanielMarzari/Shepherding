import "server-only";

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface OcrLine {
  y: number;
  words: OcrWord[];
}
// Block tree as tesseract returns it — only the bits we read.
interface TesseractBlock {
  paragraphs?: Array<{
    lines?: Array<{
      words?: Array<{ text: string; bbox: OcrWord["bbox"] }>;
    }>;
  }>;
}

/** OCR fallback for MIR PDFs that ship their text as outlined paths or
 *  scanned images (Canva exports, scanned uploads, etc.) — anything
 *  where pdfjs's text extractor sees nothing. Each page is rendered to
 *  a PNG via pdfjs's NodeCanvasFactory, then run through tesseract.js.
 *  The word-level bounding boxes let us rebuild the MIR's 5-column
 *  table into a section-by-section text dump the standard parser can
 *  consume — so a Canva-exported MIR still ends up with Resources,
 *  Activities, Outputs, Outcomes, and IMPACT in the right places. */
export async function ocrPagesFromPdf(
  data: Uint8Array,
): Promise<Array<{ num: number; text: string }>> {
  // Polyfill the browser globals pdfjs's renderer pokes at. Text
  // extraction only needs DOMMatrix; rasterising a page also needs
  // window.requestAnimationFrame for the render loop scheduler.
  const g = globalThis as unknown as {
    DOMMatrix?: unknown;
    window?: { requestAnimationFrame?: unknown };
    requestAnimationFrame?: unknown;
  };
  if (typeof g.DOMMatrix === "undefined") {
    if (typeof g.window === "undefined") g.window = globalThis as never;
    // @ts-expect-error — geometry-polyfill ships no type declarations.
    await import("geometry-polyfill");
  }
  if (typeof g.window === "undefined") g.window = globalThis as never;
  if (typeof g.window!.requestAnimationFrame !== "function") {
    const raf = (cb: (t: number) => void) =>
      setImmediate(() => cb(performance.now())) as unknown as number;
    g.window!.requestAnimationFrame = raf;
    g.requestAnimationFrame = raf;
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createWorker } = await import("tesseract.js");

  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  // pdfjs in Node ships its own NodeCanvasFactory that wraps
  // @napi-rs/canvas with the exact internal API its renderer expects —
  // safer than building a canvas ourselves.
  const canvasFactory = doc.canvasFactory as {
    create(w: number, h: number): {
      canvas: { toBuffer(fmt: string): Buffer; width: number; height: number };
      context: unknown;
    };
    destroy(c: unknown): void;
  };

  // One worker for the whole document — model load is the expensive
  // part, so we want to amortise it across every page.
  const worker = await createWorker("eng");

  try {
    const out: Array<{ num: number; text: string }> = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      // 2x scale gives Tesseract enough resolution for body text
      // without ballooning RAM on big docs.
      const viewport = page.getViewport({ scale: 2 });
      const cc = canvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvasContext: cc.context as CanvasRenderingContext2D,
        canvas: cc.canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;
      // `blocks: true` is what gives us per-word bboxes we can use to
      // reconstruct the table columns.
      const result = await worker.recognize(
        cc.canvas.toBuffer("image/png"),
        {},
        { blocks: true },
      );
      const blocks = (result.data as { blocks?: TesseractBlock[] }).blocks ?? [];
      const reconstructed = reconstructMirPage(blocks);
      out.push({
        num: pageNum,
        text: reconstructed ?? (result.data.text ?? ""),
      });
      canvasFactory.destroy(cc);
      page.cleanup();
    }
    return out;
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
}

function collectWords(blocks: TesseractBlock[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const b of blocks) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          if (w.text && w.bbox) out.push({ text: w.text, bbox: w.bbox });
        }
      }
    }
  }
  return out;
}

/** Cluster words into visual lines using small y-coordinate proximity,
 *  then sort each line left-to-right. */
function groupLines(words: OcrWord[], yTol = 14): OcrLine[] {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const lines: OcrLine[] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.bbox.y0 - last.y) < yTol) {
      last.words.push(w);
    } else {
      lines.push({ y: w.bbox.y0, words: [w] });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return lines;
}

function lineText(l: OcrLine): string {
  return l.words.map((w) => w.text).join(" ");
}

/** Rebuild a single MIR page from the table layout into linear text the
 *  section parser can read. Returns null if the page doesn't have the
 *  five-column MIR header — covers, TOC, intro pages all hit that path
 *  and fall back to plain OCR text. */
function reconstructMirPage(blocks: TesseractBlock[]): string | null {
  const words = collectWords(blocks);
  if (words.length < 20) return null;

  // The five column headers must all be present and on roughly the
  // same y-line; sort left-to-right.
  const headerLabels = ["Resources", "Activities", "Outputs", "Outcomes"];
  const headers: OcrWord[] = [];
  for (const label of headerLabels) {
    const w = words.find(
      (x) => x.text.replace(/[^A-Za-z]/g, "") === label,
    );
    if (!w) return null;
    headers.push(w);
  }
  const impact = words.find((x) => /^IMPACT$/i.test(x.text));
  if (!impact) return null;
  headers.push(impact);
  headers.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const colCenters = headers.map((h) => (h.bbox.x0 + h.bbox.x1) / 2);
  const headerY =
    headers.reduce((s, h) => s + (h.bbox.y0 + h.bbox.y1) / 2, 0) /
    headers.length;

  // Team marker at the bottom defines where the body ends. "Ministry
  // Team" appears as body text in some reports too, so pick the
  // BOTTOM-most Team word — the real label line sits at the foot of
  // the page.
  const teamCandidates = words
    .filter((w) => /^Team:?$/i.test(w.text) && w.bbox.y0 > headerY)
    .sort((a, b) => b.bbox.y0 - a.bbox.y0);
  const teamWord = teamCandidates[0];
  const bodyBottomY = teamWord ? teamWord.bbox.y0 - 6 : Infinity;

  // Top section — title + Target Audience.
  const topLines = groupLines(words.filter((w) => w.bbox.y1 < headerY - 6));
  const topText = topLines.map(lineText).join("\n");

  // Body — assign each word to the nearest column by x-center.
  const bodyWords = words.filter(
    (w) => w.bbox.y0 > headerY + 10 && w.bbox.y1 < bodyBottomY,
  );
  const cols: OcrWord[][] = [[], [], [], [], []];
  for (const w of bodyWords) {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < colCenters.length; i++) {
      const d = Math.abs(cx - colCenters[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    cols[bestIdx].push(w);
  }
  const colTexts = cols.map((cw) => groupLines(cw).map(lineText).join("\n"));

  // Bottom section — the Team line and anything to its right.
  const bottomWords = teamWord
    ? words
        .filter((w) => w.bbox.y0 >= teamWord.bbox.y0 - 5)
        .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    : [];
  const bottomText = bottomWords.map((w) => w.text).join(" ");

  return [
    topText,
    "",
    "Resources",
    colTexts[0],
    "Activities",
    colTexts[1],
    "Outputs",
    colTexts[2],
    "Outcomes",
    colTexts[3],
    "IMPACT",
    colTexts[4],
    "",
    bottomText,
  ].join("\n");
}
