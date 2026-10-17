import type { GazeInput } from "./gaze";

// WebEyeTrack recalibrates on every window click, keeps only the 5 most recent points,
// ignores clicks <1s apart, and ignores clicks too close to the previous one.
// So: exactly 5 well-spread dots, each armed only after a hold timer.
const POINTS: [number, number][] = [
  [0.12, 0.14],
  [0.88, 0.14],
  [0.88, 0.86],
  [0.12, 0.86],
  [0.5, 0.5],
];
const HOLD_MS = 1300;

export type CalibrationResult = "start" | "redo";

export function runCalibration(root: HTMLElement, gaze: GazeInput): Promise<CalibrationResult> {
  return new Promise((resolve) => {
    root.innerHTML = `
      <div class="calib-help">
        <h2>Teach EyeSpye your eyes</h2>
        <p>Keep your head still. <b>Look at each dot</b> — when its ring fills, <b>click it</b> while still looking at it.</p>
        <p class="calib-step"></p>
        <p class="calib-warn" hidden>We can't see your eyes — move into the light and face the screen.</p>
      </div>`;
    root.hidden = false;
    root.className = "overlay calibrating";

    const help = root.querySelector<HTMLElement>(".calib-help")!;
    const stepEl = root.querySelector<HTMLElement>(".calib-step")!;
    const warnEl = root.querySelector<HTMLElement>(".calib-warn")!;
    let index = 0;
    let dot: HTMLButtonElement | null = null;
    let armed = false;
    let armTimer = 0;

    // Capture phase on window runs before WebEyeTrack's own window click listener,
    // so we can stop bad clicks from becoming bad calibration points.
    const guard = (e: MouseEvent) => {
      const onDot = dot !== null && e.target instanceof Node && dot.contains(e.target);
      const onButton = e.target instanceof Element && e.target.closest("button") !== null;
      if (onDot && armed && gaze.valid) return; // good point: let WebEyeTrack see it
      if (onButton && !onDot) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (onDot && !gaze.valid) flashWarn();
    };
    addEventListener("click", guard, true);

    function flashWarn() {
      warnEl.hidden = false;
      setTimeout(() => (warnEl.hidden = true), 2500);
    }

    function showPoint() {
      const [fx, fy] = POINTS[index];
      stepEl.textContent = `Dot ${index + 1} of ${POINTS.length}`;
      // Keep the instructions out of the way of the center dot.
      help.classList.toggle("calib-help--top", index === POINTS.length - 1);

      dot?.remove();
      dot = document.createElement("button");
      dot.className = "calib-dot";
      dot.setAttribute("aria-label", `Calibration dot ${index + 1}`);
      dot.style.left = `${fx * 100}%`;
      dot.style.top = `${fy * 100}%`;
      dot.style.setProperty("--hold", `${HOLD_MS}ms`);
      root.appendChild(dot);
      armed = false;
      clearTimeout(armTimer);
      armTimer = window.setTimeout(() => {
        armed = true;
        dot?.classList.add("armed");
      }, HOLD_MS);

      dot.addEventListener("click", () => {
        if (!armed || !gaze.valid) return;
        armed = false;
        dot!.classList.add("captured");
        index += 1;
        setTimeout(() => (index < POINTS.length ? showPoint() : showCheck()), 350);
      });
    }

    function showCheck() {
      dot?.remove();
      dot = null;
      removeEventListener("click", guard, true);
      root.className = "overlay checking";
      root.innerHTML = `
        <div class="calib-help calib-help--top">
          <h2>Check the tracking</h2>
          <p>Look around the page. The <span class="swatch"></span> circle shows where EyeSpye thinks you're looking.
          It only needs to land on the right <b>line</b> — reading is tracked line by line.</p>
          <div class="calib-actions">
            <button class="btn btn-primary" data-act="start">Looks good — start reading</button>
            <button class="btn" data-act="redo">Redo calibration</button>
          </div>
        </div>`;
      root.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) =>
        b.addEventListener("click", () => {
          root.classList.remove("checking");
          root.hidden = true;
          resolve(b.dataset.act as CalibrationResult);
        }),
      );
    }

    showPoint();
  });
}
