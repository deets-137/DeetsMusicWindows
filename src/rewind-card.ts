// Rewind card (DEETS-REWIND Phase B) — the listening-stats leaderboard. A stat ×
// time-window picker (two pills, the Library toolbar grammar) over the play-event
// log: hero block for #1 (the History/Qcard shape) + ranked runners-up, each row
// carrying real minutes listened · play count. All local — nothing leaves the machine.
//
// Data + grouping semantics live in rewind.ts; this file is markup + wiring only.
// Known lag, by design: the CURRENTLY playing song's event row isn't finalized until
// the next song starts, so its in-flight minutes aren't counted yet — the board
// catches up one song later (we re-render on queue changes).

import "./styles/qcard.css";
import "./styles/rewind.css";
import * as queue from "./queue";
import type { Track } from "./library";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { onTracksChange, tracks as libraryTracks } from "./track-store";
import { esc } from "./collection-card";
import { trackMenu, albumOrder } from "./library-card";
import { rowPick, picksText } from "./row-pick";
import { artURL } from "./queue-rows";
import { openContextMenu, openContextMenuUnder, type MenuItem } from "./context-menu";
import { onPlaylistsChange, playlistsCached, playlistTracks, addToPlaylistItem } from "./playlists";
import {
  topBy, fmtListen, fmtPlays, albumKey, pid, STAT_LABELS, WINDOW_LABELS,
  type RewindRow, type RewindStat, type RewindWindow,
} from "./rewind";
import type { CardDef, CardInstance } from "./cards";
import { makeReplayPlaylist, makePicksPlaylist } from "./replay";
import { sotdOn, pickMenu, allPicks, onSotdChange, isPosted, withdrawAsking } from "./sotd";
import { rowDrag } from "./row-drag";

const LIST_CAP = 20; // hero + 19 runners-up; a leaderboard's tail is noise
const STORE_KEY = "deets.rewind";

interface Pick { stat: RewindStat; window: RewindWindow }
const DEFAULT_PICK: Pick = { stat: "songs", window: "week" };

function loadPick(): Pick {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "");
    if (raw.stat in STAT_LABELS && raw.window in WINDOW_LABELS) return raw as Pick;
  } catch { /* first run / stale shape → default */ }
  return { ...DEFAULT_PICK };
}

export const rewindCard: CardDef = {
  id: "rewind",
  title: "Rewind",
  mount: (host) => mountRewind(host),
};

function mountRewind(host: HTMLElement): CardInstance {
  const pillHTML = (kind: "stat" | "window", label: string) => `
    <div class="lib-ctrl">
      <button class="lib-pill" data-pick="${kind}" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="lib-pill__label">${esc(label)}</span>
        <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </button>
    </div>`;

  let pick = loadPick();
  // A card left on the picks board before the feature was switched off. Done here, before the
  // markup: the stat pill takes its label from `pick` as it is built.
  if (pick.stat === "picks" && !sotdOn()) pick = { ...pick, stat: "songs" };
  // SOTD (owner, 2026-09-18): the header's top-right button — the refresh square's family,
  // widened to carry the word (.panel__action--text). It is the ONLY way to the picks board:
  // Picks is not in the stat pill. Pressed while that board shows; pressing it again goes
  // back to the stat you were on. Hidden entirely while Song of the Day is off.
  host.innerHTML = `
    <header class="panel__head"><h2 class="panel__title">Rewind</h2>
      <button class="panel__action panel__action--text" id="rewind-sotd" type="button" aria-pressed="false"
        aria-label="Your Songs of the Day" title="The songs you marked, newest first">SOTD</button>
    </header>
    <div class="panel__body qcard rewind">
      <div class="lib-pills rewind__pills">
        ${pillHTML("stat", STAT_LABELS[pick.stat])}${pillHTML("window", WINDOW_LABELS[pick.window])}
        <button class="lib-pill rewind__make" type="button" title="A playlist of this window's top songs, filed under Replay">Make playlist</button>
      </div>
      <div class="rewind__board"></div>
    </div>`;
  const board = host.querySelector<HTMLElement>(".rewind__board")!;
  const pillOf = (kind: string) => host.querySelector<HTMLElement>(`[data-pick="${kind}"]`)!;

  // The rows rendered last — the contextmenu handler resolves data-idx against this.
  let view: RewindRow[] = [];
  let renderSeq = 0; // stale-async guard: only the latest topBy() call may render

  // The withdraw square on a posted pick (§10.7). It joins the add-square family: a
  // `panel__action` at the row's end that takes no room until the row is hovered or focused,
  // so a title keeps its full width. The glyph is an arrow turning back — recall what left.
  const WITHDRAW_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 14 4 14 4 9"></polyline>' +
    '<path d="M4 14l3.5-3.5a7 7 0 1 1 1.4 9.9"></path></svg>';
  const withdrawHTML = (r: RewindRow): string => {
    if (pick.stat !== "picks" || !r.pickId) return "";
    const p = pickById(r.pickId);
    if (!p || !isPosted(p)) return "";
    return (
      `<button class="panel__action add-square rewind__withdraw" type="button" data-withdraw="${r.pickId}" ` +
      `aria-label="Withdraw the post" title="Takes the Discord post down. Your pick stays">${WITHDRAW_ICON}</button>`
    );
  };

  // Picks carry their day (and their note) instead of minutes: the view is a timeline,
  // and there is nothing ranked to measure (DeetsOTD.md §8.7).
  const metaHTML = (r: RewindRow) =>
    `<span class="rewind__meta">${esc(r.meta ?? `${fmtListen(r.ms)} · ${fmtPlays(r.plays)}`)}</span>`;

  // Multi-select (row-pick.ts, NEXT-VERSION §19). Named `picks` because `pick` already
  // means this card's stat + window choice. Keyed by the row's own key, so a refresh (a
  // play lands, the track store reloads) keeps what you picked. Artists never pick: "play
  // an artist" has no obvious order here, which is why they carry no menu and no drag.
  const picks = rowPick<RewindRow>({
    id: (r) => r.key,
    items: () => view as RewindRow[],
    can: () => pick.stat !== "artists",
    onChange: () => render(),
  });

  const render = () => {
    const seq = ++renderSeq;
    topBy(pick.stat, pick.window)
      .then((rows) => {
        if (seq !== renderSeq) return; // a newer pick/refresh superseded this one
        view = rows.slice(0, LIST_CAP);
        if (!view.length) {
          board.innerHTML = `<p class="qcard__empty">Nothing played in this window yet.</p>`;
          return;
        }
        // Artist rows render round art (the Library card's artist grammar); the art
        // itself is the group's most-listened track's album cover — zero Apple calls.
        const round = pick.stat === "artists" ? " rewind--round" : "";
        const top = view[0];
        const cover = artURL(top.track, 96);
        const heroArt = cover
          ? `<img class="qnow__art" src="${esc(cover)}" alt="" data-art />`
          : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;
        const hero = `
          <div class="qnow${round}" data-idx="0">
            ${heroArt}
            <div class="qnow__text">
              <span class="qnow__title">${esc(top.title)}</span>
              ${top.subtitle ? `<span class="qnow__artist">${esc(top.subtitle)}</span>` : ""}
              ${metaHTML(top)}
            </div>
            ${withdrawHTML(top)}
          </div>`;
        const rows2 = view.slice(1).map((r, i) => {
          const c = artURL(r.track, 72);
          const art = c
            ? `<img class="qrow__art" src="${esc(c)}" alt="" loading="lazy" data-art />`
            : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
          return `<li class="qrow${round}" data-idx="${i + 1}">${art}<div class="qrow__text"><span class="qrow__title">${esc(
            r.title,
          )}</span>${r.subtitle ? `<span class="qrow__artist">${esc(r.subtitle)}</span>` : ""}${metaHTML(r)}</div>${withdrawHTML(r)}</li>`;
        }).join("");
        // No ranking in the Picks view, so no "Runners-up": what follows the newest pick
        // is simply what came before it.
        const head = pick.stat === "picks" ? "Earlier" : "Runners-up";
        const label = picks.size() ? `${head} · ${picksText(picks.size(), nounOf())}` : head;
        board.innerHTML = rows2
          ? `${hero}<div class="qcard__label">${label}</div><ol class="qcard__list">${rows2}</ol>`
          : hero;
        // The card re-renders whole, so one sweep marks what is picked.
        picks.mark(board, "[data-idx]", (el) => view[Number(el.dataset.idx)]);
      })
      .catch((e) => {
        console.error("[rewind] load", e);
        if (seq === renderSeq) board.innerHTML = `<p class="qcard__empty">Couldn't load stats.</p>`;
      });
  };

  // ── the two pickers ──
  const setPick = (patch: Partial<Pick>) => {
    picks.clear(); // a different stat or window is a different list — the picks go with it
    pick = { ...pick, ...patch };
    localStorage.setItem(STORE_KEY, JSON.stringify(pick));
    pillOf("stat").querySelector(".lib-pill__label")!.textContent = STAT_LABELS[pick.stat];
    pillOf("window").querySelector(".lib-pill__label")!.textContent = WINDOW_LABELS[pick.window];
    paintSotd();
    render();
  };
  const openPicker = <K extends string>(
    pill: HTMLElement,
    labels: Record<K, string>,
    apply: (key: K) => void,
  ) => {
    pill.setAttribute("aria-expanded", "true");
    const items: MenuItem[] = (Object.keys(labels) as K[]).map((k) => ({
      label: labels[k],
      run: () => apply(k),
    }));
    openContextMenuUnder(pill, items, () => pill.setAttribute("aria-expanded", "false"));
  };
  // Picks never appears in the stat menu (owner, 2026-09-18: one door, and it is the button).
  // The PILL still reads "Picks" while that board shows — it names what is on screen — and
  // picking any stat from its menu is a way out, which turns the button off.
  const statLabels = (): Record<Exclude<RewindStat, "picks">, string> => {
    const { picks: _picks, ...rest } = STAT_LABELS;
    return rest;
  };
  pillOf("stat").addEventListener("click", (e) => {
    e.stopPropagation(); // the menu's outside-press dismiss must not see this click
    openPicker(pillOf("stat"), statLabels(), (stat) => setPick({ stat }));
  });
  pillOf("window").addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker(pillOf("window"), WINDOW_LABELS, (window) => setPick({ window }));
  });

  // ── the SOTD button ──
  const sotdBtn = host.querySelector<HTMLButtonElement>("#rewind-sotd");
  // The stat to come back to. Never "picks": the button is what leaves and returns.
  let before: RewindStat = pick.stat === "picks" ? "songs" : pick.stat;
  const paintSotd = () => {
    if (!sotdBtn) return;
    sotdBtn.hidden = !sotdOn();
    const on = pick.stat === "picks";
    sotdBtn.setAttribute("aria-pressed", String(on));
    sotdBtn.title = on ? "Back to your listening" : "The songs you marked, newest first";
  };
  sotdBtn?.addEventListener("click", () => {
    if (pick.stat === "picks") setPick({ stat: before });
    else {
      before = pick.stat;
      setPick({ stat: "picks" });
    }
  });
  paintSotd();

  // Make playlist (NEXT-VERSION §4): the window's top songs by minutes listened → a
  // dated local playlist under the Replay folder. Zero Apple calls.
  const makeBtn = host.querySelector<HTMLButtonElement>(".rewind__make");
  makeBtn?.addEventListener("click", () => {
    if (!makeBtn || makeBtn.disabled) return;
    makeBtn.disabled = true;
    const label = makeBtn.textContent;
    (pick.stat === "picks" ? makePicksPlaylist(pick.window) : makeReplayPlaylist(pick.window))
      .then(() => { makeBtn.textContent = "Made"; })
      .catch((e) => { console.error("[rewind] make playlist", e); makeBtn.textContent = "Nothing to add"; })
      .finally(() => window.setTimeout(() => { makeBtn.textContent = label; makeBtn.disabled = false; }, 1500));
  });

  // ── right-click menus (Play Now / Play Next / Add to Queue / Add to Playlist) ──
  // Songs + albums ride the library card's shared trackMenu over a concrete Track[];
  // a playlist row's list is fetched LAZILY (only a picked action pays the mirror
  // fetch). Artists stay read-only — "play an artist" has no obvious order.

  // An album row's playable list: the full album from the library cache when we have
  // it (disc/track order — the Library card's recipe); a catalog-only album falls
  // back to the tracks we've actually seen played (the best list we hold locally).
  const pickById = (id: number) => allPicks().find((p) => p.id === id);

  const albumTracksOf = (row: RewindRow): Track[] => {
    const lib = libraryTracks().filter((t) => albumKey(t) === row.key);
    return albumOrder(lib.length ? lib : row.tracks);
  };

  // A playlist row's songs, fetched lazily (a menu pick or a drop).
  const playlistTracksOf = (row: RewindRow): Promise<Track[]> =>
    playlistsCached().then((all) => {
      const p = all.find((x) => pid(x) === row.key);
      if (!p) { console.warn("[rewind] playlist gone:", row.key); return []; }
      return playlistTracks(p);
    });

  const playlistMenuFor = (row: RewindRow): MenuItem[] => {
    const ctx = `playlist:${row.key}`; // plays keep attributing to this playlist
    const getTracks = () => playlistTracksOf(row);
    const err = (what: string) => (x: unknown) => console.error(`[rewind] ${what}`, x);
    const run = (what: string, go: (ts: Track[]) => Promise<void>) => () =>
      void getTracks().then((ts) => (ts.length ? go(ts) : undefined)).catch(err(what));
    return [
      { label: "Play Now", run: run("play now", (ts) => playTracks(ts, 0, ctx)) },
      { label: "Play Next", run: run("play next", (ts) => queueTracksNext(ts, ctx)) },
      { label: "Add to Queue", run: run("add to queue", (ts) => queueTracksLater(ts, ctx)) },
      addToPlaylistItem(getTracks, row.key), // a playlist can't bulk-add to itself
    ];
  };

  /** What one row is, for the count: the stat's own name without its "s". */
  const nounOf = () =>
    pick.stat === "songs" ? "song" : pick.stat === "albums" ? "album" : pick.stat === "picks" ? "pick" : "playlist";

  /** Every picked row's songs, in the order the rows are shown. Playlists load lazily. */
  const picksTracks = (rows: RewindRow[]): Promise<Track[]> =>
    Promise.all(
      rows.map((r) =>
        pick.stat === "songs" || pick.stat === "picks" ? Promise.resolve(r.tracks)
        : pick.stat === "albums" ? Promise.resolve(albumTracksOf(r))
        : playlistTracksOf(r),
      ),
    ).then((a) => a.flat());

  /** The menu for a picked set (§19): play, queue or file every row's songs at once. */
  const menuForPicks = (rows: RewindRow[]): MenuItem[] => {
    const ctx = `rewind:picked`;
    const err = (what: string) => (x: unknown) => console.error(`[rewind] ${what}`, x);
    const run = (what: string, go: (ts: Track[]) => Promise<void>) => () =>
      void picksTracks(rows).then((ts) => (ts.length ? go(ts) : undefined)).catch(err(what));
    return [
      { label: `Play ${picksText(rows.length, nounOf())}`, run: run("play picked", (ts) => playTracks(ts, 0, ctx)) },
      { label: "Play Next", run: run("play next", (ts) => queueTracksNext(ts, ctx)) },
      { label: "Add to Queue", run: run("add to queue", (ts) => queueTracksLater(ts, ctx)) },
      addToPlaylistItem(() => picksTracks(rows)),
    ];
  };

  // A Rewind row has never done anything on a plain click, and still doesn't. Ctrl and
  // Shift pick it; a plain click drops the picks (§19).
  board.addEventListener("click", (e) => {
    // The withdraw square first: it is inside a row, and its press is not the row's.
    const pull = (e.target as HTMLElement).closest<HTMLElement>("[data-withdraw]");
    if (pull?.dataset.withdraw) {
      e.preventDefault();
      e.stopPropagation();
      const p = pickById(Number(pull.dataset.withdraw));
      if (p) withdrawAsking(p);
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    const row = el ? view[Number(el.dataset.idx)] : undefined;
    if (row) picks.click(e, row);
    else picks.clear();
  });

  // Escape drops the picks; Ctrl+A takes the board. Gated on the last press inside this
  // card — a row carries no tabindex, so the focus never leaves <body>.
  let touched = false;
  board.addEventListener("pointerdown", () => {
    touched = true;
  });
  const onDocDown = (e: PointerEvent) => {
    if (!host.contains(e.target as Node)) touched = false;
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable]")) return;
    if (e.key === "Escape") {
      picks.clear();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && touched) {
      e.preventDefault();
      picks.all();
    }
  };
  document.addEventListener("pointerdown", onDocDown);
  document.addEventListener("keydown", onKey);

  board.addEventListener("contextmenu", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!el) return;
    const row = view[Number(el.dataset.idx)];
    if (!row) return;
    let items: MenuItem[] | null = null;
    if (picks.size() && picks.isPicked(row)) items = menuForPicks(picks.picked());
    else if (pick.stat === "picks" && row.pickId) {
      const p = pickById(row.pickId);
      items = p ? [...trackMenu(row.tracks, "picks"), ...pickMenu(p)] : trackMenu(row.tracks, "rewind");
    }
    else if (pick.stat === "songs" && row.tracks.length) items = trackMenu(row.tracks, "rewind");
    else if (pick.stat === "albums" && row.tracks.length) items = trackMenu(albumTracksOf(row), `album:${row.key}`);
    else if (pick.stat === "playlists") items = playlistMenuFor(row);
    if (!items) return; // artists, or an uncached "Unknown" row — nothing playable
    e.preventDefault();
    el.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el.classList.remove("is-context"));
  });

  // Drag a row to another card (DRAG-DROP.md §2) — the same lists as its right-click menu.
  // Artists stay out: "play an artist" has no obvious order here.
  const drag = rowDrag({
    root: board,
    label: "rewind",
    rowAt: (target) => {
      const el = target.closest<HTMLElement>("[data-idx]");
      const row = el ? view[Number(el.dataset.idx)] : undefined;
      if (!el || !row) return null;
      const index = Number(el.dataset.idx);
      // A drag off a picked row carries every picked row's songs as ONE payload (§19).
      if (picks.size() > 1 && picks.isPicked(row)) {
        const rows = picks.picked();
        const kind = pick.stat === "albums" ? "album" : pick.stat === "playlists" ? "playlist" : "song";
        return { row: el, index, payload: { source: "rewind", kind, count: rows.length, tracks: () => picksTracks(rows), context: "rewind:picked" } };
      }
      if ((pick.stat === "songs" || pick.stat === "picks") && row.tracks.length)
        return { row: el, index, payload: { source: "rewind", kind: "song", tracks: () => row.tracks, context: "rewind" } };
      if (pick.stat === "albums" && row.tracks.length) {
        const ts = albumTracksOf(row);
        return { row: el, index, payload: { source: "rewind", kind: "album", count: ts.length, tracks: () => ts, context: `album:${row.key}` } };
      }
      if (pick.stat === "playlists")
        return {
          row: el, index,
          payload: { source: "rewind", kind: "playlist", tracks: () => playlistTracksOf(row), context: `playlist:${row.key}`, playlistId: row.key },
        };
      return null;
    },
  });

  // Refresh when a play lands (queue change finalizes the outgoing song's event),
  // when the track store (re)loads (joins resolve instead of "Unknown"), and when
  // playlists change (names for the playlist stat).
  const unsubQueue = queue.onQueueChange(render);
  const unsubTracks = onTracksChange(render, "rewind");
  const unsubPlaylists = onPlaylistsChange(() => { if (pick.stat === "playlists") render(); });
  // A mark, an unmark, a note or the feature going off: the Picks view is drawn from picks.
  const unsubSotd = onSotdChange(() => {
    if (pick.stat === "picks" && !sotdOn()) setPick({ stat: before });
    else {
      paintSotd();
      if (pick.stat === "picks") render();
    }
  });
  render();

  return {
    destroy() {
      renderSeq++; // orphan any in-flight load
      unsubQueue();
      unsubTracks();
      unsubPlaylists();
      unsubSotd();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown);
      drag.destroy();
      host.innerHTML = "";
    },
  };
}
