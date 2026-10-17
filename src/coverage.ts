import type { GazePoint } from "./gaze";
import type { ReadStatus } from "./types";

export interface Para {
  id: number;
  el: HTMLElement;
  heading: string;
  text: string;
  words: number;
  /** ms of gaze that landed on this paragraph */
  dwellMs: number;
  /** ms a typical reader at `wpm` would need */
  expectedMs: number;
  /** The reader has scrolled past it (its bottom went above the reading area). */
  passed: boolean;
  /** Cached position in document coordinates (see measure()). */
  top: number;
  bottom: number;
}

/** Fraction of expected reading time needed to count as "read" / "skimmed". */
const READ_RATIO = 0.5;
const SKIM_RATIO = 0.15;
/** Webcam gaze is line-level, so give each paragraph a little vertical slack. */
const SLACK_PX = 14;

/**
 * Tracks how long the gaze rests on each paragraph and compares it with how long
 * the paragraph should take to read. Only vertical position is used: webcam trackers
 * are much better at "which line" than "which word".
 *
 * Paragraph positions are measured once (and again whenever layout changes) rather than
 * every frame, so tracking never forces the browser to recalculate layout while scrolling.
 */
export class Coverage {
  paras: Para[] = [];
  wpm = 230;
  activeId: number | null = null;

  constructor(root: HTMLElement) {
    let heading = "";
    root.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => {
      const text = el.textContent ?? "";
      if (el.dataset.block === "h") {
        heading = text;
        return;
      }
      const words = text.split(/\s+/).filter(Boolean).length;
      this.paras.push({ id: this.paras.length, el, heading, text, words, dwellMs: 0, expectedMs: 0, passed: false, top: 0, bottom: 0 });
      el.dataset.pid = String(this.paras.length - 1);
    });
    this.setWpm(this.wpm);
    this.measure();
  }

  /** Re-read paragraph positions. Call after anything that changes layout. */
  measure(): void {
    const sy = scrollY;
    for (const p of this.paras) {
      const r = p.el.getBoundingClientRect();
      p.top = r.top + sy;
      p.bottom = r.bottom + sy;
    }
  }

  setWpm(wpm: number): void {
    this.wpm = wpm;
    for (const p of this.paras) p.expectedMs = Math.max(1500, (p.words / wpm) * 60_000);
  }

  reset(): void {
    for (const p of this.paras) {
      p.dwellMs = 0;
      p.passed = false;
    }
  }

  tick(gaze: GazePoint, dtMs: number): void {
    this.activeId = null;
    const dt = Math.min(dtMs, 100); // ignore long gaps (tab hidden, etc.)
    const sy = scrollY;
    const passLine = sy + innerHeight * 0.3;
    const gy = gaze.y + sy; // gaze in document coordinates

    let best: Para | null = null;
    let bestDist = Infinity;
    for (const p of this.paras) {
      if (p.bottom < passLine) p.passed = true;
      if (!gaze.valid) continue;
      if (gy >= p.top - SLACK_PX && gy <= p.bottom + SLACK_PX) {
        const dist = gy < p.top ? p.top - gy : gy > p.bottom ? gy - p.bottom : 0;
        if (dist < bestDist) {
          best = p;
          bestDist = dist;
        }
      }
    }
    if (best) {
      best.dwellMs += dt;
      this.activeId = best.id;
    }
  }

  status(p: Para, finished = false): ReadStatus {
    const ratio = p.dwellMs / p.expectedMs;
    if (ratio >= READ_RATIO) return "read";
    if (ratio >= SKIM_RATIO) return "skimmed";
    return p.passed || finished ? "skipped" : "unseen";
  }

  /** 0..1 how much of each paragraph's expected reading time was spent, capped at 1. */
  ratio(p: Para): number {
    return Math.min(1, p.dwellMs / p.expectedMs);
  }

  stats(finished = false) {
    let read = 0, skimmed = 0, skipped = 0, unseen = 0, words = 0, readWords = 0, expectedMs = 0;
    for (const p of this.paras) {
      const s = this.status(p, finished);
      if (s === "read") read++;
      else if (s === "skimmed") skimmed++;
      else if (s === "skipped") skipped++;
      else unseen++;
      words += p.words;
      expectedMs += p.expectedMs;
      if (s === "read") readWords += p.words;
    }
    return {
      read, skimmed, skipped, unseen,
      total: this.paras.length,
      expectedMs,
      /** share of the article's words in paragraphs that were read closely */
      readShare: words ? readWords / words : 0,
    };
  }
}
