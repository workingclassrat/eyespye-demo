import { WebcamClient, WebEyeTrackProxy, type GazeResult } from "webeyetrack";

export type GazeSource = "eyes" | "mouse";

/** The minimum the scroller and coverage tracker need: a point and whether to trust it. */
export interface GazePoint {
  x: number;
  y: number;
  valid: boolean;
}

/**
 * One place that answers "where is the user looking right now?".
 * Source is either WebEyeTrack (webcam) or the mouse pointer (demo fallback / testing).
 * Coordinates are viewport pixels, same as clientX/clientY.
 */
export class GazeInput {
  x = innerWidth / 2;
  y = innerHeight / 2;
  /** True when we currently trust the gaze point (face found, eyes open / mouse in window). */
  valid = false;
  source: GazeSource = "mouse";
  /** WebEyeTrack has produced at least one gaze result (model + camera are running). */
  trackerReady = false;
  /** Eyes were detected at least once since the tracker started. */
  faceSeen = false;

  /** Higher = snappier, lower = steadier. WebEyeTrack already applies a Kalman filter. */
  smoothing = 0.3;
  /** In mouse mode: the pointer is over EyeSpye's own controls, so it isn't "reading". */
  mouseOverUi = false;

  private tracker: WebEyeTrackProxy | null = null;
  private eyeX = this.x;
  private eyeY = this.y;
  private eyesOpen = false;
  private lastResultAt = 0;
  private closedSince = 0;
  private mouseX = this.x;
  private mouseY = this.y;
  private mouseInside = false;

  constructor() {
    addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseInside = true;
    });
    document.documentElement.addEventListener("mouseleave", () => (this.mouseInside = false));
  }

  /** Starts the webcam + WebEyeTrack model. Safe to call more than once. */
  startEyes(): void {
    this.source = "eyes";
    if (this.tracker) return;
    const cam = new WebcamClient("webcam"); // <video id="webcam">
    this.tracker = new WebEyeTrackProxy(cam);
    this.tracker.onGazeResults = (r: GazeResult) => this.onResult(r);
  }

  useMouse(): void {
    this.source = "mouse";
  }

  get trackerStarted(): boolean {
    return this.tracker !== null;
  }

  /** How long the eyes have been closed (or face missing), in ms. 0 if open. */
  closedFor(now: number): number {
    return this.closedSince ? now - this.closedSince : 0;
  }

  private onResult(r: GazeResult): void {
    const now = performance.now();
    this.trackerReady = true;
    this.lastResultAt = now;

    if (r.gazeState !== "open") {
      if (this.eyesOpen || !this.closedSince) this.closedSince = now;
      this.eyesOpen = false;
      return;
    }
    this.faceSeen = true;
    this.eyesOpen = true;
    this.closedSince = 0;

    // normPog is in [-0.5, 0.5] with (0,0) at the screen center (WebEyeTrack README).
    const rx = clamp((r.normPog[0] + 0.5) * innerWidth, 0, innerWidth);
    const ry = clamp((r.normPog[1] + 0.5) * innerHeight, 0, innerHeight);
    this.eyeX += this.smoothing * (rx - this.eyeX);
    this.eyeY += this.smoothing * (ry - this.eyeY);
  }

  /** Call once per animation frame. */
  update(now: number): void {
    if (this.source === "mouse") {
      this.x = this.mouseX;
      this.y = this.mouseY;
      this.valid = this.mouseInside && !this.mouseOverUi;
      return;
    }
    this.x = this.eyeX;
    this.y = this.eyeY;
    // Results stop arriving if the worker stalls; treat stale data as invalid.
    this.valid = this.eyesOpen && now - this.lastResultAt < 600;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
