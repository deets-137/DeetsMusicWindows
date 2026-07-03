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
import { artURL } from "./queue-rows";
import { openContextMenu, openContextMenuUnder, type MenuItem } from "./context-menu";
import { onPlaylistsChange, playlistsCached, playlistTracks, addToPlaylistItem } from "./playlists";
import {
  topBy, fmtListen, fmtPlays, albumKey, pid, STAT_LABELS, WINDOW_LABELS,
  type RewindRow, type RewindStat, type RewindWindow,
} from "./rewind";
import type { CardDef, CardInstance } from "./cards";

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
  host.innerHTML = `
    <header class="panel__head"><h2 class="panel__title">Rewind</h2></header>
    <div class="panel__body qcard rewind">
      <div class="lib-pills rewind__pills">
        ${pillHTML("stat", STAT_LABELS[pick.stat])}${pillHTML("window", WINDOW_LABELS[pick.window])}
      </div>
      <div class="rewind__board"></div>
    </div>`;
  const board = host.querySelector<HTMLElement>(".rewind__board")!;
  const pillOf = (kind: string) => host.querySelector<HTMLElement>(`[data-pick="${kind}"]`)!;

  // The rows rendered last — the contextmenu handler resolves data-idx against this.
  let view: RewindRow[] = [];
  let renderSeq = 0; // stale-async guard: only the latest topBy() call may render

  const metaHTML = (r: RewindRow) =>
    `<span class="rewind__meta">${esc(fmtListen(r.ms))} · ${esc(fmtPlays(r.plays))}</span>`;

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
          ? `<img class="qnow__art" src="${esc(cover)}" alt="" />`
          : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;
        const hero = `
          <div class="qnow${round}" data-idx="0">
            ${heroArt}
            <div class="qnow__text">
              <span class="qnow__title">${esc(top.title)}</span>
              ${top.subtitle ? `<span class="qnow__artist">${esc(top.subtitle)}</span>` : ""}
              ${metaHTML(top)}
            </div>
          </div>`;
        const rows2 = view.slice(1).map((r, i) => {
          const c = artURL(r.track, 72);
          const art = c
            ? `<img class="qrow__art" src="${esc(c)}" alt="" loading="lazy" />`
            : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
          return `<li class="qrow${round}" data-idx="${i + 1}">${art}<div class="qrow__text"><span class="qrow__title">${esc(
            r.title,
          )}</span>${r.subtitle ? `<span class="qrow__artist">${esc(r.subtitle)}</span>` : ""}${metaHTML(r)}</div></li>`;
        }).join("");
        board.innerHTML = rows2
          ? `${hero}<div class="qcard__label">Runners-up</div><ol class="qcard__list">${rows2}</ol>`
          : hero;
      })
      .catch((e) => {
        console.error("[rewind] load", e);
        if (seq === renderSeq) board.innerHTML = `<p class="qcard__empty">Couldn't load stats.</p>`;
      });
  };

  // ── the two pickers ──
  const setPick = (patch: Partial<Pick>) => {
    pick = { ...pick, ...patch };
    localStorage.setItem(STORE_KEY, JSON.stringify(pick));
    pillOf("stat").querySelector(".lib-pill__label")!.textContent = STAT_LABELS[pick.stat];
    pillOf("window").querySelector(".lib-pill__label")!.textContent = WINDOW_LABELS[pick.window];
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
  pillOf("stat").addEventListener("click", (e) => {
    e.stopPropagation(); // the menu's outside-press dismiss must not see this click
    openPicker(pillOf("stat"), STAT_LABELS, (stat) => setPick({ stat }));
  });
  pillOf("window").addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker(pillOf("window"), WINDOW_LABELS, (window) => setPick({ window }));
  });

  // ── right-click menus (Play Now / Play Next / Add to Queue / Add to Playlist) ──
  // Songs + albums ride the library card's shared trackMenu over a concrete Track[];
  // a playlist row's list is fetched LAZILY (only a picked action pays the mirror
  // fetch). Artists stay read-only — "play an artist" has no obvious order.

  // An album row's playable list: the full album from the library cache when we have
  // it (disc/track order — the Library card's recipe); a catalog-only album falls
  // back to the tracks we've actually seen played (the best list we hold locally).
  const albumTracksOf = (row: RewindRow): Track[] => {
    const lib = libraryTracks().filter((t) => albumKey(t) === row.key);
    return albumOrder(lib.length ? lib : row.tracks);
  };

  const playlistMenuFor = (row: RewindRow): MenuItem[] => {
    const ctx = `playlist:${row.key}`; // plays keep attributing to this playlist
    const getTracks = () =>
      playlistsCached().then((all) => {
        const p = all.find((x) => pid(x) === row.key);
        if (!p) { console.warn("[rewind] playlist gone:", row.key); return []; }
        return playlistTracks(p);
      });
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

  board.addEventListener("contextmenu", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!el) return;
    const row = view[Number(el.dataset.idx)];
    if (!row) return;
    let items: MenuItem[] | null = null;
    if (pick.stat === "songs" && row.tracks.length) items = trackMenu(row.tracks, "rewind");
    else if (pick.stat === "albums" && row.tracks.length) items = trackMenu(albumTracksOf(row), `album:${row.key}`);
    else if (pick.stat === "playlists") items = playlistMenuFor(row);
    if (!items) return; // artists, or an uncached "Unknown" row — nothing playable
    e.preventDefault();
    el.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el.classList.remove("is-context"));
  });

  // Refresh when a play lands (queue change finalizes the outgoing song's event),
  // when the track store (re)loads (joins resolve instead of "Unknown"), and when
  // playlists change (names for the playlist stat).
  const unsubQueue = queue.onQueueChange(render);
  const unsubTracks = onTracksChange(render);
  const unsubPlaylists = onPlaylistsChange(() => { if (pick.stat === "playlists") render(); });
  render();

  return {
    destroy() {
      renderSeq++; // orphan any in-flight load
      unsubQueue();
      unsubTracks();
      unsubPlaylists();
      host.innerHTML = "";
    },
  };
}
