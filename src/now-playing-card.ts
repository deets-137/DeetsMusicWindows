// Now Playing card — the transport strip (cover · title/artist · scrubber · prev/play/next),
// driven by real MusicKit playback state. Extracted from main.ts into the card registry so
// it can be mounted into a slot like any other card (in midi it's anchored to the top slot).
// Volume lives in the titlebar chrome, not here.

import { playPause, nextTrack, prevTrack, shuffleQueue, onPlayerState, onPlayerProgress, seekToFraction } from "./player";
import { makeSlider } from "./slider";
import { watchAlbumColor } from "./album-color";
import { requestCard } from "./layout-bus";
import * as queue from "./queue";
import { resolveEntry } from "./queue-rows";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem } from "./library-add";
import { startStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import type { CardDef } from "./cards";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';

const TEMPLATE = `
  <div class="np">
    <div class="np__aurora" aria-hidden="true"></div>
    <div class="np__art" id="np-art" aria-hidden="true">♪</div>
    <div class="np__center">
      <div class="np__meta">
        <span class="np__title" id="np-title">Not playing</span>
        <span class="np__artist" id="np-artist"></span>
      </div>
      <div class="np__scrub scrub">
        <div class="scrub__track"><div class="scrub__fill"></div></div>
        <span class="scrub__handle" aria-hidden="true"></span>
        <span class="np__live" aria-hidden="true">LIVE</span>
      </div>
      <div class="np__bottom">
        <button class="panel__action np__shuffle" id="np-shuffle" type="button" aria-label="Shuffle">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="16 3 21 3 21 8"></polyline>
            <line x1="4" y1="20" x2="21" y2="3"></line>
            <polyline points="21 16 21 21 16 21"></polyline>
            <line x1="15" y1="15" x2="21" y2="21"></line>
            <line x1="4" y1="4" x2="9" y2="9"></line>
          </svg>
        </button>
        <div class="np__controls">
          <button class="np__btn" type="button" aria-label="Previous">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6v12h2V6zM20 6 10 12 20 18z" /></svg>
          </button>
          <button class="np__btn np__btn--play" id="np-playpause" type="button" aria-label="Play">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button class="np__btn" type="button" aria-label="Next">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6 14 12 4 18zM16 6v12h2V6z" /></svg>
          </button>
        </div>
        <button class="panel__action np__summon" id="np-summon" type="button" aria-label="Show queue">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="3" y1="6" x2="13" y2="6"></line>
            <line x1="3" y1="12" x2="13" y2="12"></line>
            <line x1="3" y1="18" x2="13" y2="18"></line>
            <path d="M17 8.5 22 12 17 15.5z" fill="none"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>`;

export const nowPlayingCard: CardDef = {
  id: "now-playing",
  title: "Now Playing",
  mount(host) {
    host.innerHTML = TEMPLATE;

    const playBtn = host.querySelector<HTMLElement>("#np-playpause")!;
    const npArt = host.querySelector<HTMLElement>("#np-art");
    const npTitle = host.querySelector<HTMLElement>("#np-title");
    const npArtist = host.querySelector<HTMLElement>("#np-artist");
    const npEl2 = host.querySelector<HTMLElement>(".np");
    const prevBtn = host.querySelector<HTMLButtonElement>('.np__controls [aria-label="Previous"]');
    const nextBtn = host.querySelector<HTMLButtonElement>('.np__controls [aria-label="Next"]');

    // Drive the icon, title/artist, cover, and radio transport caps from playback
    // state. A LIVE station has no seek and no skip (STATIONS.md §1): `.np--live`
    // swaps the scrubber for a LIVE marker and the prev/next buttons disable.
    const unsubState = onPlayerState((s) => {
      playBtn.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      if (npTitle) npTitle.textContent = s.title ?? "Not playing";
      if (npArtist) npArtist.textContent = s.artist ?? (s.station ? s.station.name : "");
      if (npArt) npArt.innerHTML = s.artworkUrl ? `<img src="${s.artworkUrl}" alt="" data-art />` : "♪";
      const live = !!s.station?.live;
      npEl2?.classList.toggle("np--live", live);
      if (prevBtn) prevBtn.disabled = live;
      if (nextBtn) nextBtn.disabled = live;
    });

    playBtn.addEventListener("click", () => {
      playPause().catch((e) => console.error("[player] play/pause failed:", e));
    });

    // Prev / Next — native skip within MusicKit's fed window.
    host.querySelector<HTMLElement>('.np__controls [aria-label="Previous"]')?.addEventListener("click", () => {
      prevTrack().catch((e) => console.error("[player] prev failed:", e));
    });
    host.querySelector<HTMLElement>('.np__controls [aria-label="Next"]')?.addEventListener("click", () => {
      nextTrack().catch((e) => console.error("[player] next failed:", e));
    });

    // Shuffle — one-shot: manual picks to the top, auto tail shuffles; idle press
    // plays the whole library shuffled (see player.shuffleQueue / FUTURE-SETTINGS §5).
    host.querySelector<HTMLElement>("#np-shuffle")?.addEventListener("click", () => {
      shuffleQueue().catch((e) => console.error("[player] shuffle failed:", e));
    });

    // Queue summon — bring the Queue card into the least-recently-touched slot
    // (flips if it's already on-screen in the other slot; see layout.ts).
    host.querySelector<HTMLElement>("#np-summon")?.addEventListener("click", () => requestCard("queue"));

    // Right-click the song identity (cover / title / artist) → drill or seed from the
    // CURRENT track. Mirrors the Queue now-hero menu, but always reachable since NP is
    // anchored. Keys off the queue's current entry (player state carries no catalog id).
    const npMenu = (e: MouseEvent) => {
      const cur = queue.getCurrent();
      if (!cur) return; // nothing playing → let the native menu through
      const t = resolveEntry(cur);
      const items = [
        goToArtistItem("songs", cur.catalogId, t?.artistName),
        goToAlbumItem(cur.catalogId, t?.albumName),
        startStationItem("songs", cur.catalogId),
        t ? addSongToLibraryItem(t) : null,
      ].filter(Boolean) as MenuItem[];
      if (!items.length) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, items);
    };
    host.querySelector<HTMLElement>(".np__art")?.addEventListener("contextmenu", npMenu);
    host.querySelector<HTMLElement>(".np__meta")?.addEventListener("contextmenu", npMenu);

    // Album Color — tint the card's aurora with the current album's real palette.
    const npEl = host.querySelector<HTMLElement>(".np")!;
    const unsubAlbumColor = watchAlbumColor(npEl);

    // Scrubber — live progress + drag-to-seek (shared slider primitive).
    let unsubProgress = () => {};
    const npScrub = host.querySelector<HTMLElement>(".np__scrub");
    if (npScrub) {
      const seek = makeSlider(npScrub, {
        axis: "x",
        onCommit: (frac) => seekToFraction(frac).catch((err) => console.error("[player] seek failed:", err)),
      });
      unsubProgress = onPlayerProgress((p) => seek.setValue(p.progress)); // no-op while dragging
    }

    return {
      destroy() {
        unsubState();
        unsubProgress();
        unsubAlbumColor();
        host.innerHTML = "";
      },
    };
  },
};
