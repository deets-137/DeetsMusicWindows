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
import { invoke } from "@tauri-apps/api/core";
import { toast } from "./toast";
import { getCurrent } from "./queue";
import { trackById, tracks } from "./track-store";
import { isLoved, setLoved } from "./favorites";
import { applePlaylistAdd, onPlaylistsChange, playlistInsertTracks, playlistsCached } from "./playlists";
import { requestDiaryAlbum } from "./layout-bus";
import type { Playlist } from "./search";
import type { Track } from "./library";

const trackNow = (): Track | undefined => {
  const c = getCurrent();
  return c ? trackById(c.catalogId) ?? trackById(c.libraryId) : undefined;
};

// The playlists a rule may add to, kept in step with the store (an action reads it at once).
let playlists: Playlist[] = [];
const pidOf = (p: Playlist) => p.libraryId ?? p.catalogId ?? p.name;
const refreshPlaylists = () => void playlistsCached().then((l) => (playlists = l)).catch(() => {});
const playlistOf = (id: unknown) => playlists.find((p) => pidOf(p) === id);

/** The keys a When row's "set" may write (your value, as a press would). */
const SETTABLE = new Set(["theme", "skin", "soundEqPreset"]);

export function initRulesApp(): void {
  // `replay.weekly` is emitted by replay.ts 8 s after launch; registered here so a rule on it is
  // not "unknown" until then (found at the desk 2026-09-27).
  for (const e of ["app.open", "surface.change", "tray.hide", "tray.show", "card.open", "replay.weekly"] as const) registerEvent(e, { facts: [] });
  // Route 8 (RULEZ.md §10.1). `queue.summon` is layout.ts's cancel event; Go to is go-to.ts's
  // question, whose answer is the rule's `openIn` (the site acts, as a cancel site reads Keep).
  for (const e of ["queue.summon", "goto.artist", "goto.album"] as const) registerEvent(e, { facts: [] });
  registerAction("openIn", { cost: "free", run: () => undefined });

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

  // Route 6 (RULEZ.md §3): what the app already does. ♥ and an Apple Music playlist are Apple
  // writes, under the engine's cap (RULEZ.md §4: a number of calls per 30 s).
  registerAction("note", { cost: "free", run: (text) => toast({ kind: "info", text: String(text).slice(0, 200) }) });
  refreshPlaylists();
  onPlaylistsChange(refreshPlaylists);
  registerAction("addTo", {
    cost: "free",
    appleIf: (id) => playlistOf(id)?.source === "apple",
    exists: (id) => !!playlistOf(id),
    run: async (id) => {
      const p = playlistOf(id);
      const t = trackNow();
      if (!p || !t) return;
      if (p.source === "apple") await applePlaylistAdd(p, [t]);
      else await playlistInsertTracks(p, null, [t]);
    },
  });
  registerAction("love", {
    cost: "apple",
    exists: () => !!trackNow()?.catalogId,
    run: async () => {
      const t = trackNow();
      if (t && !isLoved(t)) await setLoved(t, true);
    },
  });
  registerAction("diary", {
    cost: "free",
    run: () => {
      const t = trackNow();
      if (!t?.albumName) return;
      const album = { title: t.albumName, artistName: t.artistName, artwork: t.artwork, releaseDate: t.releaseDate };
      requestDiaryAlbum({ album, tracks: () => tracks().filter((x) => x.albumName === t.albumName && x.artistName === t.artistName) });
    },
  });
  registerAction("scrobble", { cost: "free", run: (on) => invoke("settings_set_lastfm_scrobble", { on: on === true }) });
  registerAction("hide", { cost: "free", run: () => getCurrentWindow().hide() });
  // The cancel events' sites register their own event (player.ts, card-grow.ts, replay.ts).

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

/** main.ts, once the cards are placed: the app opened. Not for a start in the tray (`--tray`, the
 *  window hidden at boot): FUTURE-SETTINGS §22 says a tray launch never plays, so *Play on
 *  launch* must not run there, and a later show from the tray is *You bring the app back*. */
export function emitAppOpen(): void {
  void getCurrentWindow()
    .isVisible()
    .catch(() => true)
    .then((shown) => {
      if (!shown) return diag.log("rule", { event: "app.open", applied: false, reason: "skipped (tray)" });
      emit("app.open", { card: "*" });
    });
}
