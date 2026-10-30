// The grand opening (docs/features/GRAND-OPENING.md) — one large card over every other card
// on the app's first launch. The owner designs what it holds, piece by piece.
//
// The frame (the nav bar, the glide, the page slide, the foot button, the ×) is paged-card.ts,
// shared with the update card (docs/features/UPDATE-CARD.md §3.8). This file is its pages: 1–5
// from the top (the welcome §5, the layout §7, Fashion §8, the nitpicks, the letter), Settings
// at the foot (§2–§4).
//
// It opens on a brand-new install (the saved `openingPending`, settings-store.ts, so a launch
// that quits during it opens it again; the web demo starts it false), after the launch cover,
// and the first-run walk (walk.ts) waits for it to close: the sprites point at controls this
// card would hide. Closing it clears `openingPending`. `__onboarding.open()` and
// the Compass's Onboarding row open it at any time.

import { setting, setSetting } from "./settings-store";
import { markUsageTold } from "./usage";
import * as diag from "./diag";
import { settingsCard } from "./settings-card";
import { mountWelcome } from "./onboarding-welcome";
import { mountLooks } from "./onboarding-looks";
import { mountFashion } from "./onboarding-fashion";
import { mountNitpicks } from "./onboarding-nitpicks";
import { mountLetter } from "./onboarding-letter";
import { revealApp } from "./boot-cover";
import { openPagedCard, type PagedHandle, type PagedPage } from "./paged-card";

declare global {
  interface Window {
    __onboarding?: { open: () => Promise<void>; close: () => void };
  }
}

/** The title bar's cog (index.html `#cog-open`), so the nav button reads as the same thing. */
export const ICON_COG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.41 2.96A9.4 9.4 0 0 1 14.59 2.96L14.75 6.11A6.5 6.5 0 0 1 15.73 6.68L18.53 5.24A9.4 9.4 0 0 1 21.12 9.73L18.48 11.43A6.5 6.5 0 0 1 18.48 12.57L21.12 14.27A9.4 9.4 0 0 1 18.53 18.76L15.73 17.32A6.5 6.5 0 0 1 14.75 17.89L14.59 21.04A9.4 9.4 0 0 1 9.41 21.04L9.25 17.89A6.5 6.5 0 0 1 8.27 17.32L5.47 18.76A9.4 9.4 0 0 1 2.88 14.27L5.52 12.57A6.5 6.5 0 0 1 5.52 11.43L2.88 9.73A9.4 9.4 0 0 1 5.47 5.24L8.27 6.68A6.5 6.5 0 0 1 9.25 6.11L9.41 2.96Z"/><circle cx="12" cy="12" r="3"/></svg>';

/** A number on a nav button, until the owner draws the page's icon. */
export const navNumber = (n: string): string => `<span class="onboarding__navnum" aria-hidden="true">${n}</span>`;

/** Settings at the bar's foot: the whole Settings card, as it is in a slot. */
export const settingsPage = (): PagedPage => ({
  id: "settings", face: ICON_COG, label: "Settings", hint: "Shows all of Settings", foot: true,
  mount: (el) => settingsCard.mount(el),
});

/** The foot button (his call, 2026-10-22): *Next* on pages 1 to 4, *Let's Boogie* on page 5 (the
 *  end: the app comes in as at launch; pages 4 and 5 added 2026-10-23), none on Settings. */
const NEXT = { label: "Next", hint: "Shows the next page" };
const PAGES: PagedPage[] = [
  { id: "one", face: navNumber("1"), label: "Page 1", hint: "Shows page 1", forward: NEXT, mount: mountWelcome },
  { id: "two", face: navNumber("2"), label: "Page 2", hint: "Shows page 2", forward: NEXT, mount: mountLooks },
  { id: "three", face: navNumber("3"), label: "Page 3", hint: "Shows page 3", forward: NEXT, mount: mountFashion },
  { id: "four", face: navNumber("4"), label: "Page 4", hint: "Shows page 4", forward: NEXT, mount: mountNitpicks },
  { id: "five", face: navNumber("5"), label: "Page 5", hint: "Shows page 5", forward: { label: "Let's Boogie", hint: "Closes this page and opens DeetsMusic", end: true }, mount: mountLetter },
  settingsPage(),
];

let handle: PagedHandle | null = null;

/** A sign-in made on page 1 readies the cards behind the page while the user reads on (his ask,
 *  2026-10-22). Since 2026-10-23 every sign-in does this, from here or from the title menu, so
 *  this only logs it: the library sync (track-store.ts `signInSync`), the playlists mirror
 *  (playlists-card.ts) and Radio (radio-card.ts) each answer `deets:signed-in` themselves. */
function warmUp(): void {
  diag.log("onboarding:warm");
}

/** *Let's Boogie*: the card leaves under the launch's own cover and the app rises as it does at
 *  a launch (boot-cover.ts `revealApp`). */
let ending = false;
function boogie(): void {
  if (ending || !handle) return;
  ending = true;
  diag.log("onboarding:boogie");
  void revealApp(() => closeOnboarding()).finally(() => (ending = false));
}

/** Opens the card. Resolves when the user closes it. A second call while it is open
 *  returns the same wait. */
export function openOnboarding(): Promise<void> {
  if (handle) return handle.done;
  handle = openPagedCard({
    name: "onboarding",
    ariaLabel: "Welcome to DeetsMusic",
    pages: PAGES,
    onEnd: boogie,
    onClosed,
  });
  if (!handle) return Promise.resolve();
  window.addEventListener("deets:signed-in", warmUp);
  return handle.done;
}

export function closeOnboarding(): void {
  handle?.close();
}

function onClosed(): void {
  handle = null;
  window.removeEventListener("deets:signed-in", warmUp);
  if (setting("openingPending")) setSetting("openingPending", false, "app");
  // A new install's usage counts may start once the opening closes, page 4 seen or not (his call
  // 2026-10-23: the switch is on, for a pulse on how many people use the app).
  markUsageTold("grand opening closed");
}

/** The launch: opens the card on a brand-new install, then resolves when it closes.
 *  Resolves at once on every other launch. */
export function initOnboarding(): Promise<void> {
  window.__onboarding = { open: openOnboarding, close: closeOnboarding };
  return setting("openingPending") ? openOnboarding() : Promise.resolve();
}
