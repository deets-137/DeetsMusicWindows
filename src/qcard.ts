// Queue card (Qcard) — a small custom renderer that mirrors the queue model. It
// temporarily occupies the Playlists panel slot (title swapped to "Queue"). Up Next rows
// support left-click/Enter to jump, and a right-click menu (Play Now / Move to Top / Move
// to Bottom / Remove, + Start Station / Add to Library) — the queue-edit ops live in
// player.ts (gapless; see docs/QUEUE.md).

import "./styles/qcard.css";
import { rowDrag, registerDropTarget, isDragging, onDragEnd } from "./row-drag";
import { dropToQueue } from "./drop-actions";
import { setting } from "./settings-store";
import * as queue from "./queue";
import {
  onPlayerState, jumpToUpcoming, moveInQueue, removeFromQueue, reconcileUpcoming,
  stopStation, dropResumeStation, type PlayerState,
} from "./player";
import { onTracksChange } from "./track-store";
import { esc } from "./collection-card";
import { resolveEntry as resolve, artURL, rowHTML } from "./queue-rows";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem } from "./library-add";
import { favoriteItem } from "./favorites";
import { startStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import { copySongLinkItem } from "./copy-link";
import { addToPlaylistItem } from "./playlists";
import { rowPick, picksText } from "./row-pick";
import type { Track } from "./library";
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

  // Multi-select over Up Next (row-pick.ts, NEXT-VERSION §19). The rows shown last, so a
  // shift+click run and the picked set read the same list the user sees. Keyed by object
  // identity, NOT by song: the same song can sit in the queue twice, and an entry object
  // is stable across a reorder — so the picks follow the rows, and a song that leaves the
  // queue takes its pick with it.
  let shownRows: queue.QueueEntry[] = [];
  const pick = rowPick<queue.QueueEntry>({ items: () => shownRows, onChange: () => render() });

  const render = () => {
    if (dragging || isDragging()) {
      pendingRender = true; // a queue/track change arrived mid-drag (any card's) — defer the rebuild
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
    shownRows = shown;
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
    // Radio (STATIONS.md §3b, 2026-09-10): the station sits in Up Next AS IF it were
    // the next song — last, after any manual break-out block, since that block plays
    // first and the station returns after it. No data-idx: not jumpable, not draggable.
    const st = lastState?.station ?? lastState?.resume;
    let stationRow = "";
    if (st) {
      const art = st.artworkUrl
        ? `<img class="qrow__art" src="${esc(st.artworkUrl)}" alt="" loading="lazy" data-art />`
        : `<div class="qrow__art qrow__art--empty" aria-hidden="true">📻</div>`;
      stationRow = `<li class="qrow qrow--station" data-station="${esc(st.id)}">${art}<div class="qrow__text"><span class="qrow__title">${esc(st.name)}</span>${
        lastState?.resume ? `<span class="qrow__artist">Will resume after</span>` : ""
      }</div></li>`;
    }
    const list = rows || stationRow
      ? `<ol class="qcard__list">${rows}${more}${stationRow}</ol>`
      : `<p class="qcard__empty">...</p>`;

    body.innerHTML = `
      <div class="qnow${current ? "" : " qnow--idle"}${loading ? " qnow--loading" : ""}">
        ${npArt}
        <div class="qnow__text">
          <span class="qnow__title">${esc(npTitle)}</span>
          <span class="qnow__artist">${esc(npArtist)}</span>
        </div>
      </div>
      <div class="qcard__label">${pick.size() ? `Up Next · ${picksText(pick.size())}` : "Up Next"}</div>
      ${list}`;
    // The pick mark, after the rows exist (the card re-renders whole, so one sweep does it).
    pick.mark(body, ".qrow[data-idx]", (el) => shownRows[Number(el.dataset.idx)]);
  };

  // Click (or Enter/Space) an Up Next row → jump to it. Delegated on the persistent
  // body so it survives re-renders. The jump re-windows and buffers (cover-up above).
  const jumpFromEvent = (target: EventTarget | null, e?: MouseEvent) => {
    if (drag.consumeClick()) return; // this click was the tail of a drag
    const row = (target as HTMLElement | null)?.closest<HTMLElement>(".qrow[data-idx]");
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (Number.isNaN(idx)) return;
    // Ctrl / Shift → a pick, not a jump (§19). A plain click jumps, and drops the picks.
    const entry = shownRows[idx];
    if (e && entry && pick.click(e, entry)) return;
    jumpToUpcoming(idx).catch((err) => console.error("[qcard] jump", err));
  };
  body.addEventListener("click", (e) => jumpFromEvent(e.target, e));
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
    // The station row: leave the station (radio) or cancel its return (after a break-out).
    const stRow = target.closest<HTMLElement>(".qrow--station");
    if (stRow) {
      e.preventDefault();
      stRow.classList.add("is-context");
      const items: MenuItem[] = lastState?.station
        ? [{ label: "Stop Station", run: () => void stopStation().catch((err) => console.error("[qcard] stop station", err)) }]
        : [{ label: "Don't resume", run: () => dropResumeStation() }];
      openContextMenu(e.clientX, e.clientY, items, () => stRow.classList.remove("is-context"));
      return;
    }
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
      // Right-click one of the picked rows → one menu for the whole set (§19): file them
      // all, or take them all out. Remove walks the LIVE indexes from the bottom up, so
      // each removal can't shift the rows still to go.
      if (pick.size() && pick.isPicked(entry)) {
        const set = pick.picked();
        const ts = set.map(resolve).filter(Boolean) as Track[];
        const setItems: MenuItem[] = [];
        if (ts.length) setItems.push(addToPlaylistItem(() => ts));
        setItems.push({
          label: `Remove ${picksText(set.length)}`,
          run: () => {
            const live = queue.getUpcoming();
            const idxs = set.map((x) => live.indexOf(x)).filter((i) => i >= 0).sort((a, b) => b - a);
            void idxs
              .reduce((chain, i) => chain.then(() => removeFromQueue(i)), Promise.resolve())
              .then(() => pick.clear())
              .catch((err) => console.error("[qcard] remove picked", err));
          },
        });
        e.preventDefault();
        row.classList.add("is-context");
        openContextMenu(e.clientX, e.clientY, setItems, () => row.classList.remove("is-context"));
        return;
      }
      const items: MenuItem[] = [
        { label: "Play Now", run: act(jumpToUpcoming, "play now") },
        { label: "Move to Top", run: act((i) => moveInQueue(i, "top"), "move top") },
        { label: "Move to Bottom", run: act((i) => moveInQueue(i, "bottom"), "move bottom") },
        { label: "Remove", run: act(removeFromQueue, "remove") },
      ];
      // Add to Playlist sits where `trackMenu` puts it — after the play/queue verbs,
      // before the Go to… drill-ins. It needs the RESOLVED track (the builder takes
      // Track[], not a queue handle), so a row still resolving simply doesn't offer it.
      // A station song resolves as a transient, so it files like any other song.
      if (t) items.push(addToPlaylistItem(() => [t]));
      // Go to Artist/Album + Start Station key off the entry's catalog id directly —
      // the resolved track (t) only supplies fallback pane titles, so they work even
      // before the store has resolved the row.
      const goA = goToArtistItem("songs", entry.catalogId, t?.artistName);
      if (goA) items.push(goA);
      const goAl = goToAlbumItem(entry.catalogId, t?.albumName);
      if (goAl) items.push(goAl);
      const link = copySongLinkItem(entry.catalogId);
      if (link) items.push(link);
      const start = startStationItem("songs", entry.catalogId);
      if (start) items.push(start);
      const add = t ? addSongToLibraryItem(t) : null;
      if (add) items.push(add);
      const fav = favoriteItem(t);
      if (fav) items.push(fav);
      openContextMenu(e.clientX, e.clientY, items, () => row.classList.remove("is-context"));
      return;
    }

    const hero = target.closest<HTMLElement>(".qnow");
    if (!hero) return;
    const cur = queue.getCurrent();
    const t = cur ? resolve(cur) : undefined;
    const items = [
      t ? addToPlaylistItem(() => [t]) : null,
      goToArtistItem("songs", cur?.catalogId, t?.artistName),
      goToAlbumItem(cur?.catalogId, t?.albumName),
      copySongLinkItem(cur?.catalogId),
      startStationItem("songs", cur?.catalogId), // "more like what's playing"
      t ? addSongToLibraryItem(t) : null,
      favoriteItem(t),
      lastState?.station
        ? { label: "Stop Station", run: () => void stopStation().catch((err) => console.error("[qcard] stop station", err)) }
        : null,
    ].filter(Boolean) as MenuItem[];
    if (!items.length) return; // nothing to offer for the current song
    e.preventDefault();
    hero.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => hero.classList.remove("is-context"));
  });

  // ── Row drag — the shared primitive, row-drag.ts ──────────────────────────────
  // Inside Up Next a row reorders: render() is suspended mid-drag (above) so a queue/track
  // change can't yank the row; on drop we move the MODEL, then `reconcileUpcoming()`
  // (gapless MusicKit sync). The entry is taken when the drag starts and re-resolved at the
  // drop (playback may have advanced). Out of the list, a row — or the Now Playing hero —
  // carries its song to another card (DRAG-DROP.md §2).
  let dragEntry: queue.QueueEntry | null = null;
  const drag = rowDrag({
    root: body,
    label: "queue",
    rowAt: (target) => {
      const hero = target.closest<HTMLElement>(".qnow");
      if (hero) {
        const cur = queue.getCurrent();
        const t = cur ? resolve(cur) : undefined;
        if (!cur || !t) return null;
        return { row: hero, index: -1, payload: { source: "queue-now", kind: "song", tracks: () => [t], context: cur.context } };
      }
      const row = target.closest<HTMLElement>(".qrow[data-idx]");
      const list = row?.parentElement;
      if (!row || !list) return null;
      const index = Number(row.dataset.idx);
      const entry = queue.getUpcoming()[index];
      if (!entry) return null;
      const t = resolve(entry);
      // A drag off a picked row carries every picked song as ONE payload, and is a copy,
      // never a reorder — a block of rows has no single new position (§19).
      if (pick.size() > 1 && pick.isPicked(entry)) {
        const ts = pick.picked().map(resolve).filter(Boolean) as Track[];
        if (ts.length) return { row, index, payload: { source: "queue", kind: "song", count: ts.length, tracks: () => ts, context: entry.context } };
      }
      // On Now Playing, an Up Next row plays at once. Keep Up Next (Settings › Playback):
      // it moves to the top first, so the rows above it stay. Replace: its menu's Play Now,
      // a jump that drops the rows above it.
      const play = () => {
        const i = queue.getUpcoming().indexOf(entry);
        if (i < 0) return Promise.resolve();
        if (setting("dropPlayQueue") !== "keep") return jumpToUpcoming(i);
        queue.move(i, 0);
        return jumpToUpcoming(0);
      };
      return {
        row, index, list,
        count: list.querySelectorAll(".qrow[data-idx]").length, // not the station row
        payload: t ? { source: "queue", kind: "song", tracks: () => [t], context: entry.context, play } : undefined,
      };
    },
    onStart: (from) => {
      dragging = true;
      dragEntry = queue.getUpcoming()[from] ?? null;
    },
    onEnd: (_from, to) => {
      dragging = false;
      const entry = dragEntry;
      dragEntry = null;
      if (to != null && entry) {
        const live = queue.getUpcoming().indexOf(entry); // robust if playback advanced
        if (live >= 0) {
          queue.move(live, to); // model → onQueueChange → render (now unblocked)
          reconcileUpcoming().catch((e) => console.error("[qcard] reconcile", e)); // MusicKit
          return;
        }
      }
      if (pendingRender) render(); // aborted / no-op, but a render was deferred
    },
  });
  const unsubDragEnd = onDragEnd(() => {
    if (pendingRender && !dragging) render(); // another card's drag held a render
  });

  // Drops from other cards (DRAG-DROP.md §3, fork 2: the Queue card queues). Over Up Next's
  // rows: at the insertion line. Below the last row: the end. Anywhere else on the card
  // (the Now Playing hero, the label, an empty queue): the top of Up Next.
  const unregisterDrop = registerDropTarget({
    el: host,
    over: (under, _x, y, p) => {
      if (p.source === "queue") return null; // an Up Next row: its own list reorders
      const list = body.querySelector<HTMLElement>(".qcard__list") ?? undefined;
      const rows = list?.querySelectorAll<HTMLElement>(".qrow[data-idx]");
      const top = { highlight: host, scroll: list, drop: () => dropToQueue(p, 0) };
      if (!list || !rows?.length) return top;
      if (y > rows[rows.length - 1].getBoundingClientRect().bottom)
        return { highlight: host, scroll: list, drop: () => dropToQueue(p, queue.getUpcoming().length) };
      if (list.contains(under)) return { slots: { list, count: rows.length }, scroll: list, drop: (at: number | null) => dropToQueue(p, at ?? 0) };
      return top;
    },
  });

  // Metadata comes from the shared track store; re-render when it (re)loads so newly
  // synced songs resolve instead of showing "Unknown".
  const unsubTracks = onTracksChange(render, "qcard");
  const unsubQueue = queue.onQueueChange(render);
  const unsubState = onPlayerState((s) => {
    lastState = s;
    render();
  });
  render();

  // Which card Ctrl+A acts on: the last press inside this one. A row carries no tabindex,
  // so the focus stays on <body> and a `contains(activeElement)` test would never pass.
  let touched = false;
  body.addEventListener("pointerdown", () => {
    touched = true;
  });
  const onDocDown = (e: PointerEvent) => {
    if (!host.contains(e.target as Node)) touched = false;
  };
  document.addEventListener("pointerdown", onDocDown);

  // Escape drops the picks (§19); Ctrl+A takes every row the card shows. Both are on the
  // document, so they work wherever the pointer is, and both come off on destroy.
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable]")) return;
    if (e.key === "Escape") {
      pick.clear();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && touched) {
      e.preventDefault();
      pick.all();
    }
  };
  document.addEventListener("keydown", onKey);

  return {
    destroy() {
      unsubTracks();
      unsubQueue();
      unsubState();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown);
      drag.destroy(); // a drag's document listeners would outlive the card
      unsubDragEnd();
      unregisterDrop();
      host.innerHTML = "";
    },
  };
}
