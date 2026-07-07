// Queue card (Qcard) — a small custom renderer that mirrors the queue model. It
// temporarily occupies the Playlists panel slot (title swapped to "Queue"). Up Next rows
// support left-click/Enter to jump, and a right-click menu (Play Now / Move to Top / Move
// to Bottom / Remove, + Start Station / Add to Library) — the queue-edit ops live in
// player.ts (gapless; see docs/QUEUE.md).

import "./styles/qcard.css";
import * as queue from "./queue";
import { onPlayerState, jumpToUpcoming, moveInQueue, removeFromQueue, reconcileUpcoming, type PlayerState } from "./player";
import { onTracksChange } from "./track-store";
import { esc } from "./collection-card";
import { resolveEntry as resolve, artURL, rowHTML } from "./queue-rows";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem } from "./library-add";
import { startStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import type { CardDef, CardInstance } from "./cards";

const UP_NEXT_CAP = 50; // render a bounded slice; virtualize if queues get huge

export const queueCard: CardDef = {
  id: "queue",
  title: "Queue",
  mount: (host) => mountQueue(host),
};

// Kept as a standalone function (not inlined into mount) so the body retains its original
// indentation — the logic is unchanged from the old initQcard, only the mount/teardown wrap.
function mountQueue(host: HTMLElement): CardInstance {
  host.innerHTML = `<header class="panel__head"><h2 class="panel__title">Queue</h2></header><div class="panel__body qcard"></div>`;
  const body = host.querySelector<HTMLElement>(".panel__body")!;
  let lastState: PlayerState | null = null;

  // Drag state lives out here so the drag handlers (below) and render() share it.
  let dragging = false;
  let pendingRender = false;
  let suppressClick = false; // a click fires after a drag's pointerup — don't let it jump

  const render = () => {
    if (dragging) {
      pendingRender = true; // a queue/track change arrived mid-drag — defer the rebuild
      return;
    }
    pendingRender = false;
    const current = queue.getCurrent();
    const upcoming = queue.getUpcoming();

    // Now Playing. While a jump is buffering, optimistically show the model's new
    // current (instant feedback); otherwise prefer MusicKit's live metadata. This is
    // the interim cover-up for the buffer gap (see docs/UX-COVERUPS.md).
    const curTrack = current ? resolve(current) : undefined;
    const loading = !!lastState?.loading;
    const npTitle = (loading ? curTrack?.title : lastState?.title ?? curTrack?.title) ?? "";
    const npArtist = (loading ? curTrack?.artistName : lastState?.artist ?? curTrack?.artistName) ?? "";
    const npCover = loading ? artURL(curTrack, 96) : lastState?.artworkUrl ?? artURL(curTrack, 96);
    const npArt = npCover
      ? `<img class="qnow__art" src="${esc(npCover)}" alt="" data-art />`
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
      : `<p class="qcard__empty">...</p>`;

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
    if (suppressClick) {
      suppressClick = false; // this click was the tail of a drag — consume it
      return;
    }
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

  // Right-click → context menu. Two targets:
  //  - an Up Next row → queue actions (+ Add to Library). We capture the ENTRY (not the
  //    index): playback may advance while the menu is open, shifting indices, so each
  //    action re-resolves the entry's *live* index at run time (no-op if consumed).
  //  - the Now Playing hero → the current song's Add to Library (its main use: saving a
  //    catalog/station song that's playing but not in the library).
  // Add to Library rides the shared gated builder (null when the toggle's off / already
  // in library / no catalog id); a hero menu with nothing to offer simply doesn't open.
  body.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>(".qrow[data-idx]");
    if (row) {
      const entry = queue.getUpcoming()[Number(row.dataset.idx)];
      if (!entry) return;
      e.preventDefault();
      row.classList.add("is-context");
      const act = (fn: (i: number) => Promise<void>, label: string) => () => {
        const i = queue.getUpcoming().indexOf(entry);
        if (i >= 0) void fn(i).catch((err) => console.error(`[qcard] ${label}`, err));
      };
      const t = resolve(entry);
      const items: MenuItem[] = [
        { label: "Play Now", run: act(jumpToUpcoming, "play now") },
        { label: "Move to Top", run: act((i) => moveInQueue(i, "top"), "move top") },
        { label: "Move to Bottom", run: act((i) => moveInQueue(i, "bottom"), "move bottom") },
        { label: "Remove", run: act(removeFromQueue, "remove") },
      ];
      // Go to Artist/Album + Start Station key off the entry's catalog id directly —
      // the resolved track (t) only supplies fallback pane titles, so they work even
      // before the store has resolved the row.
      const goA = goToArtistItem("songs", entry.catalogId, t?.artistName);
      if (goA) items.push(goA);
      const goAl = goToAlbumItem(entry.catalogId, t?.albumName);
      if (goAl) items.push(goAl);
      const start = startStationItem("songs", entry.catalogId);
      if (start) items.push(start);
      const add = t ? addSongToLibraryItem(t) : null;
      if (add) items.push(add);
      openContextMenu(e.clientX, e.clientY, items, () => row.classList.remove("is-context"));
      return;
    }

    const hero = target.closest<HTMLElement>(".qnow");
    if (!hero) return;
    const cur = queue.getCurrent();
    const t = cur ? resolve(cur) : undefined;
    const items = [
      goToArtistItem("songs", cur?.catalogId, t?.artistName),
      goToAlbumItem(cur?.catalogId, t?.albumName),
      startStationItem("songs", cur?.catalogId), // "more like what's playing"
      t ? addSongToLibraryItem(t) : null,
    ].filter(Boolean) as MenuItem[];
    if (!items.length) return; // nothing to offer for the current song
    e.preventDefault();
    hero.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => hero.classList.remove("is-context"));
  });

  // ── Drag-to-reorder (Up Next) ──────────────────────────────────────────────
  // Whole-row press-and-drag (a quick click still jumps; hold + move past the threshold
  // drags). Insertion-LINE feedback — no neighbour reflow, cheap for long queues. render()
  // is suspended mid-drag (above) so a queue/track change can't yank the row. On drop we
  // move the MODEL then `reconcileUpcoming()` (gapless MusicKit sync). Rows are uniform
  // height + flush, so the target index is pure arithmetic — no rect reads on the moving row.
  const DRAG_THRESHOLD = 6;
  type Drag = {
    entry: queue.QueueEntry; row: HTMLElement; list: HTMLElement; line: HTMLElement;
    startY: number; lastY: number; startScroll: number; fromIdx: number; toIdx: number;
    firstTop: number; rowH: number; count: number; raf: number;
  };
  let drag: Drag | null = null;
  let pending: { entry: queue.QueueEntry; row: HTMLElement; idx: number; startY: number } | null = null;

  // Pin the row under the pointer — compensate for any auto-scroll so it doesn't slide off
  // with the content (the row's slot scrolls; the pointer doesn't).
  const paintRow = () => {
    if (!drag) return;
    const ty = drag.lastY - drag.startY + (drag.list.scrollTop - drag.startScroll);
    drag.row.style.setProperty("--drag-dy", `${ty}px`);
  };

  const computeTarget = () => {
    if (!drag) return;
    const lr = drag.list.getBoundingClientRect();
    const contentY = drag.lastY - lr.top + drag.list.scrollTop;
    const ins = Math.max(0, Math.min(drag.count, Math.round((contentY - drag.firstTop) / drag.rowH)));
    drag.toIdx = ins <= drag.fromIdx ? ins : ins - 1; // queue.move() splice semantics
    // The line is an absolute child of the scrolling <ol>, so it already scrolls WITH the
    // content — position it in plain content coords (no scrollTop term, or it double-compensates).
    drag.line.style.top = `${drag.firstTop + ins * drag.rowH}px`;
  };

  const autoScroll = () => {
    if (!drag) return;
    const r = drag.list.getBoundingClientRect();
    const EDGE = 28;
    const dy = drag.lastY < r.top + EDGE ? -9 : drag.lastY > r.bottom - EDGE ? 9 : 0;
    if (dy) {
      drag.list.scrollTop += dy;
      paintRow();
      computeTarget();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const beginDrag = () => {
    if (!pending) return;
    const { entry, row, idx, startY } = pending;
    const list = row.parentElement as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".qrow"));
    const line = document.createElement("div");
    line.className = "qcard__drop-line";
    list.appendChild(line);
    dragging = true;
    row.classList.add("qrow--dragging");
    drag = {
      entry, row, list, line, startY, lastY: startY, startScroll: list.scrollTop, fromIdx: idx, toIdx: idx,
      firstTop: rows[0]?.offsetTop ?? 0, rowH: rows[0]?.offsetHeight || 1, count: rows.length, raf: 0,
    };
    computeTarget();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const endDrag = (commit: boolean) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    if (!drag) {
      pending = null;
      return; // never crossed the threshold → it was a click (let it jump)
    }
    cancelAnimationFrame(drag.raf);
    const { entry, row, line, fromIdx, toIdx } = drag;
    row.classList.remove("qrow--dragging");
    row.style.removeProperty("--drag-dy");
    line.remove();
    dragging = false;
    drag = null;
    pending = null;
    suppressClick = true; // swallow the click that trails this pointerup
    if (commit && toIdx !== fromIdx) {
      const live = queue.getUpcoming().indexOf(entry); // robust if playback advanced
      if (live >= 0) {
        queue.move(live, toIdx); // model → onQueueChange → render (now unblocked)
        reconcileUpcoming().catch((e) => console.error("[qcard] reconcile", e)); // MusicKit
        return;
      }
    }
    if (pendingRender) render(); // aborted / no-op, but a render was deferred
  };

  const onMove = (e: PointerEvent) => {
    if (drag) {
      drag.lastY = e.clientY;
      paintRow();
      computeTarget();
      e.preventDefault(); // no text selection while dragging
    } else if (pending && Math.abs(e.clientY - pending.startY) > DRAG_THRESHOLD) {
      beginDrag();
    }
  };
  const onUp = () => endDrag(true);
  const onCancel = () => endDrag(false);

  body.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (e.button !== 0) return; // left button only
    const row = (e.target as HTMLElement).closest<HTMLElement>(".qrow[data-idx]");
    if (!row) return;
    const entry = queue.getUpcoming()[Number(row.dataset.idx)];
    if (!entry) return;
    pending = { entry, row, idx: Number(row.dataset.idx), startY: e.clientY };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  });

  // Metadata comes from the shared track store; re-render when it (re)loads so newly
  // synced songs resolve instead of showing "Unknown".
  const unsubTracks = onTracksChange(render);
  const unsubQueue = queue.onQueueChange(render);
  const unsubState = onPlayerState((s) => {
    lastState = s;
    render();
  });
  render();

  return {
    destroy() {
      unsubTracks();
      unsubQueue();
      unsubState();
      // If destroyed mid-drag, the global drag listeners would outlive the card.
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      host.innerHTML = "";
    },
  };
}
