// The rooms port's start (docs/features/WebRooms.md §9.3 B): what the four cards need from the app's
// main.ts, and no more. No surfaces, no card slots or picker, no Compass, no Settings card. The
// look, the hint box and the skin layers start as in the app, so each card is the app's 1:1. The
// cards mount straight into the page's slots: Now Playing and the Queue in the stage column,
// Search and History beside it (vite.listen.config.ts makes the page Max with two cards).
//
// Apple: MusicKit's own `authorize()` signs the listener in (§9.3 D). The "Sign in" in the Room
// panel and in the signed-out toast both fire `deets:sign-in` (apple.ts `requestSignIn`).

import { initRules } from "../src/rules";
import { initLook } from "../src/look";
import { initSkinSettings } from "../src/skin-settings";
import { initStorm } from "../src/storm";
import { initOcean } from "../src/ocean";
import { initAmbient } from "../src/ambient";
import { initWallpaper } from "../src/wallpaper";
import { initArtworkHeal } from "../src/artwork-heal";
import { initBrowserDefaults } from "../src/browser-defaults";
import { initHints } from "../src/hint";
import { initTrackStore } from "../src/track-store";
import { initPlayer } from "../src/player";
import { initRoomPanel, openRoomPanel, refreshWebSignIn } from "../src/room-panel";
import { resumeWebHost } from "../src/room";
import { nowPlayingCard } from "../src/now-playing-card";
import { queueCard } from "../src/qcard";
import { searchCard } from "../src/search-card";
import { historyCard } from "../src/history-card";
import type { CardDef } from "../src/cards";
import * as health from "../src/apple-health";
import { toast } from "../src/toast";
import * as diag from "../src/diag";

/** One part that fails must not stop the rest (main.ts's startup guard, in small). */
function part(name: string, fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e) => console.error(`[listen] ${name} failed`, e));
  } catch (e) {
    console.error(`[listen] ${name} failed`, e);
  }
}

part("rules", initRules); // the look registers into it, as in the app
part("look", initLook);
part("skinSettings", initSkinSettings);
part("storm", initStorm);
part("ocean", initOcean);
part("ambient", initAmbient);
part("wallpaper", initWallpaper);
part("artworkHeal", initArtworkHeal);
part("browserDefaults", initBrowserDefaults);
part("hints", initHints);
part("trackStore", initTrackStore);
part("roomPanel", initRoomPanel);

const slots: [string, CardDef][] = [
  ["np", nowPlayingCard],
  ["queue", queueCard],
  ["left", searchCard],
  ["right", historyCard],
];
for (const [slot, def] of slots) {
  const host = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (host) part(`card ${def.id}`, () => def.mount(host));
}

/** Sign in with Apple's own window. MusicKit keeps the token; the panel and the player read it. */
async function signIn(): Promise<void> {
  try {
    const music = await initPlayer();
    await music.authorize();
    diag.log("listen:signedIn", { authorized: !!music.isAuthorized });
  } catch (e) {
    console.warn("[listen] sign-in", e);
    toast({ kind: "warn", text: "Apple Music sign-in did not finish. Try again." });
  } finally {
    await refreshWebSignIn();
    void health.check(false, true, "signIn").catch(() => {});
  }
}
window.addEventListener("deets:sign-in", () => void signIn());

// MusicKit keeps a sign-in from an earlier visit; configuring it now reads that back.
part("player", () =>
  initPlayer()
    .catch((e) => console.warn("[listen] MusicKit", e))
    .finally(() => void refreshWebSignIn()),
);

// A reload of a room this tab hosts goes straight back in (WebRooms.md §3 rule 8). A link with
// `?code=` opens the panel with the code in its field; the listener presses Join.
if (!resumeWebHost()) {
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    openRoomPanel();
    const field = document.querySelector<HTMLInputElement>(".room__field--code");
    if (field) field.value = code;
  }
}
