// Queue card (Qcard) — a small custom renderer that mirrors the queue model. It
// temporarily occupies the Playlists panel slot (title swapped to "Queue"). Up Next rows
// support left-click/Enter to jump, and a right-click menu (Play Now / Move to Top / Move
// to Bottom / Remove) — the queue-edit ops live in player.ts (gapless; see docs/QUEUE.md).

import "./styles/qcard.css";
import * as queue from "./queue";
import { onPlayerState, jumpToUpcoming, moveInQueue, removeFromQueue, type PlayerState } from "./player";
import { type Track } from "./library";
import { trackById, onTracksChange } from "./track-store";
import { esc } from "./collection-card";
import { openContextMenu } from "./context-menu";

const UP_NEXT_CAP = 50; // render a bounded slice; virtualize if queues get huge

let lastState: PlayerState | null = null;

function resolve(e: queue.QueueEntry): Track | undefined {
  return trackById(e.catalogId) ?? trackById(e.libraryId);
}

function artURL(t: Track | undefined, px: number): string | null {
  if (!t?.artwork?.urlTemplate) return null;
  const s = String(px);
  return t.artwork.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}

function rowHTML(idx: number, title: string, artist: string, cover: string | null): string {
  const art = cover
    ? `<img class="qrow__art" src="${esc(cover)}" alt="" loading="lazy" />`
    : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
  return `<li class="qrow" data-idx="${idx}" role="button" tabindex="0">${art}<div class="qrow__text"><span class="qrow__title">${esc(
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

    // Now Playing. While a jump is buffering, optimistically show the model's new
    // current (instant feedback); otherwise prefer MusicKit's live metadata. This is
    // the interim cover-up for the buffer gap (see docs/UX-COVERUPS.md).
    const curTrack = current ? resolve(current) : undefined;
    const loading = !!lastState?.loading;
    const npTitle = (loading ? curTrack?.title : lastState?.title ?? curTrack?.title) ?? "Nothing playing";
    const npArtist = (loading ? curTrack?.artistName : lastState?.artist ?? curTrack?.artistName) ?? "";
    const npCover = loading ? artURL(curTrack, 96) : lastState?.artworkUrl ?? artURL(curTrack, 96);
    const npArt = npCover
      ? `<img class="qnow__art" src="${esc(npCover)}" alt="" />`
      : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;

    const shown = upcoming.slice(0, UP_NEXT_CAP);
    const rows = shown
      .map((e, i) => {
        const t = resolve(e);
        return rowHTML(i, t?.title ?? "Unknown", t?.artistName ?? "", artURL(t, 72));
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
      <div class="qnow${current ? "" : " qnow--idle"}${loading ? " qnow--loading" : ""}">
        ${npArt}
        <div class="qnow__text">
          <span class="qnow__title">${esc(npTitle)}</span>
          <span class="qnow__artist">${esc(npArtist)}</span>
        </div>
      </div>
      <div class="qcard__label">Up Next</div>
      ${list}`;
  };

  // Click (or Enter/Space) an Up Next row → jump to it. Delegated on the persistent
  // body so it survives re-renders. The jump re-windows and buffers (cover-up above).
  const jumpFromEvent = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>(".qrow[data-idx]");
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (!Number.isNaN(idx)) jumpToUpcoming(idx).catch((err) => console.error("[qcard] jump", err));
  };
  body.addEventListener("click", (e) => jumpFromEvent(e.target));
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jumpFromEvent(e.target);
    }
  });

  // Right-click an Up Next row → queue actions. We capture the ENTRY (not the index):
  // playback may advance while the menu is open, shifting indices, so each action
  // re-resolves the entry's *live* index at run time (no-op if it's since been consumed).
  body.addEventListener("contextmenu", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".qrow[data-idx]");
    if (!row) return;
    const entry = queue.getUpcoming()[Number(row.dataset.idx)];
    if (!entry) return;
    e.preventDefault();
    row.classList.add("is-context");
    const act = (fn: (i: number) => Promise<void>, label: string) => () => {
      const i = queue.getUpcoming().indexOf(entry);
      if (i >= 0) void fn(i).catch((err) => console.error(`[qcard] ${label}`, err));
    };
    openContextMenu(
      e.clientX,
      e.clientY,
      [
        { label: "Play Now", run: act(jumpToUpcoming, "play now") },
        { label: "Move to Top", run: act((i) => moveInQueue(i, "top"), "move top") },
        { label: "Move to Bottom", run: act((i) => moveInQueue(i, "bottom"), "move bottom") },
        { label: "Remove", run: act(removeFromQueue, "remove") },
      ],
      () => row.classList.remove("is-context"),
    );
  });

  // Metadata comes from the shared track store; re-render when it (re)loads so newly
  // synced songs resolve instead of showing "Unknown".
  onTracksChange(render);
  queue.onQueueChange(render);
  onPlayerState((s) => {
    lastState = s;
    render();
  });
  render();
}
