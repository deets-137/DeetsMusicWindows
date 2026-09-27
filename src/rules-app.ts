// Rulez's window words and the actions that write your value (docs/architecture/RULES.md §20.3,
// §20.4): the app opens, the surface changes, the app goes to the tray and comes back; and a
// When row's "Use theme", "Use skin", "Use EQ preset", "Pause sharing", "Start the sleep timer".
// *You open a card* is emitted by layout.ts, and the grown card's cancel event by card-grow.ts.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { emit, registerAction, registerEvent } from "./rules";
import { onSurfaceChange } from "./surface";
import { pickLook } from "./look";
import { selectPreset } from "./sound";
import { setSetting } from "./settings-store";
import { sleepIn } from "./sleep";
import type { ThemeName, SkinName } from "./look-ids";
import * as diag from "./diag";

/** The keys a When row's "set" may write (your value, as a press would). */
const SETTABLE = new Set(["theme", "skin", "soundEqPreset"]);

export function initRulesApp(): void {
  for (const e of ["app.open", "surface.change", "tray.hide", "tray.show", "card.open"] as const) registerEvent(e, { facts: [] });

  registerAction("set", {
    cost: "free",
    run: (arg) => {
      const { key, value } = arg as { key: string; value: unknown };
      if (!SETTABLE.has(key)) return diag.warn("rule:set", { key, refused: true });
      if (key === "theme") pickLook({ theme: value as ThemeName });
      else if (key === "skin") pickLook({ skin: value as SkinName });
      else selectPreset(String(value));
    },
  });
  registerAction("sharePause", { cost: "free", run: (min) => setSetting("sharePauseUntil", Date.now() + Math.max(1, Number(min) || 60) * 60_000) });
  registerAction("sleepIn", { cost: "free", run: (min) => sleepIn(Math.max(1, Number(min) || 30)) });

  onSurfaceChange(() => emit("surface.change", { card: "*" }));

  // The tray: the window hidden (Close to tray, the tray icon) and shown again. A minimize is
  // not the tray: the window stays visible to Windows.
  const win = getCurrentWindow();
  let shown = true;
  const check = async () => {
    try {
      const now = await win.isVisible();
      if (now === shown) return;
      shown = now;
      emit(now ? "tray.show" : "tray.hide", { card: "*" });
    } catch {
      /* the window is going away */
    }
  };
  void listen("main-visibility", () => void check());
  void win.onFocusChanged(() => void check());
}

/** main.ts, once the cards are placed: the app opened. */
export function emitAppOpen(): void {
  emit("app.open", { card: "*" });
}
