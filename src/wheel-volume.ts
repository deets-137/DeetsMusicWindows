// The wheel on the volume (WHEEL-VOLUME.md): the title bar pill, and the Now Playing card while
// Settings › Playback › *Scroll over the Player for volume* is on. One stepper for both, so a
// gesture that crosses from one to the other keeps its count and its cap. The rule is
// wheel-step.ts; this file only reads the event and moves the level.

import { getLevel, setVolume } from "./player";
import { makeWheelStepper, STEP } from "./wheel-step";
import * as diag from "./diag";

const stepper = makeWheelStepper();
const listeners = new Set<(where: string) => void>();

/** Called on every wheel event the volume takes (the title bar pill grows on it, §3a). */
export function onWheelVolume(fn: (where: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Wire the wheel on `el` to the volume. `on()` false lets the event through untouched (the
 * card's toggle). A pinch (Ctrl + wheel) and a sideways swipe are never ours.
 */
export function wireWheelVolume(el: HTMLElement, where: string, on: () => boolean = () => true): () => void {
  const onWheel = (e: WheelEvent) => {
    if (!on() || e.ctrlKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const wheelDeltaY = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const out = stepper({ deltaY: e.deltaY, wheelDeltaY, deltaMode: e.deltaMode, t: e.timeStamp });
    // One line per gesture (and one more if it turns smooth), with the raw values the device
    // sent: the record that confirms the notch rule on real hardware.
    if (out.note) diag.log("wheel:volume", { where, note: out.note, device: out.device, wheelDeltaY, deltaY: e.deltaY, deltaMode: e.deltaMode });
    if (out.steps) setVolume(Math.max(0, Math.min(1, getLevel() + out.steps * STEP)));
    for (const fn of listeners) fn(where);
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}
