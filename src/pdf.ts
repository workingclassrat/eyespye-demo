import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Article, Block } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 80;

interface Line {
  text: string;
  page: number;
  y: number;
  x: number;
  right: number;
  size: number;
}

/**
 * Turns a PDF into headings + paragraphs so it can be shown in the large-type reader.
 * (Webcam gaze is line-level, so reflowed big text tracks far better than a tiny PDF page.)
 */
export async function loadPdf(file: File): Promise<Article> {
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);

  const lines: Line[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let cur: Line | null = null;
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as TextItem;
      const size = Math.hypot(item.transform[2], item.transform[3]) || item.height;
      const x = item.transform[4];
      const y = item.transform[5];
      // Start a new line when the baseline jumps.
      if (!cur || Math.abs(y - cur.y) > size * 0.5) {
        if (cur && cur.text.trim()) lines.push(cur);
        cur = { text: "", page: n, y, x, right: x, size };
      }
      if (item.str) {
        const needsSpace = cur.text && !cur.text.endsWith(" ") && !item.str.startsWith(" ") && x - cur.right > size * 0.15;
        cur.text += (needsSpace ? " " : "") + item.str;
        cur.right = Math.max(cur.right, x + item.width);
        cur.size = Math.max(cur.size, size);
      }
      if (item.hasEOL) {
        if (cur.text.trim()) lines.push(cur);
        cur = null;
      }
    }
    if (cur && cur.text.trim()) lines.push(cur);
    page.cleanup();
  }

  const clean = dropHeadersAndFooters(lines, pageCount)
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
  if (clean.length < 5) {
    throw new Error("This PDF has no selectable text (it may be a scanned image).");
  }

  const blocks = buildBlocks(clean);
  if (blocks.filter((b) => b.type === "p").length < 2) {
    throw new Error("Couldn't find readable paragraphs in this PDF.");
  }

  const meta = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
  const metaTitle = meta?.Title?.trim();
  const firstHeading = blocks.find((b) => b.type === "h")?.text;
  const title =
    metaTitle && metaTitle.length > 3 && !/\.(docx?|pdf|tex)$/i.test(metaTitle)
      ? metaTitle
      : firstHeading ?? file.name.replace(/\.pdf$/i, "");
  // Don't show the title twice.
  if (blocks[0]?.type === "h" && blocks[0].text === title) blocks.shift();

  const truncated = pdf.numPages > MAX_PAGES ? ` (first ${MAX_PAGES})` : "";
  return {
    title,
    byline: `PDF · ${file.name} · ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}${truncated}`,
    blocks,
  };
}

/** Running headers, footers, and page numbers repeat on most pages — remove them. */
function dropHeadersAndFooters(lines: Line[], pageCount: number): Line[] {
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const pagesWith = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = key(l.text);
    if (!pagesWith.has(k)) pagesWith.set(k, new Set());
    pagesWith.get(k)!.add(l.page);
  }
  const repeatThreshold = Math.max(2, Math.ceil(pageCount * 0.5));
  return lines.filter((l) => {
    const t = l.text.trim();
    if (/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(t)) return false;
    // Only short lines can be running headers/footers; never drop real sentences.
    if (pageCount < 2 || t.length > 120) return true;
    return (pagesWith.get(key(t))?.size ?? 0) < repeatThreshold;
  });
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function buildBlocks(lines: Line[]): Block[] {
  const bodySize = median(lines.map((l) => l.size));
  const bodyWidth = median(lines.map((l) => l.right - l.x));
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (lines[i].page === lines[i - 1].page && g > 0) gaps.push(g);
  }
  const lineGap = median(gaps) || bodySize * 1.2;

  const isHeading = (l: Line) =>
    l.size >= bodySize * 1.15 && l.text.length < 140 && !/[.,;:]$/.test(l.text) && /[A-Za-z]/.test(l.text);

  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    const text = joinLines(para);
    para = [];
    if (text.length >= 30) blocks.push(...splitLong(text));
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isHeading(l)) {
      flush();
      const prev = blocks[blocks.length - 1];
      const prevLine = lines[i - 1];
      // Multi-line headings: merge consecutive heading lines.
      if (prev?.type === "h" && prevLine && isHeading(prevLine) && prevLine.page === l.page) prev.text += " " + l.text;
      else blocks.push({ type: "h", text: l.text });
      if (/^(\d+\.?\s*)?(references|bibliography|works cited)$/i.test(l.text)) {
        blocks.pop(); // stop before the reference list
        break;
      }
      continue;
    }
    const prev = lines[i - 1];
    if (prev && para.length) {
      const gap = prev.y - l.y;
      const newPage = l.page !== prev.page;
      const bigGap = !newPage && (gap > lineGap * 1.45 || gap < 0);
      const prevShortEnd = prev.right - prev.x < bodyWidth * 0.7 && /[.!?:"”)]$/.test(prev.text);
      const indented = l.x - prev.x > bodySize * 1.2 && /^[A-Z“"]/.test(l.text);
      if (bigGap || (prevShortEnd && !newPage) || indented) flush();
    }
    para.push(l.text);
  }
  flush();
  return blocks;
}

function joinLines(lines: string[]): string {
  let out = "";
  for (const line of lines) {
    if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line; // re-join hyphenated words
    else out += " " + line;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Very long paragraphs become ~900-character chunks so coverage stays meaningful. */
function splitLong(text: string): Block[] {
  if (text.length <= 1400) return [{ type: "p", text }];
  const sentences = text.match(/[^.!?]+[.!?]+["”)]*\s*|[^.!?]+$/g) ?? [text];
  const out: Block[] = [];
  let chunk = "";
  for (const s of sentences) {
    if (chunk.length + s.length > 900 && chunk.length > 300) {
      out.push({ type: "p", text: chunk.trim() });
      chunk = "";
    }
    chunk += s;
  }
  if (chunk.trim()) out.push({ type: "p", text: chunk.trim() });
  return out;
}
