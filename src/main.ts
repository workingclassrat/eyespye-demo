import "./style.css";
import { GazeInput, type GazePoint } from "./gaze";
import { runCalibration } from "./calibration";
import { AutoFollow } from "./autoFollow";
import { Coverage, type Para } from "./coverage";
import { ResultsPanel } from "./panel";
import { SAMPLE_ARTICLE } from "./sampleArticle";
import { wordmark } from "./brand";
import type { Article } from "./types";

/*
 * The demo is framed as a browser extension: a mock browser window (tabs, address bar,
 * extension icon + popup), a web page being read, and EyeSpye's injected UI on top
 * (control bar, coverage strip, side panel). Press F for fullscreen so the mock browser
 * is the only one on screen.
 */

type Phase = "intro" | "loading" | "calibrating" | "reading" | "summary";
type TabId = "welcome" | "page";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const articleEl = $("#article");
const overlay = $("#overlay");
const gazeDot = $("#gaze-dot");
const minimap = $("#minimap");
const bar = $("#bar");
const endEl = $("#end");
const dropEl = $("#drop");
const fileInput = $<HTMLInputElement>("#file-input");
const popup = $("#ext-popup");
const extBtn = $("#ext-btn");
const badge = $("#ext-badge");
const coach = $("#coach");
const panelEl = $("#panel");

const gaze = new GazeInput();
const follow = new AutoFollow();
const panel = new ResultsPanel(panelEl, jumpTo);
let coverage: Coverage;
let article: Article = SAMPLE_ARTICLE;
let pageUrl = "studyhub.example/readings/why-you-forget";
let activeTab: TabId = "welcome";
let phase: Phase = "intro";
let debug = true;
let calibrated = false;
let readingMs = 0;
let endTop = 0;
let endVisibleSince = 0;
let endArmed = true;

// ---------------------------------------------------------------------------
// Mock browser: tabs + address bar
// ---------------------------------------------------------------------------
function renderTabs(): void {
  const tabs: { id: TabId; title: string; icon: string }[] = [
    { id: "welcome", title: "Welcome to EyeSpye", icon: `<svg class="logo-tab"><use href="#logo" /></svg>` },
    { id: "page", title: article.title, icon: `<span class="fav">${pageUrl.startsWith("file:") ? "PDF" : "S"}</span>` },
  ];
  $("#tabs").innerHTML = tabs
    .map(
      (t) => `<button class="tab ${t.id === activeTab ? "on" : ""}" data-tab="${t.id}" tabindex="-1">
        ${t.icon}<span class="tab-title">${esc(t.title)}</span><span class="tab-x">×</span></button>`,
    )
    .join("");
  $("#url").innerHTML =
    activeTab === "welcome"
      ? `<span class="url-scheme">extension://</span>eyespye/welcome`
      : pageUrl.startsWith("file:")
        ? `<span class="url-scheme">file://</span>${esc(pageUrl.slice(7))}`
        : esc(pageUrl.replace(/^https?:\/\//, ""));
}

$("#tabs").addEventListener("click", (e) => {
  const tab = (e.target as Element).closest<HTMLElement>("[data-tab]");
  if (tab && phase !== "calibrating" && phase !== "loading") switchTab(tab.dataset.tab as TabId);
});

function switchTab(id: TabId): void {
  activeTab = id;
  closePopup();
  if (id === "welcome") {
    showWelcome();
    bar.hidden = true;
  } else {
    overlay.hidden = phase === "intro" || phase === "reading" || phase === "summary" ? true : overlay.hidden;
    coach.hidden = phase !== "intro";
    bar.hidden = phase === "intro";
    requestAnimationFrame(remeasure);
  }
  renderTabs();
}

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------
function renderArticle(a: Article, url: string): void {
  article = a;
  pageUrl = url;
  articleEl.replaceChildren();
  const h1 = document.createElement("h1");
  h1.textContent = a.title;
  const by = document.createElement("p");
  by.className = "byline";
  by.textContent = a.byline;
  articleEl.append(h1, by);
  for (const b of a.blocks) {
    const el = document.createElement(b.type === "h" ? "h2" : "p");
    el.textContent = b.text;
    el.dataset.block = b.type;
    articleEl.append(el);
  }
  coverage = new Coverage(articleEl);
  uiCache.clear();
  readingMs = 0;
  endArmed = true;
  buildMinimap();
  scrollTo({ top: 0 });
  if (phase === "summary") phase = "reading";
  panel.close();
  renderTabs();
  remeasure();
}

async function loadUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/article?url=${encodeURIComponent(url)}`);
    const body = await res.json();
    if (!res.ok) return body.error ?? "Couldn't load that page.";
    renderArticle(body as Article, url);
    return null;
  } catch {
    return "The EyeSpye server isn't running (npm run dev starts it).";
  }
}

async function openPdf(file: File): Promise<void> {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return notify("That isn't a PDF.");
  notify(`Opening ${file.name}…`, 0);
  try {
    const { loadPdf } = await import("./pdf"); // pdf.js loads only when needed
    renderArticle(await loadPdf(file), `file:///Users/student/Downloads/${file.name}`);
    if (activeTab === "welcome") switchTab("page");
    notify(`Opened "${article.title}". ${coverage.paras.length} paragraphs ready to track.`);
  } catch (err) {
    console.error(err);
    notify(err instanceof Error ? err.message : "Couldn't read that PDF.");
  }
}

// ---------------------------------------------------------------------------
// Layout measurement (only when layout actually changes, never per frame)
// ---------------------------------------------------------------------------
function remeasure(): void {
  if (!coverage) return;
  coverage.measure();
  endTop = endEl.getBoundingClientRect().top + scrollY;
  layoutMinimap();
}
new ResizeObserver(() => remeasure()).observe(articleEl);
addEventListener("resize", remeasure);
document.fonts?.ready.then(remeasure);

// ---------------------------------------------------------------------------
// Welcome tab (the extension's onboarding page)
// ---------------------------------------------------------------------------
function showWelcome(): void {
  overlay.hidden = false;
  overlay.className = "overlay welcome";
  const started = phase !== "intro";
  overlay.innerHTML = `
    <div class="welcome-wrap">
      <div class="hero">
        <div class="shards" aria-hidden="true">${shards(80)}</div>
        <svg class="logo-hero"><use href="#logo" /></svg>
      </div>
      <h1 class="wm-hero-wrap">${wordmark("wm-hero")}</h1>
      <p class="tagline">Hands-free reading that notices <em>what you missed.</em></p>
      <div class="welcome-card glass">
        <ol class="steps">
          <li><span>01</span><div><b>Read with your eyes.</b> The page follows your reading down, and scrolls back when you look up.</div></li>
          <li><span>02</span><div><b>Every paragraph is tracked</b> as read, skimmed, or skipped.</div></li>
          <li><span>03</span><div><b>Get a smart summary</b> of what you missed, a quiz, and notes to export.</div></li>
        </ol>
        <div class="welcome-actions">
          ${
            started
              ? `<button class="btn btn-primary" data-act="back">Back to my reading →</button>`
              : `<button class="btn btn-primary" data-cmd="eyes"><svg class="ico"><use href="#i-eye" /></svg> Start with eye tracking</button>
                 <button class="btn" data-cmd="mouse"><svg class="ico"><use href="#i-mouse" /></svg> Demo with mouse</button>`
          }
          <button class="btn" data-cmd="pdf">Open a PDF</button>
        </div>
        <form class="url-form">
          <input type="url" name="url" placeholder="…or paste an article URL" />
          <button class="btn btn-small" type="submit">Open</button>
        </form>
        <p class="url-msg" hidden></p>
        ${started ? "" : `<button class="link-btn" data-act="try">Or walk through the extension flow: open the reading, then click the EyeSpye icon →</button>`}
      </div>
      <p class="fine">Sit about an arm's length away, face lit from the front, window maximized. EyeSpye uses your built-in camera; video never leaves your device.</p>
    </div>`;

  overlay.querySelector("[data-act=try]")?.addEventListener("click", () => switchTab("page"));
  overlay.querySelector("[data-act=back]")?.addEventListener("click", () => switchTab("page"));
  const form = overlay.querySelector<HTMLFormElement>(".url-form")!;
  const msg = overlay.querySelector<HTMLElement>(".url-msg")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = new FormData(form).get("url")?.toString().trim();
    if (!url) return;
    msg.hidden = false;
    msg.textContent = "Opening…";
    const err = await loadUrl(url);
    if (err) msg.textContent = err;
    else switchTab("page");
  });
}

/** Static glassy pixel shards radiating sideways from the eye (deterministic layout). */
function shards(n: number): string {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let out = "";
  for (let i = 0; i < n; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const spread = Math.pow(rand(), 0.8);
    const x = 50 + side * (8 + spread * 44);
    const y = 50 + (rand() - 0.5) * 70 * (1 - spread * 0.55);
    const w = 4 + rand() * 18;
    const h = 3 + rand() * 9;
    const o = (0.3 + rand() * 0.7) * (1 - spread * 0.6);
    out += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${w.toFixed(0)}px;height:${h.toFixed(0)}px;opacity:${o.toFixed(2)}"></i>`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extension popup
// ---------------------------------------------------------------------------
function openPopup(): void {
  coach.hidden = true;
  popup.hidden = false;
  extBtn.classList.add("on");
}
function closePopup(): void {
  popup.hidden = true;
  extBtn.classList.remove("on");
}
extBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (popup.hidden) openPopup();
  else closePopup();
});
document.addEventListener("click", (e) => {
  if (!popup.hidden && !popup.contains(e.target as Node) && !extBtn.contains(e.target as Node)) closePopup();
});

// ---------------------------------------------------------------------------
// Startup: eye mode / mouse mode
// ---------------------------------------------------------------------------
function startMouse(): void {
  closePopup();
  gaze.useMouse();
  document.body.classList.remove("show-cam"); // the preview only makes sense in eye mode
  if (phase === "intro" || phase === "loading") {
    if (activeTab !== "page") {
      activeTab = "page";
      renderTabs();
    }
    overlay.hidden = true;
    coach.hidden = true;
    beginReading();
  }
}

async function startEyes(): Promise<void> {
  closePopup();
  coach.hidden = true;
  if (activeTab !== "page") {
    activeTab = "page";
    renderTabs();
  }
  // Already calibrated earlier in this session: just switch the input back to the eyes.
  if (calibrated && gaze.trackerStarted) {
    gaze.startEyes();
    return;
  }
  const wasReading = phase === "reading" || phase === "summary";
  phase = "loading";
  follow.paused = true;
  bar.hidden = true;
  overlay.hidden = false;
  overlay.className = "overlay loading";
  overlay.innerHTML = `
    <div class="glass center-card">
      <svg class="logo-load"><use href="#logo" /></svg>
      <h2>Waking up ${wordmark("wm-inline")}</h2>
      <p class="load-msg">Allow camera access if your browser asks. Everything runs on this laptop; video never leaves it.</p>
      <div class="loader"><i></i></div>
      <button class="btn btn-small" data-act="mouse"><svg class="ico"><use href="#i-mouse" /></svg> Use mouse instead</button>
    </div>`;
  overlay.querySelector("[data-act=mouse]")!.addEventListener("click", () => {
    phase = wasReading ? "reading" : "intro";
    startMouse();
    if (wasReading) {
      overlay.hidden = true;
      beginReading();
    }
  });
  document.body.classList.add("show-cam");
  const msg = overlay.querySelector<HTMLElement>(".load-msg")!;

  try {
    gaze.startEyes();
  } catch (err) {
    console.error(err);
    msg.textContent = "Couldn't start eye tracking. Use mouse mode for now.";
    return;
  }

  const started = performance.now();
  await new Promise<void>((resolve) => {
    const check = () => {
      if (phase !== "loading") return; // user switched to mouse
      if (gaze.faceSeen) return resolve();
      const waited = performance.now() - started;
      if (gaze.trackerReady && waited > 4000) msg.textContent = "Model loaded, but no face found yet. Face the screen with your face well lit.";
      else if (waited > 30000) msg.textContent = "Still loading… check the browser console, or use mouse mode.";
      setTimeout(check, 250);
    };
    check();
  });
  if (phase !== "loading") return;
  await calibrate();
}

async function calibrate(): Promise<void> {
  phase = "calibrating";
  follow.paused = true;
  panel.close();
  closePopup();
  bar.hidden = true;
  document.body.classList.add("calib-mode");
  let result = await runCalibration(overlay, gaze);
  while (result === "redo") result = await runCalibration(overlay, gaze);
  calibrated = true;
  document.body.classList.remove("calib-mode");
  overlay.className = "overlay";
  gaze.startEyes();
  beginReading();
}

function beginReading(): void {
  phase = "reading";
  follow.paused = false;
  bar.hidden = activeTab !== "page";
  document.body.classList.add("active");
  document.body.classList.toggle("debug", debug);
  requestAnimationFrame(remeasure); // the coverage strip has a size now
}

// ---------------------------------------------------------------------------
// Finish → report in the side panel (summary, quiz, export)
// ---------------------------------------------------------------------------
function finish(): void {
  if (phase !== "reading") return;
  closePopup();
  phase = "summary";
  endArmed = false;
  follow.paused = true;
  document.body.classList.add("side-open");
  void panel.show(article.title, article.byline, coverage, readingMs);
}

function jumpTo(p: Para): void {
  panel.close();
  setTimeout(() => {
    p.el.scrollIntoView({ behavior: "smooth", block: "center" });
    p.el.classList.remove("flash");
    void p.el.offsetWidth; // restart the animation
    p.el.classList.add("flash");
  }, 50);
}

panelEl.addEventListener("closed", () => {
  document.body.classList.remove("side-open");
  if (phase === "summary") {
    phase = "reading";
    follow.paused = false;
  }
});

// ---------------------------------------------------------------------------
// PDF: drag & drop anywhere, or the file picker
// ---------------------------------------------------------------------------
let dragDepth = 0;
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropEl.hidden = false;
});
addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropEl.hidden = true;
});
addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (file) void openPdf(file);
  else notify("Drop a PDF file.");
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openPdf(file);
  fileInput.value = "";
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
const toastEl = document.createElement("div");
toastEl.id = "toast";
toastEl.hidden = true;
document.body.append(toastEl);
let toastTimer = 0;
function notify(msg: string, ms = 3500): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms);
}

// ---------------------------------------------------------------------------
// Minimap (EyeSpye's coverage strip on the right edge of the page)
// ---------------------------------------------------------------------------
let minimapCells: HTMLElement[] = [];
const minimapView = document.createElement("div");
minimapView.className = "mm-view";

function buildMinimap(): void {
  minimap.replaceChildren();
  minimapCells = coverage.paras.map((p) => {
    const cell = document.createElement("button");
    cell.className = "mm-cell";
    cell.title = p.heading || "Introduction";
    cell.addEventListener("click", () => p.el.scrollIntoView({ behavior: "smooth", block: "center" }));
    minimap.append(cell);
    return cell;
  });
  minimap.append(minimapView);
}

function layoutMinimap(): void {
  if (!coverage || !minimapCells.length) return;
  const docH = document.documentElement.scrollHeight;
  const h = minimap.clientHeight;
  if (!h) return;
  coverage.paras.forEach((p, i) => {
    minimapCells[i].style.top = `${(p.top / docH) * h}px`;
    minimapCells[i].style.height = `${Math.max(2, ((p.bottom - p.top) / docH) * h - 2)}px`;
  });
}

// ---------------------------------------------------------------------------
// Pointer over EyeSpye's own UI (mouse mode shouldn't "read" the toolbar)
// ---------------------------------------------------------------------------
const UI_SELECTOR = "#browser, #bar, #panel, #ext-popup, #coach, #minimap";
document.addEventListener("pointerover", (e) => {
  gaze.mouseOverUi = !!(e.target as Element).closest?.(UI_SELECTOR);
});
let barRect: DOMRect | null = null;
new ResizeObserver(() => (barRect = bar.hidden ? null : bar.getBoundingClientRect())).observe(bar);

// ---------------------------------------------------------------------------
// Main loop: per-frame work is tracking + transforms only.
// ---------------------------------------------------------------------------
const cueUp = $("#cue-up");
const cueDown = $("#cue-down");
const upCharge = $("#up-zone").querySelector<HTMLElement>("b")!;
const point: GazePoint = { x: 0, y: 0, valid: false };
let last = performance.now();
let lastUi = 0;
let lastScrolling: "up" | "down" | null = null;
let lastCharge = -1;
let lastDot = "";

function frame(now: number): void {
  const dt = now - last;
  last = now;
  gaze.update(now);

  // Eyes resting on the control bar or the side panel aren't reading the page.
  const onBar = barRect && !bar.hidden && gaze.y > barRect.top - 8 && gaze.x > barRect.left - 8 && gaze.x < barRect.right + 8;
  const onPanel = phase === "summary" && gaze.x > innerWidth - panelEl.offsetWidth;
  point.x = gaze.x;
  point.y = gaze.y;
  point.valid = gaze.valid && !onBar && !onPanel;

  if (phase === "reading" && activeTab === "page") {
    follow.tick(point, dt, now);
    if (!follow.paused) {
      coverage.tick(point, dt);
      if (point.valid) readingMs += Math.min(dt, 100);
    }
    checkEnd(now);
  } else {
    follow.scrolling = null;
    follow.upCharge = 0;
  }

  const showDot = (phase === "calibrating" && overlay.classList.contains("checking")) || (phase === "reading" && debug && activeTab === "page");
  const dotVisible = showDot && gaze.valid;
  if (gazeDot.hidden === dotVisible) gazeDot.hidden = !dotVisible;
  if (dotVisible) {
    const t = `translate3d(${gaze.x.toFixed(1)}px, ${gaze.y.toFixed(1)}px, 0)`;
    if (t !== lastDot) gazeDot.style.transform = lastDot = t;
  }

  if (follow.scrolling !== lastScrolling) {
    lastScrolling = follow.scrolling;
    cueUp.classList.toggle("on", lastScrolling === "up");
    cueDown.classList.toggle("on", lastScrolling === "down");
  }
  const charge = Math.round(follow.upCharge * 10) / 10;
  if (charge !== lastCharge) upCharge.style.opacity = String((lastCharge = charge));

  if (now - lastUi > 200) {
    lastUi = now;
    updateUi(now);
  }
  requestAnimationFrame(frame);
}

function checkEnd(now: number): void {
  const visible = endTop - scrollY < innerHeight * 0.85;
  if (!visible) {
    endVisibleSince = 0;
    endArmed = true;
    return;
  }
  if (!endArmed) return;
  if (!endVisibleSince) endVisibleSince = now;
  if (now - endVisibleSince > 1200) finish();
}

/** Writes to the DOM only when a value actually changed. */
const uiCache = new Map<string, string>();
function set(key: string, value: string, apply: () => void): void {
  if (uiCache.get(key) === value) return;
  uiCache.set(key, value);
  apply();
}

function updateUi(now: number): void {
  if (!coverage) return;
  const tracking = debug && document.body.classList.contains("active");
  coverage.paras.forEach((p, i) => {
    const s = coverage.status(p);
    const active = coverage.activeId === p.id;
    set(`p${i}`, `${s}|${active}`, () => {
      p.el.classList.remove("st-read", "st-skimmed", "st-skipped", "st-unseen");
      p.el.classList.add(`st-${s}`);
      p.el.classList.toggle("active", active);
      minimapCells[i].className = `mm-cell st-${s}${active ? " active" : ""}`;
    });
    if (tracking) {
      const fill = (Math.round(coverage.ratio(p) * 20) / 20).toString();
      set(`f${i}`, fill, () => p.el.style.setProperty("--fill", fill));
    }
  });

  const docH = document.documentElement.scrollHeight;
  const mh = minimap.clientHeight;
  set("mmv", `${Math.round(scrollY)}|${docH}|${mh}`, () => {
    minimapView.style.top = `${(scrollY / docH) * mh}px`;
    minimapView.style.height = `${(innerHeight / docH) * mh}px`;
  });

  const st = coverage.stats();
  const pct = Math.round(st.readShare * 100);
  const meterHtml = `<b>${pct}%</b> read <i class="dot d-skimmed"></i>${st.skimmed} <i class="dot d-skipped"></i>${st.skipped}`;
  set("meter", phase === "intro" ? "" : meterHtml, () => $$(".meter").forEach((m) => (m.innerHTML = phase === "intro" ? "" : meterHtml)));

  let label: string, tone: string;
  if (phase === "intro") [label, tone] = ["Off", "idle"];
  else if (phase === "loading") [label, tone] = ["Starting", "idle"];
  else if (phase === "calibrating") [label, tone] = ["Calibrating", "idle"];
  else if (phase === "summary") [label, tone] = ["Report ready", "live"];
  else if (follow.paused) [label, tone] = ["Paused", "warn"];
  else if (gaze.source === "mouse" && gaze.mouseOverUi) [label, tone] = ["Mouse mode · on controls", "idle"];
  else if (!gaze.valid) [label, tone] = [gaze.source === "eyes" ? (gaze.closedFor(now) > 0 ? "Eyes not detected" : "Searching…") : "Point at the text", "warn"];
  else if (follow.scrolling === "down") [label, tone] = ["Following ↓", "live"];
  else if (follow.scrolling === "up") [label, tone] = ["Scrolling back ↑", "live"];
  else [label, tone] = [gaze.source === "eyes" ? "Tracking eyes" : "Mouse mode", "live"];
  set("status", `${label}|${tone}`, () =>
    $$(".status").forEach((s) => {
      s.textContent = label;
      s.dataset.tone = tone;
    }),
  );

  const badgeText = phase === "reading" || phase === "summary" ? `${pct}` : "";
  set("badge", `${phase === "intro"}|${badgeText}|${tone}`, () => {
    badge.hidden = phase === "intro";
    badge.textContent = badgeText;
    badge.dataset.tone = tone;
  });

  set("controls", `${follow.paused}|${gaze.source}|${phase}|${debug}|${document.body.classList.contains("show-cam")}`, () => {
    $$("[data-label=pause]").forEach((b) => (b.textContent = follow.paused ? "Resume" : "Pause"));
    const started = phase !== "intro";
    $$("[data-cmd=eyes]").forEach((b) => b.classList.toggle("on", started && gaze.source === "eyes"));
    $$("[data-cmd=mouse]").forEach((b) => b.classList.toggle("on", started && gaze.source === "mouse"));
    $$("[data-cmd=debug]").forEach((b) => b.classList.toggle("on", debug));
    $$("[data-cmd=cam]").forEach((b) => b.classList.toggle("on", document.body.classList.contains("show-cam")));
    $$("[data-cmd=pause]").forEach((b) => b.classList.toggle("on", follow.paused));
  });
}

// ---------------------------------------------------------------------------
// Commands: one handler for the popup, the control bar, the welcome page, and keys
// ---------------------------------------------------------------------------
function run(cmd: string): void {
  switch (cmd) {
    case "eyes":
      if (gaze.source === "eyes" && phase !== "intro" && phase !== "loading") return;
      return void startEyes();
    case "mouse":
      return startMouse();
    case "toggle-mode":
      if (phase === "intro") return;
      return gaze.source === "eyes" ? startMouse() : void startEyes();
    case "pause":
      if (phase === "reading") follow.paused = !follow.paused;
      return;
    case "calib":
      if (phase === "intro" || phase === "loading" || phase === "calibrating") return;
      calibrated = false;
      return void startEyes();
    case "debug":
      debug = !debug;
      document.body.classList.toggle("debug", debug);
      return;
    case "cam":
      document.body.classList.toggle("show-cam");
      return;
    case "pdf":
      return fileInput.click();
    case "reset":
      if (!coverage) return;
      coverage.reset();
      readingMs = 0;
      endArmed = true;
      panel.close();
      if (phase === "summary") phase = "reading";
      follow.paused = false;
      scrollTo({ top: 0, behavior: "smooth" });
      return;
    case "finish":
      return finish();
    case "fullscreen":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => notify("Fullscreen was blocked by the browser."));
      return;
  }
}

document.addEventListener("click", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-cmd]");
  if (el) run(el.dataset.cmd!);
});

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const keys: Record<string, string> = { " ": "pause", d: "debug", m: "toggle-mode", c: "calib", s: "finish", r: "reset", o: "pdf", f: "fullscreen", v: "cam" };
  const k = e.key.toLowerCase();
  if (k === "escape") {
    closePopup();
    panel.close();
  } else if (keys[k]) {
    if (k === " ") e.preventDefault();
    run(keys[k]);
  }
});

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
renderArticle(SAMPLE_ARTICLE, pageUrl);
showWelcome();
renderTabs();
const initialUrl = new URLSearchParams(location.search).get("url");
if (initialUrl) void loadUrl(initialUrl);
requestAnimationFrame(frame);

// Handy for live tuning from the browser console, e.g. eyespye.follow.upMaxSpeed = 10
Object.assign(window, { eyespye: { gaze, follow, get coverage() { return coverage; } } });
