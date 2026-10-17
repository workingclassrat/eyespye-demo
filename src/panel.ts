import type { Coverage, Para } from "./coverage";
import { requestQuiz, requestSummary } from "./ai";
import { copyMarkdown, downloadMarkdown, fmtTime, printNotes, type ExportData } from "./exporter";
import { wordmark } from "./brand";

type Tab = "summary" | "quiz";

/** The slide-in results panel: "What you missed" summary, quiz, and export. */
export class ResultsPanel {
  private data: ExportData | null = null;
  private tab: Tab = "summary";
  private summaryLoading = false;
  private quizLoading = false;
  private toast = "";
  private toastTimer = 0;

  constructor(
    private el: HTMLElement,
    private onJump: (p: Para) => void,
  ) {
    el.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLElement>("[data-act]");
      if (btn) void this.handle(btn);
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** Open the panel and generate the summary for the current reading. */
  async show(title: string, byline: string, coverage: Coverage, elapsedMs: number): Promise<void> {
    this.data = { title, byline, coverage, elapsedMs, summary: null, quiz: null, answers: [] };
    this.tab = "summary";
    this.summaryLoading = true;
    this.render();
    this.open();
    const data = this.data;
    const summary = await requestSummary(title, coverage);
    if (this.data !== data) return; // a newer reading replaced this one
    data.summary = summary;
    this.summaryLoading = false;
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.classList.remove("open");
    this.el.dispatchEvent(new Event("closed"));
    setTimeout(() => {
      if (!this.isOpen) this.el.hidden = true;
    }, 350);
  }

  private open(): void {
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add("open"));
  }

  private async handle(btn: HTMLElement): Promise<void> {
    const d = this.data;
    switch (btn.dataset.act) {
      case "close":
        return this.close();
      case "tab":
        this.tab = btn.dataset.tab as Tab;
        if (this.tab === "quiz" && d && !d.quiz && !this.quizLoading) return this.makeQuiz();
        return this.render();
      case "quiz":
        return this.makeQuiz();
      case "answer": {
        if (!d?.quiz) return;
        const q = Number(btn.dataset.q);
        if (d.answers[q] != null) return;
        d.answers[q] = Number(btn.dataset.o);
        return this.render();
      }
      case "jump": {
        const p = d?.coverage.paras[Number(btn.dataset.pid)];
        if (p) this.onJump(p);
        return;
      }
      case "copy":
        if (d) this.flash((await copyMarkdown(d)) ? "Copied notes to clipboard" : "Couldn't access the clipboard");
        return;
      case "md":
        if (d) downloadMarkdown(d);
        return this.flash("Downloaded Markdown notes");
      case "pdf":
        if (d) printNotes(d);
        return;
    }
  }

  private async makeQuiz(): Promise<void> {
    const d = this.data;
    if (!d) return;
    this.tab = "quiz";
    this.quizLoading = true;
    d.quiz = null;
    d.answers = [];
    this.render();
    const quiz = await requestQuiz(d.title, d.coverage);
    if (this.data !== d) return;
    d.quiz = quiz;
    d.answers = quiz.questions.map(() => null);
    this.quizLoading = false;
    this.render();
  }

  private flash(msg: string): void {
    this.toast = msg;
    this.render();
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = "";
      this.render();
    }, 2200);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  private render(): void {
    const d = this.data;
    if (!d) return;
    const scrollTop = this.el.querySelector(".panel-body")?.scrollTop ?? 0;
    const ready = !this.summaryLoading;
    this.el.innerHTML = `
      <div class="sp-bar">
        <svg class="logo-sp"><use href="#logo" /></svg>
        <span class="sp-name">${wordmark("wm-sp")}</span>
        <button class="icon-btn" data-act="close" aria-label="Close side panel">✕</button>
      </div>
      <div class="panel-head">
        <p class="eyebrow">Reading report</p>
        <h2>${this.tab === "quiz" ? "Test yourself" : "What you missed"}</h2>
      </div>
      ${this.statsRow(d)}
      <div class="tabs" role="tablist">
        <button role="tab" class="tab ${this.tab === "summary" ? "on" : ""}" data-act="tab" data-tab="summary">Summary</button>
        <button role="tab" class="tab ${this.tab === "quiz" ? "on" : ""}" data-act="tab" data-tab="quiz" ${ready ? "" : "disabled"}>Quiz</button>
      </div>
      <div class="panel-body">${this.tab === "quiz" ? this.quizBody(d) : this.summaryBody(d)}</div>
      <div class="panel-actions">
        <div class="export" ${ready ? "" : "hidden"}>
          <span class="label">Export</span>
          <button class="btn btn-small" data-act="copy" title="Copy as Markdown">Copy</button>
          <button class="btn btn-small" data-act="md" title="Download .md file">.md</button>
          <button class="btn btn-small" data-act="pdf" title="Save as PDF via the print dialog">PDF</button>
        </div>
        <button class="btn btn-small btn-ghost" data-act="close">Keep reading</button>
      </div>
      <div class="toast" ${this.toast ? "" : "hidden"}>${esc(this.toast)}</div>`;
    const body = this.el.querySelector(".panel-body");
    if (body) body.scrollTop = scrollTop;
  }

  private statsRow(d: ExportData): string {
    const s = d.coverage.stats(true);
    return `
      <div class="stats">
        <div><b>${Math.round(s.readShare * 100)}%</b><span>read closely</span></div>
        <div><b class="c-skimmed">${s.skimmed}</b><span>skimmed</span></div>
        <div><b class="c-skipped">${s.skipped + s.unseen}</b><span>skipped</span></div>
        <div><b>${fmtTime(d.elapsedMs)}</b><span>vs ${fmtTime(s.expectedMs)} full read</span></div>
      </div>`;
  }

  private jumpLabel(d: ExportData, ids: number[]): string {
    const names = [...new Set(ids.map((id) => d.coverage.paras[id]?.heading || "Introduction"))];
    return esc(names.join(" · "));
  }

  private summaryBody(d: ExportData): string {
    if (this.summaryLoading || !d.summary) return loading("Analyzing what you skipped and skimmed…");
    if (d.summary.mode === "none") {
      return `<p class="panel-headline">You read every section closely. Nothing to catch up on.</p>
        <button class="btn btn-primary" data-act="tab" data-tab="quiz">Quiz me anyway</button>`;
    }
    const s = d.summary.summary;
    const points = s.points
      .map(
        (pt) => `
        <li class="point point-${pt.status}">
          <span class="chip chip-${pt.status}">${pt.status}</span>
          <p>${esc(pt.text)}</p>
          <button class="jump" data-act="jump" data-pid="${pt.paragraphIds[0]}">↳ ${this.jumpLabel(d, pt.paragraphIds)}</button>
        </li>`,
      )
      .join("");
    const terms = s.keyTerms.length
      ? `<h3>Key terms you missed</h3><dl class="terms">${s.keyTerms
          .map((t) => `<dt>${esc(t.term)}</dt><dd>${esc(t.definition)}</dd>`)
          .join("")}</dl>`
      : "";
    const check = s.checkQuestion ? `<div class="check"><h3>Check yourself</h3><p>${esc(s.checkQuestion)}</p></div>` : "";
    const footer =
      d.summary.mode === "ai"
        ? "Smart summary by Claude, built only from the sections you missed."
        : `Offline summary (${esc(d.summary.reason ?? "AI unavailable")}). Add an API key for AI smart summaries.`;
    return `
      <p class="panel-headline">${esc(s.headline)}</p>
      <ol class="points">${points}</ol>
      ${terms}
      ${check}
      <button class="btn btn-primary btn-block" data-act="tab" data-tab="quiz">Test my understanding →</button>
      <p class="panel-footer">${footer}</p>`;
  }

  private quizBody(d: ExportData): string {
    if (this.quizLoading) return loading("Writing a quiz focused on what you missed…");
    const quiz = d.quiz;
    if (!quiz) return "";
    if (!quiz.questions.length) {
      return `<p class="panel-headline">Couldn't build an offline quiz for this reading.</p>
        <p class="panel-footer">${esc(quiz.reason ?? "")}. Add an API key for AI quizzes.</p>`;
    }
    const answered = d.answers.filter((a) => a !== null).length;
    const score = d.answers.filter((a, i) => a !== null && a === quiz.questions[i].answerIndex).length;
    const qs = quiz.questions
      .map((q, i) => {
        const pick = d.answers[i];
        const done = pick !== null;
        const opts = q.options
          .map((o, j) => {
            const cls = !done ? "" : j === q.answerIndex ? "correct" : j === pick ? "wrong" : "dim";
            return `<button class="opt ${cls}" data-act="answer" data-q="${i}" data-o="${j}" ${done ? "disabled" : ""}>
              <span class="opt-key">${String.fromCharCode(65 + j)}</span><span>${esc(o)}</span></button>`;
          })
          .join("");
        const feedback = done
          ? `<div class="feedback ${pick === q.answerIndex ? "ok" : "no"}">
              <b>${pick === q.answerIndex ? "Correct." : "Not quite."}</b> ${esc(q.explanation)}
              <button class="jump" data-act="jump" data-pid="${q.paragraphId}">↳ Review: ${this.jumpLabel(d, [q.paragraphId])}</button>
            </div>`
          : "";
        return `
          <li class="q">
            <p class="q-text"><span class="q-num">${String(i + 1).padStart(2, "0")}</span>${esc(q.question)}
              ${q.fromMissed ? `<span class="chip chip-skipped">from what you missed</span>` : ""}</p>
            <div class="opts">${opts}</div>
            ${feedback}
          </li>`;
      })
      .join("");
    const done = answered === quiz.questions.length;
    return `
      <div class="score ${done ? "final" : ""}">
        <b>${score}/${quiz.questions.length}</b>
        <span>${done ? scoreMessage(score / quiz.questions.length) : `${answered} of ${quiz.questions.length} answered`}</span>
      </div>
      <ol class="quiz">${qs}</ol>
      <button class="btn btn-block" data-act="quiz">New quiz</button>
      <p class="panel-footer">${
        quiz.mode === "ai"
          ? "Quiz by Claude, weighted toward the sections you skipped or skimmed."
          : `Offline fill-in-the-blank quiz (${esc(quiz.reason ?? "AI unavailable")}).`
      }</p>`;
  }
}

function scoreMessage(r: number): string {
  if (r === 1) return "Perfect. You caught everything.";
  if (r >= 0.6) return "Solid. Review the sections you missed.";
  return "Worth a second look at the highlighted sections.";
}

function loading(msg: string): string {
  return `<div class="panel-loading"><div class="spinner"></div><p>${msg}</p></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
