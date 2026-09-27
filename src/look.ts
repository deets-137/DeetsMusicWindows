// The look on screen: the theme and the skin (RULES.md §7a). Your pick is the store's
// `theme` / `skin`; a rule may lay another on top (the look schedule). One painter shows the
// EFFECTIVE pair: at launch at once, later inside the appearance transition. A change from
// anywhere — a menu pick, Reset, an agent, a rule starting or ending — lands here.

import { effective, onSettingsChange, setSetting } from "./settings-store";
import { paintTheme, type ThemeName } from "./theme";
import { paintSkin, type SkinName } from "./skin";
import { withAppearanceTransition } from "./appearance";
import { noteHandPick } from "./look-schedule";

type Opts = { after?: () => void; by?: "agent" };

let queued = false;
let pendingOpts: Opts = {};

// np-bus imports agent-settings (through agent-writes), and agent-settings imports this module:
// a static import here is a cycle. Lazy, as look-schedule.ts does.
const publishAppearance = (): void => void import("./np-bus").then((m) => m.publishAppearance());

/** Paint the effective pair if it differs from the screen, in one transition for both. */
function paint(): void {
  queued = false;
  const opts = pendingOpts;
  pendingOpts = {};
  const theme = effective("theme");
  const skin = effective("skin");
  const root = document.documentElement;
  const newSkin = root.dataset.skin !== skin;
  if (root.dataset.theme === theme && !newSkin) {
    opts.after?.();
    return;
  }
  // `after` runs inside the transition's update callback, after the paint — a publish outside
  // it would read the attributes before they flip and report the OLD look.
  withAppearanceTransition(newSkin ? "skin" : "theme", () => {
    paintTheme(theme);
    paintSkin(skin);
  }, {
    skin: newSkin ? skin : undefined,
    by: opts.by,
    after: () => {
      opts.after?.();
      publishAppearance(); // tray panel + extension popup follow (they snap)
    },
  });
}

/** Paint on the next microtask, so a theme and a skin that change together animate once. */
function schedule(opts?: Opts): void {
  if (opts) pendingOpts = opts;
  if (queued) return;
  queued = true;
  queueMicrotask(paint);
}

/**
 * A theme or skin picked by hand (the title menu, Reset, an agent): it becomes your value.
 * `after` runs once the new look is on screen (or at once when nothing changes).
 */
export function pickLook(look: { theme?: ThemeName; skin?: SkinName }, opts: Opts = {}): void {
  // The half you did not pick stays as it shows. Under the look schedule the two are one look,
  // and your change holds both (RULES.md §8), so a theme pick must not bring back an older skin.
  const theme = look.theme ?? effective("theme");
  const skin = look.skin ?? effective("skin");
  noteHandPick(); // *For good* keeps this pick when it turns the schedule off (look-schedule.ts)
  schedule(opts);
  setSetting("theme", theme);
  setSetting("skin", skin);
}

/** Launch: paint the look at once (no animation), then follow every change. */
export function initLook(): void {
  paintTheme(effective("theme"));
  paintSkin(effective("skin"));
  onSettingsChange((k) => {
    if (k === "theme" || k === "skin") schedule();
  });
}
