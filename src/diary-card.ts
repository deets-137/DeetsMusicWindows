// Diary card (docs/features/DIARY.md) — an album journal. Pick an album, listen, and keep a
// note and a score for each song and for the album.
//
// Two views, the card's own (not the collection engine: the entry keeps a note panel fixed
// at its foot, fork 6B, and the engine scrolls the whole pane):
//  • Root (fork 4A): the + cover, which opens the album picker in place (5A), and a shelf of
//    past entries under it, the newest touched first.
//  • Entry: the hero, the album's score, scale and review date, the album note, Play /
//    Shuffle, the songs — and the foot panel for ONE song: the song that plays, or the row
//    you click (6B).
// Three ways in: the picker (5A), an album dropped on the card (5B), Add to Diary on any
// album's menu (5C, layout-bus `requestDiaryAlbum`).
//
// A score is the number the user typed (7B). A scale change never rescales by itself:
// Settings › Diary › Rescale scores decides — Ask (a toast), Always, Never.

import "./styles/qcard.css";
import "./styles/diary.css";
import type { CardDef, CardInstance, MountOpts } from "./cards";
import type { Track } from "./library";
import type { Album } from "./search";
import { searchCatalog, collectionTracks, materializeTrack } from "./search";
import { tracks as storeTracks, addTransientTracks } from "./track-store";
import { albumKey } from "./rewind";
import { albumOrder, heroCover } from "./library-card";
import { esc, actionsRowHTML, runListAction } from "./collection-card";
import { openContextMenu, openContextMenuUnder, MENU_CHOSEN, type MenuItem } from "./context-menu";
import { albumMenu } from "./media-menu";
import { playTracks } from "./player";
import * as queue from "./queue";
import { registerDropTarget, type DragPayload } from "./row-drag";
import { takeDiaryAlbum, onDiaryAlbum, type DiaryRequest } from "./layout-bus";
import { enterRows } from "./pop";
import { toast } from "./toast";
import { setting } from "./settings-store";
import { unreleasedHint } from "./release";
import * as diag from "./diag";
import {
  diaryList, diaryGet, diaryOpen, diaryUpdate, diarySongSet, diaryRescale, diaryDelete, onDiaryChange,
  songKeyOf, parseScore, fmtNum, fmtScore, fmtDay, today,
  type DiaryEntry, type DiarySummary, type DiarySong,
} from "./diary";

const TILE_PX = 240;
const ROW_PX = 72;
const PICK_DEBOUNCE_MS = 300;
const PICK_LIB_CAP = 8;
const PICK_CAT_CAP = 10;
const NOTE_SAVE_MS = 600;
/** The scale presets (fork 7). Any other top is typed into the menu's field. */
const SCALES = [10, 5, 100];

const art = (tmpl: string | undefined, px: number): string | null =>
  tmpl ? tmpl.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;
const coverHTML = (url: string | null, cls: string): string =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
    : `<div class="${cls} ${cls}--empty" aria-hidden="true">♪</div>`;

const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
const ICON_NOTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M3 6.5h10M3 10h6" /></svg>';
const ICON_SEARCH = '<svg class="search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>';
const ICON_CLEAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CARET = '<svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>';

/** What a pick, a drop or a menu hands the card before the songs are known. */
interface AlbumIn {
  album: Album;
  tracks: () => Track[] | Promise<Track[]>;
}

/** The Album shape diary.rs stores (genres is required there). */
const albumOf = (a: DiaryRequest["album"]): Album => ({
  title: a.title,
  artistName: a.artistName,
  artwork: a.artwork,
  catalogId: a.catalogId,
  libraryId: a.libraryId,
  releaseDate: a.releaseDate,
  genres: [],
});

/** The user's library albums (the Library card's album rule: name + cover), for the picker. */
function libraryAlbums(): { album: Album; tracks: Track[] }[] {
  const groups = new Map<string, Track[]>();
  for (const t of storeTracks()) {
    if (!t.libraryId) continue; // a catalog song the app only saw played is not "your library"
    const k = albumKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.values()].map((ts) => {
    const t0 = ts[0];
    return {
      album: { title: t0.albumName ?? "Unknown Album", artistName: t0.artistName, artwork: t0.artwork, genres: [], releaseDate: t0.releaseDate },
      tracks: albumOrder(ts),
    };
  });
}

export const diaryCard: CardDef = {
  id: "diary",
  title: "Diary",
  mount: (host, opts) => mountDiary(host, opts),
};

function mountDiary(host: HTMLElement, opts?: MountOpts): CardInstance {
  host.innerHTML = `
    <header class="panel__head">
      <button class="panel__back" id="diary-back" type="button" aria-label="Back" title="Goes back one step" hidden>${ICON_BACK}</button>
      <h2 class="panel__title">Diary</h2>
    </header>
    <div class="panel__body diary"></div>`;
  const backEl = host.querySelector<HTMLButtonElement>("#diary-back")!;
  const titleEl = host.querySelector<HTMLElement>(".panel__title")!;
  const body = host.querySelector<HTMLElement>(".diary")!;

  let entry: DiaryEntry | null = null;
  let list: DiarySummary[] = [];
  let picking = false;
  let pickTerm = "";
  let pickSeq = 0; // stale-search guard: only the latest Apple search may draw
  let rootSeq = 0; // stale-list guard for the root
  /** The song the foot panel shows (6B), by song key. */
  let selKey: string | null = null;
  /** A song change that waits while the user is typing in the foot. */
  let pendingSel: string | null = null;
  let destroyed = false;
  const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();

  const setHeader = () => {
    const atRoot = !entry;
    titleEl.textContent = atRoot ? "Diary" : "Entry";
    backEl.hidden = atRoot;
    headerSubs.forEach((cb) => cb({ title: titleEl.textContent ?? "Diary", atRoot }));
  };

  // ── the root: the + cover (or the picker) and the shelf ────────────────────────
  const tileHTML = (s: DiarySummary): string => {
    const score = fmtScore(s.score, s.scaleMax);
    const done = s.songCount ? `${s.songsDone} of ${s.songCount} songs` : "";
    const sub = [score, done].filter(Boolean).join(" · ") || s.album.artistName;
    return `<div class="search__tile" data-entry="${s.id}" role="button" tabindex="0" title="${esc(`${s.album.title} — ${s.album.artistName}`)}">
      ${coverHTML(art(s.album.artwork?.urlTemplate, TILE_PX), "search__tile-art")}
      <span class="search__tile-name">${esc(s.album.title)}</span><span class="search__tile-sub">${esc(sub)}</span>
    </div>`;
  };
  const newHTML = () =>
    `<button class="diary__new" type="button" data-new title="Pick an album to write about">
      <span class="diary__new-art">${ICON_PLUS}</span><span class="diary__new-label">Add an album</span>
    </button>`;
  const pickerHTML = () =>
    `<div class="diary__pick">
      <div class="search__field">
        ${ICON_SEARCH}
        <input class="search__input" type="search" placeholder="Find an album or an artist" spellcheck="false" data-pick-input value="${esc(pickTerm)}" />
        <button class="search__clear" type="button" data-pick-close aria-label="Close" title="Closes the album search">${ICON_CLEAR}</button>
      </div>
      <div class="diary__results" data-pick-results><p class="qcard__empty">Type an album or an artist. Your library shows first, then Apple Music.</p></div>
    </div>`;

  const renderRoot = () => {
    const seq = ++rootSeq;
    diaryList()
      .then((l) => {
        if (destroyed || entry || seq !== rootSeq) return;
        list = l;
        const shelf = l.length
          ? `<div class="qcard__label">Your entries</div><div class="search__scroller diary__shelf">${l.map(tileHTML).join("")}</div>`
          : `<p class="qcard__empty">Pick an album, listen, and write about each song.</p>`;
        body.innerHTML = `<div class="diary__root app-scroll">${picking ? pickerHTML() : newHTML()}${shelf}</div>`;
        if (picking) {
          const input = body.querySelector<HTMLInputElement>("[data-pick-input]")!;
          input.focus();
          if (pickTerm) runPick(pickTerm);
        }
      })
      .catch((e) => {
        console.error("[diary] list", e);
        body.innerHTML = `<p class="qcard__empty">Couldn't read your Diary.</p>`;
      });
  };

  // The picker (5A): the library first (zero Apple calls), then Apple Music (one search).
  let pickTimer = 0;
  let pickFound: AlbumIn[] = [];
  const pickRow = (a: Album, i: number, sub: string) =>
    `<div class="search__row" data-pick="${i}" role="button" tabindex="0">
      ${coverHTML(art(a.artwork?.urlTemplate, ROW_PX), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(a.title)}</span><span class="search__song-artist">${esc(sub)}</span></div>
    </div>`;
  const runPick = (term: string) => {
    const results = body.querySelector<HTMLElement>("[data-pick-results]");
    if (!results) return;
    const q = term.trim().toLowerCase();
    if (!q) {
      results.innerHTML = `<p class="qcard__empty">Type an album or an artist. Your library shows first, then Apple Music.</p>`;
      return;
    }
    const lib = libraryAlbums()
      .filter((x) => x.album.title.toLowerCase().includes(q) || x.album.artistName.toLowerCase().includes(q))
      .slice(0, PICK_LIB_CAP);
    pickFound = lib.map((x) => ({ album: x.album, tracks: () => x.tracks }));
    const draw = (cat: Album[] | null) => {
      if (!body.contains(results)) return;
      const catIn: AlbumIn[] = (cat ?? []).map((a) => ({ album: { ...a, genres: [] }, tracks: () => collectionTracks("albums", a.catalogId ?? "") }));
      pickFound = [...lib.map((x) => ({ album: x.album, tracks: () => x.tracks })), ...catIn];
      const libHTML = lib.length
        ? `<div class="qcard__label">In your library</div>${lib.map((x, i) => pickRow(x.album, i, x.album.artistName)).join("")}`
        : "";
      const catHTML =
        cat === null
          ? `<p class="qcard__empty">Searching Apple Music…</p>`
          : cat.length
            ? `<div class="qcard__label">Apple Music</div>${cat.map((a, i) => pickRow(a, lib.length + i, [a.artistName, a.releaseDate?.slice(0, 4)].filter(Boolean).join(" · "))).join("")}`
            : lib.length
              ? ""
              : `<p class="qcard__empty">No album found.</p>`;
      results.innerHTML = libHTML + catHTML;
      if (cat !== null) enterRows(results.querySelectorAll(".search__row"));
    };
    draw(null);
    const seq = ++pickSeq;
    searchCatalog(term.trim(), ["albums"])
      .then((r) => {
        if (seq === pickSeq && !destroyed) draw(r.albums.filter((a) => a.catalogId).slice(0, PICK_CAT_CAP));
      })
      .catch((e) => {
        console.warn("[diary] search", e);
        if (seq === pickSeq && !destroyed) draw([]);
      });
  };
  const closePicker = () => {
    picking = false;
    pickTerm = "";
    renderRoot();
  };

  // ── opening an album (all three ways in land here) ─────────────────────────────
  const openAlbum = (a: AlbumIn, how: string) => {
    picking = false;
    pickTerm = "";
    body.innerHTML = `<p class="qcard__empty">Opening ${esc(a.album.title)}…</p>`;
    diag.log("ui:act", { at: "diary", do: "open", how });
    Promise.resolve(a.tracks())
      .then((ts) => diaryOpen(a.album, ts))
      .then((e) => showEntry(e))
      .catch((e) => {
        console.error("[diary] open", e);
        toast({ kind: "warn", text: `Couldn't open “${a.album.title}” in your Diary.` });
        entry = null;
        setHeader();
        renderRoot();
      });
  };
  const openEntry = (id: number) =>
    diaryGet(id)
      .then(showEntry)
      .catch((e) => {
        console.warn("[diary] entry gone", id, e);
        entry = null;
        setHeader();
        renderRoot();
      });

  // ── the entry ──────────────────────────────────────────────────────────────────
  const songOf = (key: string | null): Track | undefined => (entry && key ? entry.tracks.find((t) => songKeyOf(t) === key) : undefined);
  const noteOf = (key: string): DiarySong | undefined => entry?.songs.find((s) => s.songKey === key);

  /** The playing song, when it is on this album (6B: the foot follows it). */
  const playingKey = (): string | null => {
    const cur = queue.getCurrent();
    if (!entry || !cur) return null;
    const t = entry.tracks.find(
      (x) => (cur.catalogId && x.catalogId === cur.catalogId) || (cur.libraryId && x.libraryId === cur.libraryId),
    );
    return t ? songKeyOf(t) : null;
  };

  const scoreFieldHTML = (which: "album" | "song", value: number | undefined, max: number, label: string) => {
    const over = value != null && value > max;
    return `<label class="diary__score${over ? " is-over" : ""}" title="${esc(
      over ? `Above this scale's top of ${fmtNum(max)}. Type a new score, or rescale` : `${label}: any number from 0 to ${fmtNum(max)}`,
    )}">
      <input class="diary__score-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
        data-score="${which}" value="${value == null ? "" : esc(fmtNum(value))}" placeholder="–" aria-label="${esc(label)}" />
      <span class="diary__score-max">/ ${esc(fmtNum(max))}</span>
    </label>`;
  };
  const dateHTML = (which: "album" | "song", day: string | undefined, hint: string) =>
    `<button class="lib-pill diary__date" type="button" data-date="${which}" aria-haspopup="true" title="${esc(hint)}">
      <span class="lib-pill__label">${esc(day ? fmtDay(day) : "No date")}</span>${CARET}
    </button>`;

  const songRowHTML = (t: Track, i: number): string => {
    const key = songKeyOf(t);
    const n = noteOf(key);
    const sel = key === selKey;
    const playing = key === playingKey();
    const cls = ["search__row", "diary__song", sel ? "is-sel" : "", playing ? "is-playing" : "", t.unreleased ? "is-unreleased" : ""].filter(Boolean).join(" ");
    const hint = t.unreleased ? unreleasedHint(t) : "Shows this song's note below. Double-click plays the album from here";
    const artist = entry && t.artistName !== entry.album.artistName ? `<span class="search__song-artist">${esc(t.artistName)}</span>` : "";
    return `<li class="${cls}" data-song-i="${i}" role="button" tabindex="0" title="${esc(hint)}"${sel ? ' aria-current="true"' : ""}>
      <span class="diary__num">${t.trackNumber ?? i + 1}</span>
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}</span>${artist}</div>
      ${n?.note ? `<span class="diary__mark" aria-label="Has a note">${ICON_NOTE}</span>` : ""}
      <span class="diary__row-score${n?.score != null && entry && n.score > entry.scaleMax ? " is-over" : ""}">${n?.score != null ? esc(fmtNum(n.score)) : ""}</span>
    </li>`;
  };

  const footHTML = (): string => {
    const t = songOf(selKey);
    if (!entry || !t || !selKey) return "";
    const n = noteOf(selKey);
    const follow = selKey === playingKey();
    return `<div class="diary__foot" data-foot>
      <div class="diary__foot-head">
        <button class="panel__action diary__foot-play" type="button" data-foot-play aria-label="Play from this song" title="Plays the album from this song">${ICON_PLAY}</button>
        <span class="diary__foot-title" title="${esc(follow ? "The song that plays. The panel follows it" : "The row you picked")}">${esc(`${t.trackNumber ?? ""}${t.trackNumber ? " · " : ""}${t.title}`)}</span>
        ${scoreFieldHTML("song", n?.score, entry.scaleMax, `Score for ${t.title}`)}
      </div>
      <textarea class="diary__note app-scroll" data-note="song" rows="3" placeholder="What you hear in this song" spellcheck="true">${esc(n?.note ?? "")}</textarea>
      <div class="diary__foot-line">
        ${dateHTML("song", n?.noteDate, "The day of this note. It is set when you first write one")}
      </div>
    </div>`;
  };

  const entryHTML = (e: DiaryEntry): string => {
    const written = e.songs.filter((s) => s.note || s.score != null).length;
    const meta = [`${e.tracks.length} song${e.tracks.length === 1 ? "" : "s"}`, written ? `${written} written` : ""].filter(Boolean).join(" · ");
    const hero = `<div class="lib-hero">${heroCover(e.album.artwork, e.album.title)}<span class="lib-hero__title">${esc(e.album.title)}</span>
      <span class="lib-hero__sub">${esc(e.album.artistName)}</span><span class="lib-hero__meta">${esc(meta)}</span></div>`;
    const album = `<div class="diary__album">
      <div class="diary__line">
        ${scoreFieldHTML("album", e.score, e.scaleMax, "Score for the album")}
        <button class="lib-pill diary__scale" type="button" data-scale aria-haspopup="true" title="The scale for this album: its songs and the album use it">
          <span class="lib-pill__label">Out of ${esc(fmtNum(e.scaleMax))}</span>${CARET}
        </button>
        ${dateHTML("album", e.reviewDate, "The day of this review")}
      </div>
      <textarea class="diary__note app-scroll" data-note="album" rows="3" placeholder="What you think of the album" spellcheck="true">${esc(e.note)}</textarea>
    </div>`;
    const playable = e.tracks.some((t) => !t.unreleased);
    return `<div class="diary__entry">
      <div class="diary__scroll app-scroll">
        ${hero}${album}
        ${actionsRowHTML({ play: "Play the album in order", shuffle: "Shuffle the album" }, !playable)}
        <ol class="diary__songs">${e.tracks.map(songRowHTML).join("")}</ol>
      </div>
      ${footHTML()}
    </div>`;
  };

  /** Redraw the entry, keeping the list's scroll. */
  const renderEntry = (enter = false) => {
    if (!entry) return;
    const sc = body.querySelector<HTMLElement>(".diary__scroll");
    const top = sc?.scrollTop ?? 0;
    body.innerHTML = entryHTML(entry);
    const next = body.querySelector<HTMLElement>(".diary__scroll");
    if (next) next.scrollTop = top;
    if (enter) enterRows(body.querySelectorAll(".diary__song"));
  };

  /** Redraw only the rows and the foot (a note saved, the song changed) — never the field in focus. */
  const renderRows = () => {
    if (!entry) return;
    const ol = body.querySelector<HTMLElement>(".diary__songs");
    if (ol) ol.innerHTML = entry.tracks.map(songRowHTML).join("");
  };
  const renderFoot = () => {
    const old = body.querySelector<HTMLElement>("[data-foot]");
    const html = footHTML();
    if (old) {
      if (html) old.outerHTML = html;
      else old.remove();
    } else if (html) body.querySelector(".diary__entry")?.insertAdjacentHTML("beforeend", html);
  };

  const select = (key: string | null) => {
    if (key === selKey) return;
    const foot = body.querySelector<HTMLElement>("[data-foot]");
    if (foot?.contains(document.activeElement)) {
      pendingSel = key; // never swap the song under a note being typed
      return;
    }
    selKey = key;
    renderRows();
    renderFoot();
  };

  const showEntry = (e: DiaryEntry) => {
    if (destroyed) return;
    const first = entry?.id !== e.id;
    entry = e;
    if (first) selKey = playingKey() ?? (e.tracks[0] ? songKeyOf(e.tracks[0]) : null);
    setHeader();
    renderEntry(first);
    // A pre-release album: ask Apple once for the songs that came out since (release.ts).
    const cid = e.album.catalogId;
    if (first && cid && e.tracks.some((t) => t.unreleased)) {
      collectionTracks("albums", cid)
        .then((ts) => {
          const was = e.tracks.filter((t) => t.unreleased).length;
          const now = ts.filter((t) => t.unreleased).length;
          if (entry?.id === e.id && ts.length && now !== was) return diaryOpen(e.album, ts).then(showEntry);
        })
        .catch((err) => console.warn("[diary] refresh", err));
    }
  };

  // ── saving ─────────────────────────────────────────────────────────────────────
  const setScore = (input: HTMLInputElement) => {
    if (!entry) return;
    const e = entry;
    const which = input.dataset.score;
    const v = parseScore(input.value);
    const label = input.closest<HTMLElement>(".diary__score");
    const bad = (msg: string) => {
      label?.setAttribute("data-bad", "");
      if (label) label.title = msg;
    };
    if (v !== null && (Number.isNaN(v) || v > e.scaleMax)) {
      bad(`Type a number from 0 to ${fmtNum(e.scaleMax)}`);
      return;
    }
    label?.removeAttribute("data-bad");
    label?.classList.remove("is-over");
    if (which === "album") {
      if (v === (e.score ?? null)) return;
      e.score = v ?? undefined;
      void diaryUpdate(e.id, { score: v }).catch(saveFailed);
    } else if (selKey) {
      const key = selKey;
      const n = noteOf(key);
      if (v === (n?.score ?? null)) return;
      upsertSong(key, { score: v ?? undefined });
      renderRows();
      void diarySongSet(e.id, key, { score: v }).catch(saveFailed);
    }
    input.value = v == null ? "" : fmtNum(v);
  };

  /** Keep the local copy in step with what was written, so a redraw shows it at once. */
  const upsertSong = (key: string, patch: Partial<DiarySong>) => {
    if (!entry) return;
    const i = entry.songs.findIndex((s) => s.songKey === key);
    const next: DiarySong = { songKey: key, note: "", updatedAt: Date.now(), ...(i >= 0 ? entry.songs[i] : {}), ...patch };
    if ("score" in patch && patch.score === undefined) delete next.score;
    if ("noteDate" in patch && patch.noteDate === undefined) delete next.noteDate;
    if (i >= 0) entry.songs[i] = next;
    else entry.songs.push(next);
  };

  let noteTimer = 0;
  let noteTarget: HTMLTextAreaElement | null = null;
  const flushNote = () => {
    window.clearTimeout(noteTimer);
    const ta = noteTarget;
    noteTarget = null;
    if (!ta || !entry) return;
    const e = entry;
    const text = ta.value;
    if (ta.dataset.note === "album") {
      if (text === e.note) return;
      e.note = text;
      void diaryUpdate(e.id, { note: text }).catch(saveFailed);
      return;
    }
    const key = ta.dataset.songKey;
    if (!key) return;
    const n = noteOf(key);
    if (text === (n?.note ?? "")) return;
    // The note's day is set when the first word goes in (8B); you can change or clear it.
    const stamp = text && !n?.note && !n?.noteDate ? today() : undefined;
    upsertSong(key, stamp ? { note: text, noteDate: stamp } : { note: text });
    renderRows();
    if (stamp) {
      const pill = body.querySelector<HTMLElement>('[data-date="song"] .lib-pill__label');
      if (pill && key === selKey) pill.textContent = fmtDay(stamp);
    }
    void diarySongSet(e.id, key, stamp ? { note: text, noteDate: stamp } : { note: text }).catch(saveFailed);
  };
  function saveFailed(e: unknown) {
    console.error("[diary] save", e);
    toast({ kind: "warn", text: "Couldn't save that to your Diary." });
  }

  // ── the scale (fork 7B) ────────────────────────────────────────────────────────
  const scoreCount = (e: DiaryEntry) => (e.score != null ? 1 : 0) + e.songs.filter((s) => s.score != null).length;
  const changeScale = (to: number) => {
    if (!entry || !(to > 0) || !Number.isFinite(to)) return;
    const e = entry;
    const from = e.scaleMax;
    if (to === from) return;
    const n = scoreCount(e);
    const mode = setting("diaryRescale");
    diag.log("ui:act", { at: "diary", do: "scale", n, mode });
    const rescaleLocal = () => {
      const k = to / from;
      if (e.score != null) e.score *= k;
      e.songs.forEach((s) => {
        if (s.score != null) s.score *= k;
      });
    };
    if (n && mode === "always") {
      rescaleLocal();
      e.scaleMax = to;
      renderEntry();
      void diaryRescale(e.id, from, to).catch(saveFailed);
      return;
    }
    // Ask or Never: the scale changes, the numbers stay as typed. A score above the new top is marked.
    e.scaleMax = to;
    renderEntry();
    void diaryUpdate(e.id, { scaleMax: to }).catch(saveFailed);
    if (!n || mode === "never") return;
    toast({
      kind: "info",
      sticky: true,
      text: `“${e.album.title}” is now out of ${fmtNum(to)}. Rescale its ${n} score${n === 1 ? "" : "s"} too? ${fmtNum(from * 0.7)}/${fmtNum(from)} becomes ${fmtNum(to * 0.7)}/${fmtNum(to)}.`,
      actions: [
        {
          label: "Rescale",
          run: () => {
            diag.log("ui:act", { at: "diary", do: "rescale" });
            void diaryRescale(e.id, from, to)
              .then(() => (entry?.id === e.id ? diaryGet(e.id).then(showEntry) : undefined))
              .catch(saveFailed);
          },
        },
        { label: "Keep numbers" },
      ],
    });
  };

  const scaleMenu = (): MenuItem[] => {
    const cur = entry?.scaleMax;
    return [
      ...SCALES.map((m) => ({ label: `Out of ${m}`, badge: cur === m ? MENU_CHOSEN : undefined, run: () => changeScale(m) })),
      {
        input: {
          label: "Your own top",
          placeholder: "Any number above 0",
          value: cur != null && !SCALES.includes(cur) ? fmtNum(cur) : "",
          onSubmit: (raw: string) => {
            const v = parseScore(raw);
            if (v == null || Number.isNaN(v) || v <= 0) {
              toast({ kind: "warn", text: "A scale's top is a number above 0." });
              return;
            }
            changeScale(v);
          },
        },
      },
    ];
  };

  // ── dates (8B): the review's day, and each song note's day ─────────────────────
  const setDay = (which: "album" | "song", day: string | null) => {
    if (!entry) return;
    const e = entry;
    if (which === "album") {
      e.reviewDate = day ?? undefined;
      void diaryUpdate(e.id, { reviewDate: day }).catch(saveFailed);
    } else if (selKey) {
      upsertSong(selKey, { noteDate: day ?? undefined });
      void diarySongSet(e.id, selKey, { noteDate: day }).catch(saveFailed);
    }
    const pill = body.querySelector<HTMLElement>(`[data-date="${which}"] .lib-pill__label`);
    if (pill) pill.textContent = day ? fmtDay(day) : "No date";
  };
  /** The system date picker, from a field that is never seen. */
  const pickDay = (which: "album" | "song", anchor: HTMLElement) => {
    const input = document.createElement("input");
    input.type = "date";
    input.className = "diary__date-input";
    input.value = (which === "album" ? entry?.reviewDate : selKey ? noteOf(selKey)?.noteDate : undefined) ?? today();
    anchor.appendChild(input);
    input.addEventListener("change", () => {
      if (input.value) setDay(which, input.value);
      input.remove();
    });
    input.addEventListener("blur", () => window.setTimeout(() => input.remove(), 0));
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };
  const dateMenu = (which: "album" | "song", anchor: HTMLElement): MenuItem[] => [
    { label: "Today", run: () => setDay(which, today()) },
    { label: "Pick a date…", run: () => pickDay(which, anchor) },
    { label: "No date", run: () => setDay(which, null) },
  ];

  // ── playing ────────────────────────────────────────────────────────────────────
  const playFrom = (e: DiaryEntry, list: Track[], i: number) => {
    const ts = list.filter((t) => !t.unreleased);
    addTransientTracks(ts);
    ts.forEach(materializeTrack);
    playTracks(list, i, `diary:${e.id}`).catch((err) => console.error("[diary] play", err));
  };

  // ── delete (a sticky ask: it is the user's own writing) ────────────────────────
  const askDelete = (id: number, title: string) =>
    toast({
      kind: "warn",
      sticky: true,
      text: `Delete your Diary entry for “${title}”? Its notes and scores go with it.`,
      actions: [
        {
          label: "Delete",
          run: () =>
            void diaryDelete(id)
              .then(() => {
                if (entry?.id === id) {
                  entry = null;
                  setHeader();
                  renderRoot();
                }
              })
              .catch(saveFailed),
        },
        { label: "Keep" },
      ],
    });

  const entryMenu = (s: { id: number; album: Album; tracks: () => Track[] | Promise<Track[]> }): MenuItem[] =>
    albumMenu(
      { title: s.album.title, artistName: s.album.artistName, artwork: s.album.artwork, catalogId: s.album.catalogId, known: [], whole: () => Promise.resolve(s.tracks()), catalog: !!s.album.catalogId, pinKey: null },
      { context: `diary:${s.id}`, inDiary: true, away: [{ label: "Delete entry", run: () => askDelete(s.id, s.album.title) }] },
    );

  // ── events ─────────────────────────────────────────────────────────────────────
  backEl.addEventListener("click", () => {
    flushNote();
    entry = null;
    selKey = null;
    setHeader();
    renderRoot();
  });

  body.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (!entry) {
      if (target.closest("[data-new]")) {
        picking = true;
        renderRoot();
        return;
      }
      if (target.closest("[data-pick-close]")) {
        closePicker();
        return;
      }
      const pick = target.closest<HTMLElement>("[data-pick]");
      if (pick) {
        const a = pickFound[Number(pick.dataset.pick)];
        if (a) openAlbum(a, "pick");
        return;
      }
      const tile = target.closest<HTMLElement>("[data-entry]");
      if (tile) void openEntry(Number(tile.dataset.entry));
      return;
    }
    const e = entry;
    const act = target.closest<HTMLElement>("[data-act]");
    if (act) {
      diag.log("ui:act", { at: "diary", do: act.dataset.act ?? "", n: e.tracks.length });
      runListAction(act.dataset.act ?? "", e.tracks.filter((t) => !t.unreleased), (l) => playFrom(e, l, 0));
      return;
    }
    if (target.closest("[data-foot-play]")) {
      const i = e.tracks.findIndex((t) => songKeyOf(t) === selKey);
      if (i >= 0) playFrom(e, e.tracks, i);
      return;
    }
    const scale = target.closest<HTMLElement>("[data-scale]");
    if (scale) {
      ev.stopPropagation();
      scale.setAttribute("aria-expanded", "true");
      openContextMenuUnder(scale, scaleMenu(), () => scale.setAttribute("aria-expanded", "false"));
      return;
    }
    const date = target.closest<HTMLElement>("[data-date]");
    if (date) {
      ev.stopPropagation();
      const which = date.dataset.date as "album" | "song";
      date.setAttribute("aria-expanded", "true");
      openContextMenuUnder(date, dateMenu(which, date), () => date.setAttribute("aria-expanded", "false"));
      return;
    }
    const row = target.closest<HTMLElement>("[data-song-i]");
    if (row) {
      const t = e.tracks[Number(row.dataset.songI)];
      if (t) select(songKeyOf(t));
    }
  });

  body.addEventListener("dblclick", (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-song-i]");
    if (!row || !entry) return;
    playFrom(entry, entry.tracks, Number(row.dataset.songI));
  });

  body.addEventListener("input", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-pick-input]")) {
      pickTerm = (target as HTMLInputElement).value;
      window.clearTimeout(pickTimer);
      pickTimer = window.setTimeout(() => runPick(pickTerm), PICK_DEBOUNCE_MS);
      return;
    }
    if (target.matches("[data-note]")) {
      const ta = target as HTMLTextAreaElement;
      if (noteTarget && noteTarget !== ta) flushNote();
      if (ta.dataset.note === "song" && !ta.dataset.songKey) ta.dataset.songKey = selKey ?? "";
      noteTarget = ta;
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(flushNote, NOTE_SAVE_MS);
      return;
    }
    if (target.matches("[data-score]")) target.closest(".diary__score")?.removeAttribute("data-bad");
  });

  body.addEventListener("focusin", (ev) => {
    const ta = (ev.target as HTMLElement).closest<HTMLTextAreaElement>('[data-note="song"]');
    if (ta) ta.dataset.songKey = selKey ?? ""; // the key the typing belongs to, fixed at focus
  });

  body.addEventListener("focusout", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-note]")) flushNote();
    if (target.matches("[data-score]")) setScore(target as HTMLInputElement);
    // The song changed while the foot had the focus: follow it once the focus leaves the foot.
    const foot = body.querySelector<HTMLElement>("[data-foot]");
    const to = (ev as FocusEvent).relatedTarget as Node | null;
    if (pendingSel !== null && foot && !(to && foot.contains(to))) {
      const k = pendingSel;
      pendingSel = null;
      window.setTimeout(() => select(k), 0);
    }
  });

  body.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-score]") && ev.key === "Enter") {
      ev.preventDefault();
      setScore(target as HTMLInputElement);
      return;
    }
    if (target.matches("[data-pick-input]") && ev.key === "Escape") {
      ev.preventDefault();
      closePicker();
      return;
    }
    if (ev.key === "Enter" && !target.matches("input, textarea")) {
      const tile = target.closest<HTMLElement>("[data-entry], [data-pick], [data-song-i]");
      if (tile) {
        ev.preventDefault();
        tile.click();
      }
    }
  });

  body.addEventListener("contextmenu", (ev) => {
    const target = ev.target as HTMLElement;
    const tile = target.closest<HTMLElement>("[data-entry]");
    if (tile && !entry) {
      const s = list.find((x) => x.id === Number(tile.dataset.entry));
      if (!s) return;
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, entryMenu({ id: s.id, album: s.album, tracks: () => diaryGet(s.id).then((e) => e.tracks) }));
      return;
    }
    if (entry && target.closest(".lib-hero")) {
      const e = entry;
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, entryMenu({ id: e.id, album: e.album, tracks: () => e.tracks }));
    }
  });

  // ── the three ways in: a held request (5C), a drop (5B) ────────────────────────
  const takeRequest = () => {
    const r = takeDiaryAlbum();
    if (r) {
      flushNote();
      openAlbum({ album: albumOf(r.album), tracks: r.tracks }, "menu");
    }
  };
  const unsubRequest = onDiaryAlbum(takeRequest);

  /** A dropped album's own facts come from its first song: a drag carries songs, not the album. */
  const openDrop = (p: DragPayload) => {
    flushNote();
    Promise.resolve(p.tracks())
      .then((ts) => {
        const t0 = ts[0];
        if (!t0) return;
        openAlbum(
          { album: { title: t0.albumName ?? "Unknown Album", artistName: t0.artistName, artwork: t0.artwork, catalogId: p.albumId, genres: [], releaseDate: t0.releaseDate }, tracks: () => ts },
          "drop",
        );
      })
      .catch((e) => console.error("[diary] drop", e));
  };
  const unregisterDrop = registerDropTarget({
    el: host,
    over: (_under, _x, _y, p) => (p.kind === "album" && p.source !== "diary" ? { highlight: host, drop: () => openDrop(p) } : null),
  });

  // ── live updates ───────────────────────────────────────────────────────────────
  // The song that plays moves the foot (6B) and the row mark.
  const unsubQueue = queue.onQueueChange(() => {
    if (!entry) return;
    const k = playingKey();
    if (k && k !== selKey) select(k);
    else renderRows();
  });
  // Another card's write (Add to Diary on an album already open, a delete) — the shelf redraws.
  const unsubDiary = onDiaryChange(() => {
    if (!entry && !picking) renderRoot();
  });

  // Card memory (CARD-MEMORY.md): the open entry, by id. A held request wins over it.
  const mem = opts?.memory as { entry?: number } | undefined;
  setHeader();
  if (mem?.entry) void openEntry(mem.entry);
  else renderRoot();
  takeRequest();

  return {
    destroy() {
      flushNote();
      destroyed = true;
      window.clearTimeout(pickTimer);
      unsubRequest();
      unsubQueue();
      unsubDiary();
      unregisterDrop();
      headerSubs.clear();
      host.innerHTML = "";
    },
    onHeaderChange(cb) {
      headerSubs.add(cb);
      cb({ title: titleEl.textContent ?? "Diary", atRoot: !entry });
      return () => headerSubs.delete(cb);
    },
    snapshot: () => (entry ? { entry: entry.id } : undefined),
  };
}
