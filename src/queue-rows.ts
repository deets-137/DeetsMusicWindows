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

export function artURL(t: Track | undefined, px: number): string | null {
  if (!t?.artwork?.urlTemplate) return null;
  const s = String(px);
  return t.artwork.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}

/** One .qrow list item. `interactive` adds button semantics (Qcard rows jump on click);
 *  read-only lists (History) omit them so Tab/Enter don't promise an action they lack. */
export function rowHTML(
  idx: number,
  title: string,
  artist: string,
  cover: string | null,
  interactive = true,
): string {
  const art = cover
    ? `<img class="qrow__art" src="${esc(cover)}" alt="" loading="lazy" />`
    : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
  const role = interactive ? ` role="button" tabindex="0"` : "";
  return `<li class="qrow" data-idx="${idx}"${role}>${art}<div class="qrow__text"><span class="qrow__title">${esc(
    title,
  )}</span><span class="qrow__artist">${esc(artist)}</span></div></li>`;
}
