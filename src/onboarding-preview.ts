// The Fashion page's preview player (docs/features/GRAND-OPENING.md §8b, his design 2026-10-22):
// the Now Playing card in a small box, playing "Time Bomb" by The Chainsmokers, with "Coffee"
// by Chioma before it and "serena joy" by Olivia Rodrigo after it, so each skin's song change
// shows (Press's record, Metal's drum and side covers, Happy's push, the others' slides).
//
// It is the real card, not a drawing of one, and no second app: Now Playing's own TEMPLATE, its
// own record (`mountVinyl`, per box), Metal's own drum (`ownPeek`, metal.ts — one of the only two
// callers, with the queue), the album light (`watchAlbumColor` with this preview's covers), and
// Happy, who pushes any player cover in a card (pet.ts). What is NOT real: no sound, no
// MusicKit, no queue; the clock is a timer; the box's background is a small stand-in for the
// skin's page layers (Ocean's swell, Glass's cover canvas, Happy's sky), which follow the real
// song and sit behind the page.
//
// The look: the box copies the page root's look attributes (skin, theme, the skin hooks and the
// skin settings) and is drawn as the stage (`data-surface="max"`), so the stage rules and
// Metal's peek rules — compound on the root — apply to it in any window size.
//
// The covers: the three songs are read from Apple's catalog once (`catalog_songs`, one call;
// his call: a look-up through the API, not saved links) and kept a month here. Since 2026-10-23
// this works before the sign-in too: the catalog needs only the developer token (apple.rs
// `catalog_songs`). Offline, the words show with the ♪ cover, and the next open tries again.

import { invoke } from "@tauri-apps/api/core";
import type { CardInstance } from "./cards";
import type { Track } from "./library";
import { TEMPLATE, GLYPH_NOTE, ICON_PLAY, ICON_PAUSE } from "./now-playing-card";
import { mountVinyl } from "./vinyl";
import { ownPeek } from "./metal";
import { watchAlbumColor } from "./album-color";
import { ownSea } from "./ocean";
import { artURL, coverArtPx } from "./queue-rows";
import { motionReduced } from "./motion";
import * as diag from "./diag";

/** The songs, his picks (2026-10-22): the words are his, the covers Apple's. */
const SONGS: { id: string; title: string; artist: string; album: string }[] = [
  { id: "1564322068", title: "Coffee", artist: "Chioma", album: "Coffee - Single" },
  { id: "1637995424", title: "Time Bomb", artist: "The Chainsmokers", album: "So Far So Good" },
  { id: "6803283192", title: "serena joy", artist: "Olivia Rodrigo", album: "serena joy - Single" },
];
const START = 1; // Time Bomb
/** Untouched this long, the preview steps to the next song by itself (his call: buttons + auto). */
const AUTO_MS = 7000;
/** A song's length when Apple's is not known yet. */
const FALLBACK_MS = 200_000;
const CACHE_KEY = "deets.onboarding.preview";
const CACHE_MS = 30 * 24 * 3600 * 1000;

/** The page sea's own markup (index.html `.ocean`): ocean.ts paints it through `ownSea`, so the
 *  preview's sea is the real one — the same bands, crests and neon, at its size. It shows only
 *  where the skin's sea hook is on (CSS `--ocean-display`). */
const SEA =
  `<div class="ocean" aria-hidden="true">` +
  ["far", "mid", "near"]
    .map((b) => `<div class="ocean__heave ocean__heave--${b}"><div class="ocean__bob ocean__bob--${b}"><div class="ocean__train ocean__train--${b}"><i class="ocean__neon"></i><i class="ocean__neon"></i></div></div></div>`)
    .join("") +
  `<div class="ocean__glow"></div><div class="ocean__ripples"></div></div>`;

/** The page root's look attributes the box copies: the skin and theme, the skin hooks, and the
 *  skin settings that change the card (record, drum, canvas, edges). */
const LOOK_ATTR = /^data-(skin|theme|hook-|metal-|press-|glass-|ocean-|happy-|fancy-|cyber-|bg-motion)/;

let tracks: Promise<Track[]> | null = null;
/** The three songs from the catalog: this page's store first, then one call. */
function loadTracks(): Promise<Track[]> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const c = raw ? (JSON.parse(raw) as { at: number; tracks: Track[] }) : null;
    if (c && Date.now() - c.at < CACHE_MS && c.tracks.length) return Promise.resolve(c.tracks);
  } catch {
    /* unreadable: ask again */
  }
  // Signed out, Rust reads the catalog of this region (the locale's, e.g. "en-US" → "us").
  let region: string | undefined;
  try {
    region = new Intl.Locale(navigator.language).maximize().region;
  } catch {
    /* no locale: Rust takes "us" */
  }
  tracks ??= invoke<Track[]>("catalog_songs", { ids: SONGS.map((s) => s.id), region })
    .then((t) => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tracks: t }));
      } catch {
        /* storage off: it asks again next time */
      }
      diag.log("onboarding:preview-songs", { got: t.length });
      return t;
    })
    .catch((e) => {
      tracks = null; // not signed in yet, or offline: the next open tries again
      diag.warn("onboarding:preview-songs", { e: String(e) });
      return [];
    });
  return tracks;
}

export function mountPreview(host: HTMLElement): CardInstance {
  const box = document.createElement("div");
  box.className = "onboarding__stagebox";
  box.dataset.surface = "max";
  box.setAttribute("aria-label", "A preview of the player in this look");
  // Its own ids: the real card's ids stay unique (and its masks keep their own targets).
  const markup = TEMPLATE.replace(/(id="|#)(np-|ap-cut-np)/g, (_m, a: string, b: string) => `${a}ob${b}`);
  box.innerHTML = `${SEA}<div class="onboarding__scene" aria-hidden="true"></div><section class="panel onboarding__np">${markup}</section>`;
  host.replaceChildren(box);

  const copyLook = () => {
    for (const a of [...box.attributes]) if (LOOK_ATTR.test(a.name)) box.removeAttribute(a.name);
    for (const a of [...document.documentElement.attributes]) if (LOOK_ATTR.test(a.name)) box.setAttribute(a.name, a.value);
  };
  copyLook();
  const lookWatch = new MutationObserver(copyLook);
  lookWatch.observe(document.documentElement, { attributes: true });

  const np = box.querySelector<HTMLElement>(".np")!;
  np.classList.remove("np--idle");
  const art = box.querySelector<HTMLElement>(".np__art")!;
  const titleEl = box.querySelector<HTMLElement>(".np__title-text")!;
  const artistEl = box.querySelector<HTMLElement>(".np__artist")!;
  const albumEl = box.querySelector<HTMLElement>(".np__album")!;
  const scrub = box.querySelector<HTMLElement>(".np__scrub")!;
  const [elapsedEl, remainEl] = [...box.querySelectorAll<HTMLElement>(".np__times > span")];
  const controls = [...box.querySelectorAll<HTMLButtonElement>(".np__controls .np__btn")];
  const [prevBtn, playBtn, nextBtn] = controls;
  // Only Previous, Play and Next answer; the rest of the card is the picture of itself.
  box.querySelectorAll<HTMLElement>(".np__left, .np__right, .np__vol, .np__close, .np__listen, .np__scrub").forEach((el) => (el.inert = true));

  let at = START;
  let byId = new Map<string, Track>();
  let playing = true;
  let pos = 0; // seconds into the song
  const cover = (i: number): string | null => artURL(byId.get(SONGS[i].id), coverArtPx());
  const durS = () => (byId.get(SONGS[at].id)?.durationMs ?? FALLBACK_MS) / 1000;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Ocean's sea, painted by ocean.ts (one of its only two seas), its glow from this cover.
  const sea = ownSea(box.querySelector<HTMLElement>(".ocean")!);
  const vinyl = mountVinyl(art, GLYPH_NOTE, { ownTurns: true }); // its songs stay out of the real card's turn guess
  // Metal's drum: this box's sides are the songs before and after, its song the one shown.
  const releasePeek = ownPeek(art, () => SONGS[at].id, (side) => cover((at + (side === "next" ? 1 : SONGS.length - 1)) % SONGS.length));
  // The album light, from this preview's cover.
  let colorChanged: (() => void) | null = null;
  const stopColor = watchAlbumColor(box, {
    now: () => ({ cover: byId.get(SONGS[at].id)?.artwork?.urlTemplate ?? null, catalogId: SONGS[at].id }),
    onChange: (cb) => { colorChanged = cb; return () => { colorChanged = null; }; },
  });

  const paintClock = () => {
    const d = durS();
    scrub.style.setProperty("--slider-fill", `${Math.min(100, (pos / d) * 100)}%`);
    elapsedEl.textContent = fmt(pos);
    remainEl.textContent = `-${fmt(Math.max(0, d - pos))}`;
    vinyl.position(pos, d, false);
  };
  const paintPlay = () => {
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pauses the preview" : "Plays the preview";
    vinyl.playing(playing);
  };
  /** Show song `at`. `back`: it came by Previous (the record and the drum turn the other way). */
  const show = (back?: boolean) => {
    const s = SONGS[at];
    titleEl.textContent = s.title;
    artistEl.textContent = byId.get(s.id)?.artistName ?? s.artist;
    albumEl.textContent = byId.get(s.id)?.albumName ?? s.album;
    const src = cover(at);
    box.style.setProperty("--ob-cover", src ? `url("${src}")` : "none");
    vinyl.show(`song:${s.id}`, src ?? undefined, back);
    colorChanged?.();
    sea.cover(byId.get(s.id)?.artwork?.urlTemplate ?? null, s.id);
    paintClock();
  };

  let autoTimer = 0;
  const armAuto = () => {
    window.clearTimeout(autoTimer);
    if (motionReduced()) return; // no motion asked for: it stays on the song the user picked
    autoTimer = window.setTimeout(() => { step(1); }, AUTO_MS);
  };
  const step = (dir: 1 | -1) => {
    at = (at + dir + SONGS.length) % SONGS.length;
    pos = 0;
    show(dir < 0);
    armAuto();
  };
  prevBtn.title = "Shows the song before this one";
  nextBtn.title = "Shows the next song";
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  playBtn.addEventListener("click", () => {
    playing = !playing;
    paintPlay();
    if (playing) armAuto();
    else window.clearTimeout(autoTimer);
  });

  // The clock: a second at a time while it plays; at the end, the next song.
  const tick = window.setInterval(() => {
    if (!playing || document.hidden) return;
    pos += 1;
    if (pos >= durS()) return step(1);
    paintClock();
  }, 1000);

  show();
  paintPlay();
  armAuto();
  void loadTracks().then((t) => {
    if (!box.isConnected || !t.length) return;
    byId = new Map(t.filter((x) => x.catalogId).map((x) => [x.catalogId!, x]));
    show(); // the same song: the cover arrives without a turn
  });

  return {
    destroy() {
      window.clearTimeout(autoTimer);
      window.clearInterval(tick);
      lookWatch.disconnect();
      releasePeek();
      stopColor();
      sea.destroy();
      vinyl.destroy();
      host.replaceChildren();
    },
  };
}
