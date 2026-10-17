import type { Coverage } from "./coverage";
import type { MissedSummary, QuizQuestion } from "./types";

export type AiMode = "ai" | "offline";

export type SummaryResult =
  | { mode: AiMode; summary: MissedSummary; reason?: string }
  | { mode: "none" };

export interface QuizResult {
  mode: AiMode;
  questions: QuizQuestion[];
  reason?: string;
}

function readingPayload(title: string, coverage: Coverage) {
  return {
    title,
    paragraphs: coverage.paras.map((p) => {
      const s = coverage.status(p, true);
      return { id: p.id, heading: p.heading, text: p.text, status: s === "unseen" ? "skipped" : s };
    }),
  };
}

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: data.error === "no_api_key" ? "No API key configured" : data.error ?? `HTTP ${res.status}` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, reason: "AI server unreachable" };
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
export async function requestSummary(title: string, coverage: Coverage): Promise<SummaryResult> {
  const payload = readingPayload(title, coverage);
  if (!payload.paragraphs.some((p) => p.status !== "read")) return { mode: "none" };
  const r = await post<MissedSummary>("/api/summarize", payload);
  if (r.ok) return { mode: "ai", summary: r.data };
  return { mode: "offline", summary: offlineSummary(coverage), reason: r.reason };
}

/** Safety net for the live demo: key sentences from the missed paragraphs, no AI needed. */
function offlineSummary(coverage: Coverage): MissedSummary {
  const missed = coverage.paras.filter((p) => coverage.status(p, true) !== "read");
  return {
    headline: `You moved quickly past ${missed.length} paragraph${missed.length === 1 ? "" : "s"}. Here are their key sentences.`,
    points: missed.slice(0, 6).map((p) => ({
      paragraphIds: [p.id],
      status: coverage.status(p, true) === "skimmed" ? "skimmed" : "skipped",
      text: sentences(p.text)[0] ?? p.text.slice(0, 220),
    })),
    keyTerms: [],
    checkQuestion: "",
  };
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------
export async function requestQuiz(title: string, coverage: Coverage): Promise<QuizResult> {
  const r = await post<{ questions: QuizQuestion[] }>("/api/quiz", readingPayload(title, coverage));
  if (r.ok) return { mode: "ai", questions: r.data.questions };
  return { mode: "offline", questions: offlineQuiz(coverage), reason: r.reason };
}

/**
 * Offline fill-in-the-blank quiz: blanks out a year, number, or proper name in a sentence
 * (preferring the paragraphs the reader missed) and uses others of the same kind as distractors.
 */
function offlineQuiz(coverage: Coverage): QuizQuestion[] {
  const kinds: { kind: string; re: RegExp }[] = [
    { kind: "year", re: /\b(1[5-9]\d{2}|20\d{2})\b/g },
    { kind: "name", re: /(?<=[a-z,;] )(?:[A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g },
    { kind: "number", re: /\b\d+(?:\.\d+)?%?/g },
  ];
  const pool = new Map<string, Set<string>>();
  for (const p of coverage.paras)
    for (const { kind, re } of kinds) for (const m of p.text.matchAll(re)) {
      if (!pool.has(kind)) pool.set(kind, new Set());
      pool.get(kind)!.add(m[0]);
    }

  const ordered = [...coverage.paras].sort((a, b) => rank(coverage.status(a, true)) - rank(coverage.status(b, true)));
  const questions: QuizQuestion[] = [];
  const usedAnswers = new Set<string>();
  for (const p of ordered) {
    if (questions.length >= 5) break;
    for (const s of sentences(p.text)) {
      const hit = kinds
        .map(({ kind, re }) => ({ kind, m: [...s.matchAll(re)][0] }))
        .find((h) => h.m && !usedAnswers.has(h.m[0]) && (pool.get(h.kind)?.size ?? 0) >= 4);
      if (!hit?.m) continue;
      const answer = hit.m[0];
      const distractors = shuffle([...pool.get(hit.kind)!].filter((v) => v !== answer)).slice(0, 3);
      const options = shuffle([answer, ...distractors]);
      usedAnswers.add(answer);
      const st = coverage.status(p, true);
      questions.push({
        question: `Fill in the blank: "${s.replace(answer, "_____")}"`,
        options,
        answerIndex: options.indexOf(answer),
        explanation: `From the section${p.heading ? ` "${p.heading}"` : ""}: "${s}"`,
        paragraphId: p.id,
        fromMissed: st !== "read",
      });
      break;
    }
  }
  return questions;
}

function rank(s: string): number {
  return s === "skipped" || s === "unseen" ? 0 : s === "skimmed" ? 1 : 2;
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["”)]*/g) ?? [text]).map((s) => s.trim()).filter((s) => s.length > 30);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
