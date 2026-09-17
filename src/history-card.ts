// History card — renders the DURABLE play log (`play_events`, DEETS-REWIND §5a):
// the most recently heard song as a hero block (mirrors the Qcard's Now Playing),
// then the older plays under a "Previously" label, newest first. It survives a restart
// (it read the session log until 2026-09-15). Repeats are real — a song heard three
// times shows three rows (the log is append-only, unlike the deduped Previous
// back-chain). Rows are read-only; right-click offers Play Now / Play Next / Add to
// Queue via the handle-level player ops (Next/Later are gapless).
//
// Names come from the track store, not from the event: every played track that is not
// in your library is materialized as a `seen` row, and those load into the store at
// launch for exactly this (track-store.ts `loadTracks`). So no Apple call, and no copy
// of the metadata in `play_events`.

import "./styles/qcard.css";
import { invoke } from "@tauri-apps/api/core";
import * as queue from "./queue";
import { playContext, enqueueNext, enqueueLater } from "./player";
import { onTracksChange, trackById } from "./track-store";
import { setting, onSettingsChange } from "./settings-store";
import { onPlayEvent } from "./stats";
import type { PlayEvent } from "./rewind";
import type { Track } from "./library";
import { esc } from "./collection-card";
import { artURL, rowHTML } from "./queue-rows";
import { addSquareHTML, isAddSquare } from "./add-square";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem } from "./library-add";
import { startStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import { copySongLinkItem } from "./copy-link";
import { addToPlaylistItem } from "./playlists";
import { rowPick, picksText } from "./row-pick";
import type { CardDef, CardInstance } from "./cards";
import { rowDrag, isDragging, onDragEnd } from "./row-drag";

const LIST_CAP = 50; // render a bounded slice of the older plays
const SPAN_MS = 14 * 86_400_000; // how far back the card reads at mount (user's call)
const KEEP = 200; // the most it holds in memory
const TAIL_MS = 2 * 3_600_000; // a refresh re-reads this much: new rows AND recent finalizes

/** One play, as the card holds it: the handle to act on, when it was heard, and how it ended. */
interface Play {
  handle: queue.TrackHandle;
  ts: number;
  /** The song was cut short (the row is finalized and did not reach the listened-through mark). */
  skipped: boolean;
}

const nowMs = () => Date.now();

/** A durable row → a play. The id is catalog-first, so a resolved track gives the real
 *  pair of ids back; an unresolved one still plays by the id it was logged under. */
const toPlay = (e: PlayEvent): Play => {
  const t = trackById(e.trackId);
  return {
    handle: {
      catalogId: t?.catalogId ?? e.trackId,
      libraryId: t?.libraryId,
      context: e.context ?? undefined,
    },
    ts: e.startedTs,
    skipped: e.msListened != null && !e.completed,
  };
};

const readEvents = (sinceTs: number): Promise<PlayEvent[]> =>
  invoke<PlayEvent[]>("play_events_since", { sinceTs }).catch((e) => {
    console.error("[history] play_events_since", e);
    return [];
  });

/** "21:14" — the clock time in the user's own format. */
const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today" · "Yesterday" · "Tue, Sep 9" — shown in the row's own subtitle line, and only
 *  while Settings › Playback › *Show the day* is on, so the card keeps its shape. */
const dayLabel = (ts: number): string => {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (ts >= midnight.getTime()) return "Today";
  // Yesterday's own midnight, by the calendar — not 24 hours back, which a clock change breaks.
  midnight.setDate(midnight.getDate() - 1);
  if (ts >= midnight.getTime()) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

// The skip mark: the Next glyph, quiet, with its own hint (a mark, not a word — most
// listening has skips in it and a column of "Skipped" would shout).
const SKIP_MARK =
  '<span class="qrow__skip" title="You skipped this one" aria-label="Skipped">' +
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l6 5-6 5zM11 3h2v10h-2z"/></svg></span>';

export const historyCard: CardDef = {
  id: "history",
  title: "History",
  mount: (host) => mountHistory(host),
};

function mountHistory(host: HTMLElement): CardInstance {
  host.innerHTML = `<header class="panel__head"><h2 class="panel__title">History</h2></header><div class="panel__body qcard"></div>`;
  const body = host.querySelector<HTMLElement>(".panel__body")!;

  // The view rendered last: newest first, hero at index 0. The contextmenu handler
  // resolves data-idx against this snapshot — render() reassigns it, and both run off
  // the same emits, so the indices always match the DOM.
  let view: readonly Play[] = [];
  let pendingRender = false;

  // Multi-select (row-pick.ts, NEXT-VERSION §19). Keyed by the PLAY — its stamp, not its
  // song — so the same song heard three times is three rows, and a tail re-read (which
  // builds fresh objects) keeps what you picked.
  const pick = rowPick<Play>({
    id: (p) => `${p.ts}:${p.handle.catalogId ?? p.handle.libraryId ?? ""}`,
    items: () => view as Play[],
    onChange: () => render(),
  });

  const render = () => {
    if (isDragging()) {
      pendingRender = true; // a play landed mid-drag — keep the pressed row until the drop
      return;
    }
    pendingRender = false;
    const showDay = setting("historyShowDay");
    const latest = view[0];

    const t = latest ? trackById(latest.handle.catalogId) ?? trackById(latest.handle.libraryId) : undefined;
    const cover = artURL(t, 96);
    const heroArt = cover
      ? `<img class="qnow__art" src="${esc(cover)}" alt="" data-art />`
      : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;
    const hero = `
      <div class="qnow${latest ? "" : " qnow--idle"}" data-idx="0">
        ${heroArt}
        <div class="qnow__text">
          <span class="qnow__title">${esc(t?.title ?? (latest ? "Unknown" : ""))}</span>
          <span class="qnow__artist">${esc(t?.artistName ?? "")}</span>
        </div>
        ${addSquareHTML(t)}
      </div>`;

    const older = view.slice(1);
    const rows = older
      .slice(0, LIST_CAP)
      .map((p, i) => {
        const rt = trackById(p.handle.catalogId) ?? trackById(p.handle.libraryId);
        // The subtitle carries the day only while the row is on (the card keeps its shape).
        const day = showDay ? dayLabel(p.ts) : "";
        const artist = rt?.artistName ?? "";
        const sub = day ? (artist ? `${artist} · ${day}` : day) : artist;
        const meta = `<div class="qrow__meta">${p.skipped ? SKIP_MARK : ""}<span class="qrow__time">${esc(clock(p.ts))}</span></div>`;
        return rowHTML(i + 1, rt?.title ?? "Unknown", sub, artURL(rt, 72), false, meta, addSquareHTML(rt));
      })
      .join("");
    const more =
      older.length > LIST_CAP ? `<li class="qcard__more">+${older.length - LIST_CAP} more</li>` : "";
    const list = rows ? `<ol class="qcard__list">${rows}${more}</ol>` : "";

    // Label + list only once there's something OLDER than the hero — a lone play is
    // just the hero; an empty log is the blank idle hero.
    const label = pick.size() ? `Previously · ${picksText(pick.size())}` : "Previously";
    body.innerHTML = older.length
      ? `${hero}<div class="qcard__label">${label}</div>${list}`
      : hero;
    // The card re-renders whole, so one sweep marks what is picked.
    pick.mark(body, "[data-idx]", (el) => view[Number(el.dataset.idx)]);
  };

  // Right-click (hero or row) → re-queue this play. The entry is a log copy, so we
  // hand the player a fresh handle stamped with a history context; Play Now starts a
  // 1-song context (manual picks kept), Next/Later insert gapless.
  const trackOf = (p: Play) => trackById(p.handle.catalogId) ?? trackById(p.handle.libraryId);
  const menuFor = (p: Play): MenuItem[] => {
    const e = p.handle;
    const h = { catalogId: e.catalogId, libraryId: e.libraryId, context: "history" };
    const err = (what: string) => (x: unknown) => console.error(`[history] ${what}`, x);
    const t = trackOf(p); // supplies fallback pane titles for the drill-ins
    const items: MenuItem[] = [
      { label: "Play Now", run: () => void playContext([h], 0).catch(err("play now")) },
      { label: "Play Next", run: () => void enqueueNext([h]).catch(err("play next")) },
      { label: "Add to Queue", run: () => void enqueueLater([h]).catch(err("add to queue")) },
    ];
    // Add to Playlist, in `trackMenu`'s place: after the play verbs, before Go to….
    // It needs the resolved track, which a played song always has (`seen` rows
    // materialize catalog-only plays), so a station song files like any other.
    if (t) items.push(addToPlaylistItem(() => [t]));
    // Go to Artist/Album + Start Station + Add to Library — gated builders (null when
    // they shouldn't offer). Apply to the hero too: it shares this handler via data-idx="0".
    const goA = goToArtistItem("songs", e.catalogId, t?.artistName);
    if (goA) items.push(goA);
    const goAl = goToAlbumItem(e.catalogId, t?.albumName);
    if (goAl) items.push(goAl);
    const link = copySongLinkItem(e.catalogId);
    if (link) items.push(link);
    const start = startStationItem("songs", e.catalogId);
    if (start) items.push(start);
    const add = t ? addSongToLibraryItem(t) : null;
    if (add) items.push(add);
    return items;
  };
  /** The menu for a picked set of plays (§19). */
  const menuForSet = (set: Play[]): MenuItem[] => {
    const err = (what: string) => (x: unknown) => console.error(`[history] ${what}`, x);
    const hs = set.map((p) => ({ catalogId: p.handle.catalogId, libraryId: p.handle.libraryId, context: "history" }));
    const ts = set.map(trackOf).filter(Boolean) as Track[];
    const items: MenuItem[] = [
      { label: `Play ${picksText(set.length)}`, run: () => void playContext(hs, 0).catch(err("play set")) },
      { label: "Play Next", run: () => void enqueueNext(hs).catch(err("play next")) },
      { label: "Add to Queue", run: () => void enqueueLater(hs).catch(err("add to queue")) },
    ];
    if (ts.length) items.push(addToPlaylistItem(() => ts));
    return items;
  };

  // A history row has never done anything on a plain click, and still doesn't. Ctrl and
  // Shift pick it; a plain click drops the picks, so the list returns to normal (§19).
  body.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    const entry = el ? view[Number(el.dataset.idx)] : undefined;
    if (entry) pick.click(e, entry);
    else pick.clear();
  });
  body.addEventListener("contextmenu", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!el) return;
    const entry = view[Number(el.dataset.idx)];
    if (!entry) return; // idle hero (nothing played yet)
    e.preventDefault();
    el.classList.add("is-context");
    // Right-click one of the picked rows → one menu for the set (§19). A history row is a
    // record, not a queue slot, so the set's verbs are play it, queue it, and file it.
    const items = pick.size() && pick.isPicked(entry) ? menuForSet(pick.picked()) : menuFor(entry);
    openContextMenu(e.clientX, e.clientY, items, () => el.classList.remove("is-context"));
  });

  // Drag a play (the hero or a row) to another card (DRAG-DROP.md §2).
  const drag = rowDrag({
    root: body,
    label: "history",
    rowAt: (target) => {
      if (isAddSquare(target)) return null; // a press on the + adds; it never drags the row
      const el = target.closest<HTMLElement>("[data-idx]");
      const entry = el ? view[Number(el.dataset.idx)] : undefined;
      const t = entry ? trackOf(entry) : undefined;
      // A drag off a picked row carries the whole set as one payload (§19).
      if (el && entry && pick.size() > 1 && pick.isPicked(entry)) {
        const ts = pick.picked().map(trackOf).filter(Boolean) as Track[];
        if (ts.length)
          return { row: el, index: Number(el.dataset.idx), payload: { source: "history", kind: "song", count: ts.length, tracks: () => ts, context: "history" } };
      }
      return el && t
        ? { row: el, index: Number(el.dataset.idx), payload: { source: "history", kind: "song", tracks: () => [t], context: "history" } }
        : null;
    },
  });
  const unsubDragEnd = onDragEnd(() => {
    if (pendingRender) render();
  });

  // ── the durable log ──
  // Mount reads the span once. After that every write to `play_events` (a song starts,
  // a song is finalized) re-reads only the tail, which is both cheap and enough: a new
  // row lands at the top, and a finalize turns the row above into a skip mark.
  const fold = (rows: PlayEvent[], keepBefore: number) => {
    const fresh = rows.map(toPlay).sort((a, b) => b.ts - a.ts);
    const older = view.filter((p) => p.ts < keepBefore);
    view = [...fresh, ...older].slice(0, KEEP);
  };
  const loadAll = async () => {
    const since = nowMs() - SPAN_MS;
    fold(await readEvents(since), since);
    render();
  };
  const loadTail = async () => {
    const since = nowMs() - TAIL_MS;
    fold(await readEvents(since), since);
    render();
  };

  // Re-render when the track store (re)loads (entries resolve instead of showing
  // "Unknown"), when the durable log is written, and when the day row is switched.
  const unsubTracks = onTracksChange(render, "history");
  const unsubLog = onPlayEvent(() => void loadTail());
  const unsubSettings = onSettingsChange((k) => {
    if (k === "historyShowDay") render();
  });
  render(); // the empty hero, until the first read lands (one local SQLite call)
  void loadAll();

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
      unsubLog();
      unsubSettings();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown);
      drag.destroy();
      unsubDragEnd();
      host.innerHTML = "";
    },
  };
}
