// Shared rendering helpers for queue-shaped cards (Qcard, History) — one home for
// the entry→Track resolution and the .qrow / art markup so the two cards can't
// drift apart visually. Styles live in styles/qcard.css (each card imports it).

import type { QueueEntry } from "./queue";
import { type Track } from "./library";
import { trackById } from "./track-store";
import { esc } from "./collection-card";

/** Resolve a queue entry to its display Track via the shared store (catalog id first). */
export function resolveEntry(e: QueueEntry): Track | undefined {
  return trackById(e.catalogId) ?? trackById(e.libraryId);
}

/** The pixel size the Now Playing cover asks Apple for (docs/cards/STAGE-COLUMN.md §6). The stage
 *  cover is the card's content width, 316 CSS px — 474 device px at Windows' usual 150% scale,
 *  632 at 200%. Apple serves the same picture at any size we put in the template, so this
 *  costs a bigger download on a dense screen and no extra API call. */
export const stageArtPx = (): number => (window.devicePixelRatio > 1.5 ? 640 : 480);

// The full player (features/fullscreen-player.md §12.5) asks for a larger file while it is open:
// full-player.ts sets the size, 0 = the rest size. Kept here, not there, so the size has one
// source and nothing that reads it imports the player's DOM module.
let fullPx = 0;
export const setFullArtPx = (px: number): void => {
  fullPx = px;
};
/** The size the Now Playing cover asks for now: the full player's while it is open, else the
 *  rest size. The card, player.ts and the next-song prefetch all read this one. */
export const coverArtPx = (): number => fullPx || stageArtPx();

export function artURL(t: Track | undefined, px: number): string | null {
  if (!t?.artwork?.urlTemplate) return null;
  const s = String(px);
  return t.artwork.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}

/** One .qrow list item. `interactive` adds button semantics (Qcard rows jump on click);
 *  read-only lists (History) omit them so Tab/Enter don't promise an action they lack.
 *  `meta` is the right-hand column (History: the clock time, and the skip mark). `add` is
 *  the Add-to-Library square (add-square.ts), last, at the row's right end. */
export function rowHTML(
  idx: number,
  title: string,
  artist: string,
  cover: string | null,
  interactive = true,
  meta = "",
  add = "",
  cid = "",
  /** Suggest Less steps over this row (SUGGEST-LESS.md §6): greyed, with its own hint. */
  less = false,
): string {
  const art = cover
    ? `<img class="qrow__art" src="${esc(cover)}" alt="" loading="lazy" data-art />`
    : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
  const role = interactive ? ` role="button" tabindex="0"` : "";
  // data-cid: the hover hint reads the song's writers off it (CREDITS.md §7, hint.ts).
  const id = cid ? ` data-cid="${esc(cid)}"` : "";
  const lessAttr = less ? ` title="Suggest Less — skipped. Click to play it anyway"` : "";
  return `<li class="qrow${less ? " is-less" : ""}" data-idx="${idx}"${role}${id}${lessAttr}>${art}<div class="qrow__text"><span class="qrow__title">${esc(
    title,
  )}</span><span class="qrow__artist">${esc(artist)}</span></div>${meta}${add}</li>`;
}
