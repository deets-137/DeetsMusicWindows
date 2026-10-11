// The full player's gate for its test version (ideas/fullscreen-player.md §12.9, his call
// 2026-10-11): a DevTools flag, like Adaptive sound (SOUND.md §11a). Off for everyone; he turns
// it on with `localStorage["deets.dev.fullPlayer"] = "on"`, then a reload. While it is off there
// are no Now Playing zones, no Compass verb and no Rulez words. Read once: the flag needs the
// reload. Its own file, with no imports, so the pure Rulez words can read it too.

const ON = (() => {
  try {
    return localStorage.getItem("deets.dev.fullPlayer") === "on";
  } catch {
    return false;
  }
})();

/** The full player is unhidden (the DevTools flag). */
export const fullPlayerUnhidden = (): boolean => ON;
