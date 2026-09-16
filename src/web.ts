// The playlist web (docs/PLAYLIST-WEB.md): the Playlists card's web button opens a panel
// that builds a playlist from one artist and the artists they make songs with.
//
// Rust (`web_build`, web.rs) reads the artists and returns candidate songs with their degree.
// Everything after that — the genre chips, the size cap, the order — happens here, so a
// chip or a size press never calls Apple. Rust saves every artist it read, so a bigger reach
// reads only the new degree.
//
// The artist field is a search, not free text: it lists your library's artists and the artists
// you built webs from (zero calls), and its last row, "Search Apple Music", is the only way to
// a catalog search. A web starts only from a picked row.
//
// Apple calls per panel use: one artist search (only from that row) and one build
// per artist or reach change. Rust saves every artist read (web_artists), so a build of a web
// read before is zero calls until the saves age out or you press Read again.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { makeDropdown } from "./dropdown";
import { enterRows } from "./pop";
import { searchCatalog, type Artist } from "./search";
import { playlistCreate, playlistAddTracks, requestOpenPlaylist } from "./playlists";
import { setting, setSetting, onSettingsChange } from "./settings-store";
import { esc } from "./collection-card";
import { toast } from "./toast";
import { handOff } from "./handoff";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";
import type { Artwork, Track } from "./library";
import { tracks } from "./track-store";
import { creditIndex } from "./artist-credit";
import { APPLE_SIGIL } from "./apple-sigil";

interface WebSong {
  track: Track;
  degree: number;
  artistId: string;
  seed: boolean;
  /** What you already have: 3 ♥, 2 played, 1 in your library, 0 new to you. */
  mine: number;
}
interface WebArtist {
  id: string;
  name: string;
  degree: number;
}
interface WebResult {
  seed: Artist;
  artists: WebArtist[];
  songs: WebSong[];
  calls: number;
  /** Artists whose read failed; building again reads only these. */
  failed: number;
  /** Epoch-ms of the oldest saved read in this web. */
  oldest: number;
}
export type WebPrefer = "familiar" | "discover" | "mix";
/** What a picked genre does to the artist's own songs: filter them, filter them but keep at
 *  least SEED_FLOOR, or leave them all. */
export type WebSeedFilter = "all" | "floor" | "off";

const REACHES = [1, 2, 3] as const;
const SIZES = [25, 50, 100] as const;
const PREFERS: { value: WebPrefer; label: string }[] = [
  { value: "familiar", label: "Familiar" },
  { value: "discover", label: "Discover" },
  { value: "mix", label: "Mix" },
];
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Keep 5": the artist's songs a genre filter never goes below. */
const SEED_FLOOR = 5;
const MAX_HITS = 5;
const MAX_CHIPS = 10;
/** Genre names that say nothing about the sound. */
const NOT_A_GENRE = new Set(["Music"]);

/** A web of circles and lines (the user's sketch, 2026-09-16): a hub, four nodes of
 *  different sizes, and one long line that crosses the web. Lines stop short of the rings. */
const NODES: [number, number, number][] = [
  [6.5, 6, 2.6], // 0 top left
  [18.5, 7, 2.2], // 1 top right
  [9.5, 16, 2.3], // 2 the hub
  [3.5, 20, 1.6], // 3 bottom left
  [19.5, 20.5, 2], // 4 bottom right
];
const EDGES: [number, number][] = [[0, 4], [1, 2], [2, 3], [2, 4]];
const GAP = 1.3;

function iconSvg(): string {
  const lines = EDGES.map(([a, b]) => {
    const [x1, y1, r1] = NODES[a];
    const [x2, y2, r2] = NODES[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const f = (n: number) => n.toFixed(2);
    return `M${f(x1 + ux * (r1 + GAP))} ${f(y1 + uy * (r1 + GAP))}L${f(x2 - ux * (r2 + GAP))} ${f(y2 - uy * (r2 + GAP))}`;
  }).join("");
  const rings = NODES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${lines}"/>${rings}</svg>`;
}

const art = (a: Artwork | undefined, px: number): string =>
  a?.urlTemplate ? a.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : "";

/** One of your library's artists, as the Library card groups them (artist-credit.ts). */
interface LibArtist {
  name: string;
  songs: number;
  /** A song this artist leads — its Apple artist is this artist (`library_artist_info`). */
  songId?: string;
  /** An album cover, until a photo is known. */
  cover?: Artwork;
}
const libMemo = new WeakMap<Track[], LibArtist[]>();
function libraryArtists(): LibArtist[] {
  const list = tracks();
  const hit = libMemo.get(list);
  if (hit) return hit;
  const idx = creditIndex(list);
  const map = new Map<string, LibArtist>();
  for (const t of list) {
    idx.namesOf(t).forEach((name, i) => {
      let a = map.get(name);
      if (!a) map.set(name, (a = { name, songs: 0 }));
      a.songs++;
      if (!a.cover && t.artwork) a.cover = t.artwork;
      if (i === 0 && !a.songId && t.catalogId) a.songId = t.catalogId; // the lead credit only
    });
  }
  const out = [...map.values()].filter((a) => a.name);
  libMemo.set(list, out);
  return out;
}

/** How well a name matches what was typed: 0 starts with it, 1 a word starts with it,
 *  2 contains it, -1 no match. */
function matchRank(name: string, needle: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(needle)) return 0;
  if (n.split(/[\s&,.(/-]+/).some((w) => w.startsWith(needle))) return 1;
  return n.includes(needle) ? 2 : -1;
}

type Row =
  | { kind: "library"; lib: LibArtist }
  | { kind: "seed"; artist: Artist }
  | { kind: "apple"; artist: Artist }
  | { kind: "search"; term: string };

const SEARCH_GLYPH =
  '<svg class="web__hit-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';

/** Pick and order the songs (PLAYLIST-WEB.md §4). The seed's songs fill at most half; the web
 *  fills the rest nearest degree first, one artist at a time. Picked genres filter the web, and
 *  the seed's songs as `seedFilter` says. */
export function pickSongs(r: WebResult, genres: Set<string>, size: number, prefer: WebPrefer, seedFilter: WebSeedFilter): Track[] {
  // Familiar: what you ♥, played or saved first. Discover: what you don't have first. The sort
  // is stable, so Apple's order (top songs first) holds inside each level.
  const lean = (list: WebSong[]) =>
    prefer === "mix" ? list : [...list].sort((a, b) => (prefer === "familiar" ? b.mine - a.mine : Math.sign(a.mine) - Math.sign(b.mine)));
  const fits = (s: WebSong) => !genres.size || s.track.genres.some((g) => genres.has(g));
  const allSeed = lean(r.songs.filter((s) => s.seed));
  let seedSongs = seedFilter === "off" ? allSeed : allSeed.filter(fits);
  // Keep 5: a genre that fits few of the artist's songs tops them up with their best others.
  if (seedFilter === "floor" && seedSongs.length < SEED_FLOOR) {
    const kept = new Set(seedSongs);
    seedSongs = [...seedSongs, ...allSeed.filter((s) => !kept.has(s)).slice(0, SEED_FLOOR - seedSongs.length)];
  }
  const web = lean(r.songs.filter((s) => !s.seed && fits(s)));
  const byArtist = new Map<string, WebSong[]>();
  for (const s of web) {
    const list = byArtist.get(s.artistId);
    if (list) list.push(s);
    else byArtist.set(s.artistId, [s]);
  }
  const webTake: WebSong[] = [];
  const room = () => size - Math.min(seedSongs.length, Math.ceil(size / 2)) - webTake.length;
  const degrees = [...new Set(r.artists.map((a) => a.degree))].filter((d) => d > 0).sort((a, b) => a - b);
  for (const d of degrees) {
    const queues = r.artists.filter((a) => a.degree === d).map((a) => [...(byArtist.get(a.id) ?? [])]);
    while (room() > 0 && queues.some((q) => q.length)) {
      for (const q of queues) {
        if (room() <= 0) break;
        const s = q.shift();
        if (s) webTake.push(s);
      }
    }
    if (room() <= 0) break;
  }
  // A thin web leaves room: the seed's songs fill it.
  const seedTake = seedSongs.slice(0, size - webTake.length);
  // Alternate the seed and the web, spread evenly when one side is longer.
  const out: Track[] = [];
  const total = seedTake.length + webTake.length;
  let i = 0;
  let j = 0;
  for (let k = 0; k < total; k++) {
    const seedDue = j >= webTake.length || (i < seedTake.length && i * webTake.length <= j * seedTake.length);
    out.push(seedDue ? seedTake[i++].track : webTake[j++].track);
  }
  return out;
}

/** Mount the web button's panel. Returns a teardown for the card's destroy. */
export function mountWeb(btn: HTMLElement): () => void {
  btn.innerHTML = iconSvg();
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "web pop";
  panel.dataset.frames = "web";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Playlist web");
  panel.innerHTML = `
    <div class="web__title">Playlist web</div>
    <input class="web__input" data-artist type="text" placeholder="Find an artist" spellcheck="false" autocomplete="off"
      role="combobox" aria-expanded="false" aria-controls="web-hits" aria-autocomplete="list"
      title="Finds an artist in your library, or searches Apple Music" />
    <div class="web__hits" id="web-hits" role="listbox" aria-label="Artists" hidden></div>
    <div class="web__row" title="1 reaches the artist's collaborators. Each step reaches one circle further">
      <span class="web__label">Reach</span>
      <div class="web__seg" data-seg="reach">${REACHES.map((n) => `<button class="web__opt" type="button" data-value="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
    </div>
    <div class="web__row" title="Songs in the new playlist">
      <span class="web__label">Size</span>
      <div class="web__seg" data-seg="size">${SIZES.map((n) => `<button class="web__opt" type="button" data-value="${n}" aria-pressed="false">${n}</button>`).join("")}</div>
    </div>
    <div class="web__row" title="Familiar puts your songs first. Discover puts songs you don't have first">
      <span class="web__label">Prefer</span>
      <div class="web__seg" data-seg="prefer">${PREFERS.map((o) => `<button class="web__opt" type="button" data-value="${o.value}" aria-pressed="false">${o.label}</button>`).join("")}</div>
    </div>
    <div class="web__chips" hidden></div>
    <div class="web__status" aria-live="polite" hidden><span class="web__status-text"></span><button class="web__again" type="button" hidden></button></div>
    <input class="web__input" data-name type="text" placeholder="Playlist name" spellcheck="false" hidden
      title="Names the new playlist" />
    <button class="web__make" type="button" disabled hidden title="Makes the playlist and opens it">Make playlist</button>`;
  document.body.appendChild(panel); // portaled: a Glass card is a stacking context (airplay.ts)

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const artistInput = q<HTMLInputElement>("[data-artist]");
  const hitsEl = q<HTMLElement>(".web__hits");
  const chipsEl = q<HTMLElement>(".web__chips");
  const statusEl = q<HTMLElement>(".web__status");
  const statusText = q<HTMLElement>(".web__status-text");
  const againBtn = q<HTMLButtonElement>(".web__again");
  const nameInput = q<HTMLInputElement>("[data-name]");
  const makeBtn = q<HTMLButtonElement>(".web__make");

  let rows: Row[] = [];
  let active = 0; // the row Enter picks
  let seeds: Artist[] = []; // webs built before (web_seeds)
  let photos = new Map<string, Artwork>(); // library artist photos already saved (artist_photos)
  let seed: Artist | null = null;
  let result: WebResult | null = null;
  let picked = new Set<string>();
  let building = 0; // the build in flight; a newer one wins
  let making = false;

  /** Show or hide a part; a part that appears while the panel shows slides in. */
  const show = (el: HTMLElement, on: boolean) => {
    if (el.hidden === !on) return;
    el.hidden = !on;
    if (on && !panel.hidden) enterRows([el]);
  };
  /** The status line, with an optional action at its end: Retry (a part failed) or Read
   *  again (the web came from saved reads). */
  const setStatus = (text: string, action?: "retry" | "again") => {
    statusText.textContent = text;
    againBtn.hidden = !action;
    if (action) {
      againBtn.dataset.action = action;
      againBtn.textContent = action === "retry" ? "Retry" : "Read again";
      againBtn.title =
        action === "retry"
          ? "Reads only the artists that didn't load"
          : "Reads this web from Apple Music again. Use it when an artist has new songs";
    }
    show(statusEl, !!text);
  };

  const place = () => {
    if (panel.hidden) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const gap = parseFloat(getComputedStyle(panel).marginTop) || 0;
    panel.style.left = `${Math.max(gap, Math.min(r.right - panel.offsetWidth, vw - panel.offsetWidth - gap))}px`;
    panel.style.top = `${r.bottom}px`;
    // The panel never runs past the window's bottom: it stops a gap short and scrolls. The
    // --web-panel-max-h token is the ceiling on a tall window.
    const ceiling = parseFloat(getComputedStyle(panel).getPropertyValue("--web-panel-max-h")) || Infinity;
    const room = document.documentElement.clientHeight - r.bottom - 2 * gap;
    panel.style.maxHeight = `${Math.max(0, Math.min(ceiling, room))}px`;
  };

  const renderSegs = () => {
    for (const seg of panel.querySelectorAll<HTMLElement>("[data-seg]")) {
      const k = seg.dataset.seg;
      const cur = String(k === "reach" ? setting("webReach") : k === "size" ? setting("webSize") : setting("webPrefer"));
      for (const b of seg.querySelectorAll<HTMLElement>("[data-value]")) b.setAttribute("aria-pressed", String(b.dataset.value === cur));
    }
  };

  /** The rows under the artist field. Typing re-renders without motion; a new kind of list
   *  (the field opening, Apple's answer, a pick) slides its rows in. */
  const renderRows = (animate: boolean) => {
    const typing = artistInput.value.trim() !== "";
    if (seed && !typing) {
      const img = art(seed.artwork, 64);
      hitsEl.innerHTML = `<div class="web__hit" role="option" aria-selected="true" data-picked
        title="The web starts here. Type to pick another artist">${img ? `<img class="web__hit-art" src="${esc(img)}" alt="" />` : `<span class="web__hit-art"></span>`}<span class="web__hit-name">${esc(seed.name)}</span></div>`;
    } else {
      hitsEl.innerHTML = rows
        .map((r, i) => {
          let pic = "";
          let name = "";
          let sub = "";
          let tip = "";
          let tail = "";
          if (r.kind === "search") {
            pic = `<span class="web__hit-art web__hit-art--glyph">${SEARCH_GLYPH}</span>`;
            name = `Search Apple Music for “${esc(r.term)}”`;
            tip = "Searches Apple Music for this name";
            tail = APPLE_SIGIL;
          } else {
            const a = r.kind === "library" ? { name: r.lib.name, artwork: photos.get(r.lib.name) ?? r.lib.cover } : r.artist;
            const src = art(a.artwork, 64);
            pic = src ? `<img class="web__hit-art" src="${esc(src)}" alt="" loading="lazy" />` : `<span class="web__hit-art"></span>`;
            name = esc(a.name);
            if (r.kind === "library") sub = `${r.lib.songs} song${r.lib.songs === 1 ? "" : "s"}`;
            else if (r.kind === "seed") sub = "Web before";
            else sub = esc(r.artist.genres?.[0] ?? "");
            if (r.kind === "apple") tail = APPLE_SIGIL;
            tip = r.kind === "library" ? "In your library. Starts the web here" : "Starts the web here";
          }
          return `<button class="web__hit${r.kind === "search" ? " web__hit--search" : ""}${i === active ? " is-active" : ""}" type="button" role="option"
            id="web-hit-${i}" data-i="${i}" aria-selected="${i === active}" tabindex="-1" title="${tip}">${pic}<span class="web__hit-name">${name}</span>${sub ? `<span class="web__hit-sub">${sub}</span>` : ""}${tail}</button>`;
        })
        .join("");
    }
    const open = hitsEl.children.length > 0;
    show(hitsEl, open);
    artistInput.setAttribute("aria-expanded", String(open && !seed));
    if (rows[active]) artistInput.setAttribute("aria-activedescendant", `web-hit-${active}`);
    else artistInput.removeAttribute("aria-activedescendant");
    if (animate && !panel.hidden) enterRows(hitsEl.children);
  };

  const setActive = (i: number) => {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    hitsEl.querySelectorAll<HTMLElement>(".web__hit[data-i]").forEach((el) => {
      const on = Number(el.dataset.i) === active;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    artistInput.setAttribute("aria-activedescendant", `web-hit-${active}`);
  };

  /** What the field lists for the text typed: your library's artists and earlier webs'
   *  artists that match, then "Search Apple Music". Empty text: the earlier webs. No calls. */
  const localRows = (): Row[] => {
    const typed = artistInput.value.trim();
    if (!typed) return seeds.slice(0, MAX_HITS).map((artist) => ({ kind: "seed" as const, artist }));
    const needle = typed.toLowerCase();
    const ranked: { row: Row; rank: number; weight: number }[] = [];
    const named = new Set<string>();
    for (const a of seeds) {
      const rank = matchRank(a.name, needle);
      if (rank < 0) continue;
      ranked.push({ row: { kind: "seed", artist: a }, rank, weight: Number.MAX_SAFE_INTEGER });
      named.add(a.name.toLowerCase());
    }
    for (const lib of libraryArtists()) {
      const rank = matchRank(lib.name, needle);
      if (rank < 0 || named.has(lib.name.toLowerCase())) continue;
      ranked.push({ row: { kind: "library", lib }, rank, weight: lib.songs });
    }
    ranked.sort((x, y) => x.rank - y.rank || y.weight - x.weight);
    return [...ranked.slice(0, MAX_HITS).map((r) => r.row), { kind: "search", term: typed }];
  };

  const renderChips = () => {
    chipsEl.innerHTML = "";
    if (!result) return show(chipsEl, false);
    const counts = new Map<string, number>();
    for (const s of result.songs) {
      if (s.seed) continue;
      for (const g of new Set(s.track.genres)) if (!NOT_A_GENRE.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS);
    chipsEl.innerHTML = top
      .map(([g, n]) => `<button class="web__chip" type="button" data-genre="${esc(g)}" data-n="${n}" aria-pressed="${picked.has(g)}">${esc(g)} <span class="web__chip-n">${n}</span></button>`)
      .join("");
    show(chipsEl, top.length > 0);
    if (!panel.hidden) enterRows(chipsEl.children);
    renderChipHints();
  };

  /** Each chip's hint says what its number means now and what a press would do, counted
   *  with the Size and Prefer and the chips picked. It is written again on every change, and
   *  the hint box shows the new text at once if the pointer rests on the chip. No calls. */
  const renderChipHints = () => {
    if (!result) return;
    const r = result;
    const size = setting("webSize");
    const prefer = setting("webPrefer");
    const seedFilter = setting("webSeedFilter");
    const who = r.seed.name;
    const seedTracks = new Set(r.songs.filter((x) => x.seed).map((x) => x.track));
    /** The playlist the chips `set` would make: web songs of genre `g`, and the artist's songs. */
    const counts = (g: string, set: Set<string>) => {
      const list = pickSongs(r, set, size, prefer, seedFilter);
      const theirs = list.filter((t) => seedTracks.has(t)).length;
      return { web: list.filter((t) => !seedTracks.has(t) && t.genres.includes(g)).length, theirs };
    };
    // Short and direct (the Settings voice): the pool, then what goes in.
    // "66 R&B/Soul songs in the web. Pick it: 44 go in, with 6 by Samara Cyn"
    const theirs = (n: number) => (seedFilter === "off" ? `, with all of ${who}'s songs` : `, with ${n} by ${who}`);
    for (const chip of chipsEl.querySelectorAll<HTMLElement>(".web__chip")) {
      const g = chip.dataset.genre!;
      const pool = Number(chip.dataset.n);
      const has = `${pool} ${g} song${pool === 1 ? "" : "s"} in the web`;
      if (picked.has(g)) {
        const c = counts(g, picked);
        chip.title = `${has}. ${c.web} go in${theirs(c.theirs)}. Press again to drop it`;
      } else if (!picked.size) {
        const c = counts(g, new Set([g]));
        chip.title = `${has}. Pick it: ${c.web} go in${theirs(c.theirs)}`;
      } else {
        const c = counts(g, new Set([...picked, g]));
        chip.title = `${has}. Add it: ${c.web} go in${theirs(c.theirs)}`;
      }
    }
  };

  const renderReady = () => {
    if (!result) return;
    const list = pickSongs(result, picked, setting("webSize"), setting("webPrefer"), setting("webSeedFilter"));
    const n = list.length;
    const artists = result.artists.length;
    // With a genre picked and the artist's songs filtered, say how many of theirs are left:
    // a thin share is explained, not a surprise.
    let count = `${n} songs from ${artists} artist${artists === 1 ? "" : "s"}`;
    if (picked.size && setting("webSeedFilter") !== "off") {
      const seedTracks = new Set(result.songs.filter((x) => x.seed).map((x) => x.track));
      count += ` · ${list.filter((t) => seedTracks.has(t)).length} by ${result.seed.name}`;
    }
    const days = Math.floor((Date.now() - result.oldest) / DAY_MS);
    if (!n) setStatus("No songs match. Pick fewer genres");
    else if (result.failed) setStatus(`${count} · some artists didn't load`, "retry");
    else if (!result.calls) setStatus(`${count} · read ${days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`, "again");
    else setStatus(count);
    makeBtn.disabled = !n || making;
    renderChipHints();
  };

  /** `fresh`: read the web from Apple again instead of the saved reads. A Retry is a plain
   *  build: the saved reads that failed are read again, and only those. */
  const build = async (fresh = false) => {
    if (!seed?.catalogId) return;
    const mine = ++building;
    result = null;
    makeBtn.disabled = true;
    renderChips();
    setStatus("Reading the web…");
    try {
      const r = await invoke<WebResult>("web_build", { seedId: seed.catalogId, reach: setting("webReach"), fresh });
      if (mine !== building) return;
      result = r;
      // A genre the new web does not have cannot stay picked.
      const have = new Set(r.songs.flatMap((s) => s.track.genres));
      picked = new Set([...picked].filter((g) => have.has(g)));
      diag.log("web:build", { seed: r.seed.name, reach: setting("webReach"), fresh, artists: r.artists.length, songs: r.songs.length, calls: r.calls, failed: r.failed });
      renderChips();
      renderReady();
    } catch (e) {
      if (mine !== building) return;
      console.error("[web] build", e);
      setStatus("Couldn't read this artist's web. Try again");
    }
  };

  const pickSeed = (a: Artist) => {
    seed = a;
    rows = [];
    active = 0;
    picked = new Set();
    artistInput.value = "";
    artistInput.placeholder = "Find another artist";
    nameInput.value = `${a.name} Web`;
    renderRows(true);
    show(nameInput, true);
    show(makeBtn, true);
    void build();
  };

  /** The "Search Apple Music" row: one catalog search. Its artists replace the rows; a
   *  single answer is picked at once. `exact`: pick the answer with this name (a library
   *  artist with no song to resolve from). */
  const searchApple = async (term: string, exact?: string) => {
    setStatus("Searching Apple Music…");
    try {
      const r = await searchCatalog(term, ["artists"]);
      const hits = r.artists.filter((a) => a.catalogId).slice(0, MAX_HITS);
      const same = exact ? hits.filter((a) => a.name.toLowerCase() === exact.toLowerCase()) : [];
      if (same.length === 1) return pickSeed(same[0]);
      if (hits.length === 1) return pickSeed(hits[0]);
      rows = hits.map((artist) => ({ kind: "apple" as const, artist }));
      active = 0;
      renderRows(true);
      setStatus(hits.length ? "" : "Apple Music found no artist by that name");
    } catch (e) {
      console.error("[web] search", e);
      setStatus("Couldn't search Apple Music");
    }
  };

  /** A library artist: their Apple id comes from a song they lead — saved after the first
   *  time (`artist_catalog`), so 0 or 1 call. With no such song, Apple is searched by name. */
  const pickLibrary = async (lib: LibArtist) => {
    if (!lib.songId) return searchApple(lib.name, lib.name);
    setStatus("Finding the artist on Apple Music…");
    try {
      const info = await invoke<{ catalogId?: string; artwork?: Artwork } | null>("library_artist_info", {
        name: lib.name,
        songId: lib.songId,
        featured: false,
      });
      if (!info?.catalogId) return searchApple(lib.name, lib.name);
      if (info.artwork) photos.set(lib.name, info.artwork);
      pickSeed({ name: lib.name, catalogId: info.catalogId, artwork: info.artwork ?? lib.cover });
    } catch (e) {
      console.error("[web] library artist", e);
      setStatus("Couldn't find this artist on Apple Music");
    }
  };

  const activate = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === "search") void searchApple(r.term);
    else if (r.kind === "library") void pickLibrary(r.lib);
    else pickSeed(r.artist);
  };

  const make = async () => {
    if (!result || making) return;
    const tracks = pickSongs(result, picked, setting("webSize"), setting("webPrefer"), setting("webSeedFilter"));
    const name = nameInput.value.trim() || `${result.seed.name} Web`;
    if (!tracks.length) return;
    making = true;
    makeBtn.disabled = true;
    makeBtn.textContent = "Making…";
    let id: number;
    try {
      // Made first (local, a few ms): only a playlist that exists flies. A failure keeps the panel.
      id = await playlistCreate(name);
      await playlistAddTracks(id, tracks);
    } catch (e) {
      console.error("[web] make", e);
      toast({ kind: "warn", text: "Couldn't make the web playlist." });
      return;
    } finally {
      making = false;
      makeBtn.textContent = "Make playlist";
      renderReady();
    }
    diag.log("web:make", { seed: result.seed.name, songs: tracks.length, genres: [...picked], prefer: setting("webPrefer") });
    // The chip flight (handoff.ts, ARTIST-VIEW.md §5): the picked artist row, with the song
    // count, flies to the Playlists card, and the playlist opens under the landing. The panel
    // shrinks into the row first or pops out as it lifts (Close on Make, `webMakeMotion`). The row must be on screen: typed text hides it, so clear the field first.
    if (artistInput.value) {
      artistInput.value = "";
      renderRows(false);
    }
    const tile = hitsEl.querySelector<HTMLElement>("[data-picked]");
    const open = () => requestOpenPlaylist(`local:${id}`, tracks);
    const fly = () => {
      if (tile) handOff(tile, "playlists", () => Promise.resolve(tracks), open, tracks.length, true);
      else open();
    };
    // Not tied to Animate card swaps (user's call 2026-09-16): no card changes place here.
    const moving = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (tile && moving && setting("webMakeMotion") === "shrink") return shrinkInto(tile, fly);
    fly();
    dropdown.close(); // after handOff copied the row: the copy lives on <body>
  };

  /** "Shrink to chip": the panel closes in on the picked artist row — its edges draw in to
   *  the row's edges while its other parts fade — and at the end the row's copy flies from
   *  exactly there. The panel then goes away at once (no pop out: nothing of it is left to see).
   *  Timing and curve: --web-shrink-dur / --web-shrink-ease. */
  const shrinkInto = (tile: HTMLElement, fly: () => void) => {
    tile.scrollIntoView({ block: "nearest" });
    const p = panel.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const from = `inset(0px 0px 0px 0px round ${cs.borderTopLeftRadius})`;
    const to =
      `inset(${t.top - p.top}px ${p.right - t.right}px ${p.bottom - t.bottom}px ${t.left - p.left}px ` +
      `round ${getComputedStyle(tile).borderTopLeftRadius})`;
    const dur = tokenMs("--web-shrink-dur");
    const easing = cs.getPropertyValue("--web-shrink-ease").trim() || "ease";
    frames.during("menu", dur + 100, "web-shrink");
    const anims: Animation[] = [panel.animate([{ clipPath: from }, { clipPath: to }], { duration: dur, easing, fill: "forwards" })];
    // Everything but the row fades; the fade ends early so the last part of the shrink is the row alone.
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(":scope > *, .web__hits > *"))) {
      if (el === tile || el.contains(tile)) continue;
      anims.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.6, easing, fill: "forwards" }));
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fly(); // the copy is made on the row, where the shrink ended
      panel.classList.add("web--gone"); // hidden at once: the pop-out transition is off for this close
      dropdown.close();
      requestAnimationFrame(() => {
        anims.forEach((a) => a.cancel());
        panel.classList.remove("web--gone");
      });
    };
    anims[0].onfinish = finish;
    window.setTimeout(finish, dur + 150); // a hidden window sends no finish
  };

  artistInput.addEventListener("input", () => {
    rows = localRows();
    active = 0;
    if (!artistInput.value.trim() && !seed) setStatus("");
    renderRows(false);
  });
  artistInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault(); // typed text alone never starts a web: Enter picks the marked row
      activate(rows[active]);
    }
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !makeBtn.disabled) void make();
  });
  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const hit = t.closest<HTMLElement>(".web__hit[data-i]");
    if (hit) {
      // Next task: picking rebuilds the rows, and the dropdown's document click must still
      // find the pressed row inside the panel, or it closes the panel.
      const r = rows[Number(hit.dataset.i)];
      window.setTimeout(() => activate(r));
      return;
    }
    const opt = t.closest<HTMLElement>(".web__opt");
    if (opt) {
      const seg = opt.closest<HTMLElement>("[data-seg]")!.dataset.seg;
      const v = opt.dataset.value!;
      if (seg === "reach") setSetting("webReach", Number(v) as 1 | 2 | 3);
      else if (seg === "size") setSetting("webSize", Number(v) as 25 | 50 | 100);
      else setSetting("webPrefer", v as WebPrefer);
      return;
    }
    if (t.closest(".web__again")) {
      void build(againBtn.dataset.action === "again");
      return;
    }
    const chip = t.closest<HTMLElement>(".web__chip");
    if (chip) {
      const g = chip.dataset.genre!;
      if (picked.has(g)) picked.delete(g);
      else picked.add(g);
      chip.setAttribute("aria-pressed", String(picked.has(g)));
      return renderReady();
    }
    if (t.closest(".web__make")) void make();
  });

  const offSettings = onSettingsChange((k) => {
    if (k !== "webReach" && k !== "webSize" && k !== "webPrefer" && k !== "webSeedFilter") return;
    renderSegs();
    if (k === "webReach") void build();
    else renderReady();
  });

  let unlisten: (() => void) | null = null;
  void listen<{ degree: number; artists: number }>("web-progress", (e) => {
    if (panel.hidden || result) return;
    const { degree, artists } = e.payload;
    setStatus(degree === 0 ? "Reading the artist…" : `Reading ${artists} artist${artists === 1 ? "" : "s"}, ${degree} step${degree === 1 ? "" : "s"} out…`);
  }).then((u) => (unlisten = u));

  const dropdown = makeDropdown({
    root: btn, // the panel lives on <body>, so it is its own hover region
    trigger: btn,
    panel,
    // While the playlist is being made, a click away or the pointer leaving does not close it.
    shouldStayOpen: (why) => making && (why === "away" || why === "leave" || why === "toggle"),
    onOpen: () => {
      renderSegs();
      // Zero calls: the earlier webs' artists and the library artist photos already saved.
      void Promise.all([
        invoke<Artist[]>("web_seeds").catch(() => [] as Artist[]),
        invoke<[string, Artwork][]>("artist_photos").catch(() => [] as [string, Artwork][]),
      ]).then(([s, p]) => {
        seeds = s;
        photos = new Map(p);
        if (!seed || artistInput.value.trim()) {
          rows = localRows();
          active = 0;
          renderRows(true);
        }
      });
      place();
      enterRows(Array.from(panel.children).filter((el) => !(el as HTMLElement).hidden));
      artistInput.focus();
    },
  });
  const onResize = () => place();
  window.addEventListener("resize", onResize);

  return () => {
    building++;
    offSettings();
    unlisten?.();
    window.removeEventListener("resize", onResize);
    dropdown.destroy();
    panel.remove();
  };
}
