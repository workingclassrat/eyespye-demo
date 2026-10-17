import type { GazePoint } from "./gaze";

/**
 * Gaze-driven scrolling in both directions.
 *
 * Down (auto-follow reading): when the line you're reading drifts below `triggerLine`,
 * the page scrolls up smoothly — faster the lower your eyes go. As the text moves up, your
 * eyes follow the line upward, so scrolling eases off on its own. That feedback loop keeps
 * the current line in a comfortable band without any input.
 *
 * Up (go back): look into the top band (above `upLine`) and hold for a moment; the page
 * scrolls back, faster the closer to the top edge you look. Look back down to stop.
 */
export class AutoFollow {
  paused = false;
  /** Fraction of viewport height below which reading scrolls the page down. */
  triggerLine = 0.58;
  /** Fraction of viewport height above which the page scrolls back up. */
  upLine = 0.2;
  /** px per frame (at 60 fps) at full depth. */
  maxSpeed = 7;
  upMaxSpeed = 8;
  /** ms of steady, valid gaze before any scrolling (stops glances from scrolling). */
  settleMs = 450;
  /** Dwell needed in each zone before it starts scrolling. Up is longer: it's a deliberate gesture. */
  downDwellMs = 250;
  upDwellMs = 600;
  /** Last frame's state, for the UI. */
  scrolling: "down" | "up" | null = null;
  /** 0..1 progress toward triggering the up-scroll (for the UI cue). */
  upCharge = 0;

  private validSince = 0;
  private lowSince = 0;
  private highSince = 0;
  private carry = 0;

  tick(gaze: GazePoint, dtMs: number, now: number): void {
    this.scrolling = null;
    this.upCharge = 0;
    if (this.paused || !gaze.valid) {
      this.validSince = this.lowSince = this.highSince = 0;
      this.carry = 0;
      return;
    }
    if (!this.validSince) this.validSince = now;
    if (now - this.validSince < this.settleMs) return;

    const yN = gaze.y / innerHeight;
    let velocity = 0; // px per frame; + is down

    if (yN > this.triggerLine) {
      this.highSince = 0;
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince > this.downDwellMs) {
        const depth = Math.min(1, (yN - this.triggerLine) / (0.95 - this.triggerLine));
        velocity = this.maxSpeed * Math.pow(depth, 1.4);
      }
    } else if (yN < this.upLine && scrollY > 0) {
      this.lowSince = 0;
      if (!this.highSince) this.highSince = now;
      const held = now - this.highSince;
      this.upCharge = Math.min(1, held / this.upDwellMs);
      if (held > this.upDwellMs) {
        const depth = Math.min(1, (this.upLine - yN) / (this.upLine - 0.03));
        // Ease in over the first half second so it doesn't lurch.
        const ramp = Math.min(1, (held - this.upDwellMs) / 500);
        velocity = -this.upMaxSpeed * Math.pow(depth, 1.2) * (0.35 + 0.65 * ramp);
      }
    } else {
      this.lowSince = this.highSince = 0;
    }

    if (velocity === 0) {
      this.carry = 0;
      return;
    }
    this.carry += velocity * (dtMs / 16.67);
    const step = Math.trunc(this.carry);
    this.carry -= step;
    if (step > 0 && !atBottom()) {
      scrollBy(0, step);
      this.scrolling = "down";
    } else if (step < 0 && scrollY > 0) {
      scrollBy(0, step);
      this.scrolling = "up";
    }
  }
}

function atBottom(): boolean {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
}
