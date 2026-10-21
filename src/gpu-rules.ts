// The quiet restart's rule (GRAPHICS-FALLBACK.md §10.5), pure so it is under test. gpu.ts reads
// the state and acts on the answer.
//
// His calls (2026-10-20): the app restarts by itself only when its window cannot be seen (F1 A),
// and while music plays it restarts between two songs (F2 A). On screen, the toast asks.

/** What Rust's adapter test said (gpu.rs `CardAnswer`): unknown before the first answer. */
export type Card = "unknown" | "ready" | "none";

export interface QuietState {
  /** Settings › Motion › If graphics fail. */
  mode: "save" | "tell" | "off";
  /** The `graphics` fact. */
  graphics: "accelerated" | "software" | undefined;
  card: Card;
  /** The main window: on screen, hidden in the tray, or minimized. */
  window: "shown" | "tray" | "min";
  playing: boolean;
  /** One quiet restart already ran for this failure and the app still draws in software: no
   *  second one until a new adapter change (§10.5 Guards). */
  tried: boolean;
  /** Something a restart would break: a listening room, an AirPlay speaker playing, typed text. */
  busy: boolean;
}

/**
 * - `none`: nothing to do (the card is in use, or the row is Off).
 * - `wait`: not yet (the card is not ready, or a guard holds). Ask again on the next change.
 * - `toast`: the window is on screen: the toast asks.
 * - `now`: restart now.
 * - `songStart`: restart when the next song starts (music plays).
 */
export type QuietAction = "none" | "wait" | "toast" | "now" | "songStart";

export function quietAction(s: QuietState): QuietAction {
  if (s.mode === "off" || s.graphics !== "software") return "none";
  if (s.card !== "ready") return "wait";
  if (s.window === "shown") return "toast";
  if (s.tried || s.busy) return "wait";
  return s.playing ? "songStart" : "now";
}

/** The toast for a PC with no working card (§10.6): only when the app STARTED in software (a
 *  card that goes away mid-session is a driver install, still settling), once per install. */
export const tellNoCard = (s: { mode: QuietState["mode"]; startedSoftware: boolean; card: Card; toldBefore: boolean }): boolean =>
  s.mode !== "off" && s.startedSoftware && s.card === "none" && !s.toldBefore;
