// The pure rule behind the wheel on the volume (wheel-volume.ts; WHEEL-VOLUME.md): how many 5 %
// steps a wheel event is worth, and how fast a trackpad may raise the level. No DOM, so
// tests/wheel-step.test.ts can pin it.
//
// A notched mouse sends one event per notch, its raw `wheelDeltaY` a multiple of 120. A
// precision touchpad (or a free-spinning wheel) sends many small events, and keeps sending
// them after the finger lifts. One step per EVENT (the pill's rule until 2026-10-27) took a
// touchpad swipe from quiet to full volume, so the scroll is added up: one step per notch's
// worth. A gesture with any value off the 120 grid is "smooth", and a smooth gesture may RAISE
// the level by at most `SMOOTH_RISE_PER_S` (his call, 2026-10-27: 40 % a second). Lowering is
// never held back, and a notched mouse is never capped.

export const STEP = 0.05;
/** The most a smooth gesture may raise the level in one second (his call, 2026-10-27). */
export const SMOOTH_RISE_PER_S = 0.4;
/** A pause this long (ms) between events ends a gesture. */
export const GESTURE_GAP_MS = 300;
const NOTCH = 120; // one notch in `wheelDeltaY` units
const PX_PER_NOTCH = 100; // one notch in `deltaY` pixels, when there is no `wheelDeltaY`

export type WheelDevice = "notch" | "smooth";

export interface WheelInput {
  /** The event's `deltaY` (down is positive). */
  deltaY: number;
  /** The legacy `wheelDeltaY` (up is positive), when the engine sends one. */
  wheelDeltaY?: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** The event's time, ms. */
  t: number;
}

export interface WheelOut {
  /** Signed steps to apply now: +1 is 5 % louder. */
  steps: number;
  /** The device this gesture reads as, so far. */
  device: WheelDevice;
  /** "start" on a gesture's first event, "smooth" when a gesture turns smooth part way. */
  note: "start" | "smooth" | null;
}

/** Whether this event says "a notched mouse". Anything the rule cannot read is smooth (the safe side). */
export function isNotch(e: WheelInput): boolean {
  const w = e.wheelDeltaY;
  return e.deltaMode === 0 && typeof w === "number" && w !== 0 && w % NOTCH === 0;
}

/** The event's travel in notches, up positive. */
export function notches(e: WheelInput): number {
  if (typeof e.wheelDeltaY === "number" && e.wheelDeltaY !== 0) return e.wheelDeltaY / NOTCH;
  const per = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : PX_PER_NOTCH;
  return -e.deltaY / per;
}

/** One wheel's state: the travel not yet worth a step, the gesture, the rise allowance. */
export function makeWheelStepper() {
  let acc = 0;
  let lastAt = -Infinity;
  let device: WheelDevice = "notch";
  // A token bucket for a smooth rise: it holds one step, and refills at the cap. So the first
  // step comes at once and the next ones come no faster than 40 % a second.
  let tokens = STEP;
  let tokensAt = -Infinity;

  return (e: WheelInput): WheelOut => {
    let note: WheelOut["note"] = null;
    if (e.t - lastAt > GESTURE_GAP_MS) {
      acc = 0;
      device = isNotch(e) ? "notch" : "smooth";
      note = "start";
    } else if (device === "notch" && !isNotch(e)) {
      device = "smooth";
      note = "smooth";
    }
    lastAt = e.t;

    const n = notches(e);
    if (n !== 0 && Math.sign(n) !== Math.sign(acc)) acc = 0; // the user turned back: start over
    acc += n;
    let steps = (acc > 0 ? Math.floor(acc + 1e-9) : Math.ceil(acc - 1e-9)) || 0; // never -0
    acc -= steps;

    if (steps > 0 && device === "smooth") {
      tokens = Math.min(STEP, tokens + (Number.isFinite(tokensAt) ? ((e.t - tokensAt) / 1000) * SMOOTH_RISE_PER_S : STEP));
      tokensAt = e.t;
      const allowed = Math.floor((tokens + 1e-9) / STEP);
      if (steps > allowed) {
        steps = allowed;
        acc = 0; // travel past the cap is dropped, never banked for later
      }
      tokens -= steps * STEP;
    }
    return { steps, device, note };
  };
}
