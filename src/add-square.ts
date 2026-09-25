// The Add-to-Library square on a song row (SEARCH.md § Add-to-Library square). One primitive
// for every card that shows it: Search (songs grid + drill panes), Playlists (a playlist's
// songs, Lines view), Queue (Up Next + the now hero), History (rows + the latest-play hero).
//
// A press IS the consent, like the Now Playing "+" (addTrackToLibrary). The Library Add
// setting is the only thing that removes the square. States: "+" (not in the library) · the
// "+" turning while the add runs · "✓ In your library" only with Settings › Apple Music ›
// "Show ✓ on songs you have" on (`addSquareOwned`); off, a song you have shows no square.
//
// The state is written into the HTML when the row is drawn. A windowed list (Playlists)
// draws rows while it scrolls, and the Queue card redraws its whole body on every queue
// change, so a paint pass after a render would miss rows or drop the spinner. A change
// that no redraw follows (the store reload after an add, the setting) repaints every
// square on the page. Membership comes from the local store: drawing costs no Apple call.
//
// Cards place the HTML and keep a drag from starting on it (`isAddSquare` in `rowAt`). The
// click is heard once, here, in the capture phase on the document: it runs before any
// card's row handler (play, jump, pick) and stops the press from reaching it.

import type { Track } from "./library";
import { addTrackToLibrary, libraryAddEnabled, alreadyInLibrary, onLibraryAddChange } from "./library-add";
import { onTracksChange } from "./track-store";
import { setting, onSettingsChange } from "./settings-store";
import { esc } from "./dom";

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';

const addable = new Map<string, Track>(); // catalogId → the row's track
const adding = new Set<string>();

type State = "none" | "add" | "busy" | "in";
// `mark`: a list whose point is which songs you have (the Library's Full view, FULL-LIB.md)
// shows the ✓ whatever "Show ✓ on songs you have" says, and shows it at rest (CSS).
function stateOf(t: Track | undefined, mark = false): State {
  if (!t?.catalogId) return "none";
  if (mark && alreadyInLibrary(t)) return "in";
  if (!libraryAddEnabled()) return "none";
  if (adding.has(t.catalogId)) return "busy";
  if (!alreadyInLibrary(t)) return "add";
  return setting("addSquareOwned") ? "in" : "none";
}

const LABEL: Record<State, string> = { none: "", add: "Add to Library", busy: "Add to Library", in: "In your library" };

/** The square for a song row. `cls` is the card's own placement class. "" when the song
 *  has no catalog id (an upload can't be added). */
export function addSquareHTML(t: Track | undefined, cls = "", mark = false): string {
  if (!t?.catalogId) return "";
  ensureWired();
  addable.set(t.catalogId, t);
  const s = stateOf(t, mark);
  const label = LABEL[s];
  const state = s === "busy" ? " is-busy" : s === "in" ? " is-in" : "";
  return (
    `<button class="panel__action add-square${cls ? ` ${cls}` : ""}${mark ? " add-square--mark" : ""}${state}" type="button" data-add="${esc(t.catalogId)}"` +
    (s === "none" ? " hidden" : ` aria-label="${label}" title="${label}" aria-disabled="${s !== "add"}"`) +
    `>${s === "in" ? ICON_CHECK : s === "none" ? "" : ICON_PLUS}</button>`
  );
}

/** A press on the square: a card's `rowAt` returns null for it, so no drag starts there. */
export const isAddSquare = (target: HTMLElement): boolean => !!target.closest("[data-add]");

function paint(btn: HTMLButtonElement): void {
  const s = stateOf(addable.get(btn.dataset.add!), btn.classList.contains("add-square--mark"));
  btn.hidden = s === "none";
  btn.classList.toggle("is-busy", s === "busy");
  btn.classList.toggle("is-in", s === "in");
  if (s === "none") return;
  btn.setAttribute("aria-disabled", String(s !== "add"));
  btn.innerHTML = s === "in" ? ICON_CHECK : ICON_PLUS;
  btn.setAttribute("aria-label", LABEL[s]);
  btn.title = LABEL[s];
}
const repaintAll = () => document.querySelectorAll<HTMLButtonElement>("button[data-add]").forEach(paint);

let wired = false;
function ensureWired(): void {
  if (wired) return;
  wired = true;
  document.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-add]");
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.add!;
      const t = addable.get(id);
      if (!t || stateOf(t, btn.classList.contains("add-square--mark")) !== "add") return;
      adding.add(id);
      repaintAll(); // the same song can show in two cards at once
      addTrackToLibrary(t)
        .catch((err) => console.error("[add-square] add to library", err))
        .finally(() => {
          adding.delete(id);
          repaintAll();
        });
    },
    true,
  );
  // App-lifetime subscriptions: the squares live in several cards, and the page outlives them.
  onTracksChange(repaintAll, "add-square");
  onLibraryAddChange(repaintAll);
  onSettingsChange((k) => {
    if (k === "addSquareOwned") repaintAll();
  });
}
