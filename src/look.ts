// The look on screen: the theme and the skin (RULES.md §7a). Your pick is the store's
// `theme` / `skin`; a rule may lay another on top (the look schedule). One painter shows the
// EFFECTIVE pair: at launch at once, later inside the appearance transition. A change from
// anywhere — a menu pick, Reset, an agent, a rule starting or ending — lands here.

import { effective, onSettingsChange, setSetting } from "./settings-store";
import { paintTheme, type ThemeName } from "./theme";
import { paintSkin, type SkinName } from "./skin";
import { withAppearanceTransition, withThemeFade } from "./appearance";
import { noteHandPick } from "./look-schedule";

// `close`: the panel that made the pick. Before a theme fade it closes first, so it leaves on its
// own exit and is not in the old picture (UX-COVERUPS.md §6c.2); under a cover it closes with
// `after`. `hand` is set by `pickLook` for a pick with no `by`.
type Opts = { after?: () => void; close?: () => void; by?: "agent" | "rule"; hand?: boolean };

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
    opts.close?.();
    opts.after?.();
    return;
  }
  // `after` runs inside the transition's update callback, after the paint — a publish outside
  // it would read the attributes before they flip and report the OLD look.
  const after = () => {
    opts.after?.();
    publishAppearance(); // tray panel + extension popup follow (they snap)
  };
  // A theme-only change — a rule's (Live Theming: every song) or your own pick — changes the
  // colors in place. The cover stays for any skin change and for an agent, so a change you did
  // not make stays easy to see (UX-COVERUPS.md §6c; hand picks joined 2026-09-28, his call).
  if (!newSkin && opts.by !== "agent") {
    withThemeFade(() => paintTheme(theme), after, { hand: opts.hand, close: opts.close });
    return;
  }
  withAppearanceTransition(newSkin ? "skin" : "theme", () => {
    paintTheme(theme);
    paintSkin(skin);
  }, {
    skin: newSkin ? skin : undefined,
    by: opts.by === "agent" ? "agent" : undefined,
    after: () => {
      opts.close?.(); // under the opaque cover, so the rise never shows it half-closed
      after();
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
  schedule({ ...opts, hand: !opts.by });
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
