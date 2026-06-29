// Queue card (Qcard) — a small custom renderer that mirrors the queue model. It
// temporarily occupies the Playlists panel slot (title swapped to "Queue"). Display
// only for now: it proves the model follows MusicKit live (Now Playing + Up Next
// update as playback advances/skips). Interactions (jump, reorder, remove) come later.

import "./styles/qcard.css";
import * as queue from "./queue";
import { onPlayerState, type PlayerState } from "./player";
import { libraryTracks, type Track } from "./library";
import { esc } from "./collection-card";

const UP_NEXT_CAP = 50; // render a bounded slice; virtualize if queues get huge

let byId = new Map<string, Track>(); // id (catalog or library) → Track, for display
let lastState: PlayerState | null = null;

function indexTracks(tracks: Track[]): Map<string, Track> {
  const m = new Map<string, Track>();
  for (const t of tracks) {
    if (t.libraryId) m.set(t.libraryId, t);
    if (t.catalogId) m.set(t.catalogId, t);
  }
  return m;
}

function resolve(e: queue.QueueEntry): Track | undefined {
  return (e.catalogId ? byId.get(e.catalogId) : undefined) ?? (e.libraryId ? byId.get(e.libraryId) : undefined);
}

function artURL(t: Track | undefined, px: number): string | null {
  if (!t?.artwork?.urlTemplate) return null;
  const s = String(px);
  return t.artwork.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}

function rowHTML(title: string, artist: string, cover: string | null): string {
  const art = cover
    ? `<img class="qrow__art" src="${esc(cover)}" alt="" loading="lazy" />`
    : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
  return `<li class="qrow">${art}<div class="qrow__text"><span class="qrow__title">${esc(
    title,
  )}</span><span class="qrow__artist">${esc(artist)}</span></div></li>`;
}

export function initQcard(): void {
  const panel = document.querySelector<HTMLElement>('[data-card="playlists"]');
  if (!panel) return;
  const titleEl = panel.querySelector<HTMLElement>(".panel__title");
  if (titleEl) titleEl.textContent = "Queue";
  const body = panel.querySelector<HTMLElement>(".panel__body");
  if (!body) return;
  body.classList.add("qcard");

  const render = () => {
    const current = queue.getCurrent();
    const upcoming = queue.getUpcoming();

    // Now Playing: prefer MusicKit's live metadata, fall back to the resolved handle.
    const curTrack = current ? resolve(current) : undefined;
    const npTitle = lastState?.title ?? curTrack?.title ?? "Nothing playing";
    const npArtist = lastState?.artist ?? curTrack?.artistName ?? "";
    const npCover = lastState?.artworkUrl ?? artURL(curTrack, 96);
    const npArt = npCover
      ? `<img class="qnow__art" src="${esc(npCover)}" alt="" />`
      : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;

    const shown = upcoming.slice(0, UP_NEXT_CAP);
    const rows = shown
      .map((e) => {
        const t = resolve(e);
        return rowHTML(t?.title ?? "Unknown", t?.artistName ?? "", artURL(t, 72));
      })
      .join("");
    const more =
      upcoming.length > UP_NEXT_CAP
        ? `<li class="qcard__more">+${upcoming.length - UP_NEXT_CAP} more</li>`
        : "";
    const list = rows
      ? `<ol class="qcard__list">${rows}${more}</ol>`
      : `<p class="qcard__empty">Nothing queued.</p>`;

    body.innerHTML = `
      <div class="qnow${current ? "" : " qnow--idle"}">
        ${npArt}
        <div class="qnow__text">
          <span class="qnow__title">${esc(npTitle)}</span>
          <span class="qnow__artist">${esc(npArtist)}</span>
        </div>
      </div>
      <div class="qcard__label">Up Next</div>
      ${list}`;
  };

  // Build the id→Track lookup from cache (display only; refreshed on demand later).
  libraryTracks(0, 100000)
    .then((page) => {
      byId = indexTracks(page.items);
      render();
    })
    .catch((e) => console.error("[qcard] track lookup load", e));

  queue.onQueueChange(render);
  onPlayerState((s) => {
    lastState = s;
    render();
  });
  render();
}
