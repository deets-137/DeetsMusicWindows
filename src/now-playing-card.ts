// Now Playing card — the transport strip (cover · title/artist · scrubber · prev/play/next),
// driven by real MusicKit playback state. Extracted from main.ts into the card registry so
// it can be mounted into a slot like any other card (in midi it's anchored to the top slot).
// Volume lives in the titlebar chrome, not here.

import {
  playPause, nextTrack, prevTrack, shuffleQueue, stopStation, onPlayerState, onPlayerProgress, seekToFraction,
  getVolume, setVolume, toggleMute, isMuted, onVolumeChange,
} from "./player";
import { makeSlider } from "./slider";
import { ICON_VOL, ICON_MUTE } from "./volume-icons";
import { mountAirplay, type AirplayMount } from "./airplay";
import { onTracksChange } from "./track-store";
import { watchAlbumColor } from "./album-color";
import { requestCard } from "./layout-bus";
import * as queue from "./queue";
import { resolveEntry, artURL } from "./queue-rows";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem, addTrackToLibrary, libraryAddOffered, libraryAddEnabled, onLibraryAddChange } from "./library-add";
import { favoriteItem, favoriteOffered, isLoved, toggleLoved, onFavoritesChange } from "./favorites";

const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';
import { startStationItem } from "./start-station";
import { copySongLinkItem } from "./copy-link";
import { explicitBadge } from "./library-card";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import type { CardDef } from "./cards";
import { rowDrag, registerDropTarget } from "./row-drag";
import { dropToPlay } from "./drop-actions";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
// The cover placeholder: the ♪ glyph in a one-line box (styles.css .np__art-glyph).
const GLYPH_NOTE = '<span class="np__art-glyph" aria-hidden="true">♪</span>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';

const TEMPLATE = `
  <div class="np np--idle">
    <div class="np__aurora" aria-hidden="true"></div>
    <div class="np__art" id="np-art" aria-hidden="true">${GLYPH_NOTE}</div>
    <div class="np__center">
      <div class="np__meta">
        <div class="np__line">
          <span class="np__title" id="np-title">Not playing</span>
          <span class="np__explicit" id="np-explicit"></span>
        </div>
        <div class="np__line">
          <span class="np__artist" id="np-artist"></span>
        </div>
        <span class="np__album" id="np-album"></span>
      </div>
      <div class="np__scrub scrub">
        <div class="scrub__track"><div class="scrub__fill"></div></div>
        <span class="scrub__handle" aria-hidden="true"></span>
        <span class="np__live" aria-hidden="true">LIVE</span>
      </div>
      <div class="np__times" aria-hidden="true"><span id="np-elapsed">0:00</span><span id="np-remaining">0:00</span></div>
      <div class="np__bottom">
        <div class="np__left">
          <button class="panel__action np__shuffle" id="np-shuffle" type="button" aria-label="Shuffle">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="16 3 21 3 21 8"></polyline>
              <line x1="4" y1="20" x2="21" y2="3"></line>
              <polyline points="21 16 21 21 16 21"></polyline>
              <line x1="15" y1="15" x2="21" y2="21"></line>
              <line x1="4" y1="4" x2="9" y2="9"></line>
            </svg>
          </button>
          <button class="panel__action np__summon" id="np-summon" type="button" aria-label="Show queue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="3" y1="6" x2="13" y2="6"></line>
              <line x1="3" y1="12" x2="13" y2="12"></line>
              <line x1="3" y1="18" x2="13" y2="18"></line>
              <path d="M17 8.5 22 12 17 15.5z" fill="none"></path>
            </svg>
          </button>
          <button class="panel__action np__search" id="np-search" type="button" aria-label="Show search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5 21 21"></path></svg>
          </button>
        </div>
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
        <div class="np__right">
          <button class="panel__action np__fav" id="np-fav" type="button" aria-label="Favorite" aria-pressed="false" disabled hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"></path></svg>
          </button>
          <button class="panel__action np__add" id="np-add" type="button" aria-label="Add to Library" disabled hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>
      </div>
      <div class="np__vol">
        <button class="panel__action np__vol-mute" id="np-vol-mute" type="button" aria-label="Mute" aria-pressed="false"></button>
        <div class="scrub np__vol-scrub" id="np-vol-scrub">
          <div class="scrub__track"><div class="scrub__fill"></div></div>
          <span class="scrub__handle" aria-hidden="true"></span>
        </div>
        <button class="panel__action np__airplay ap-square" id="np-airplay" type="button" aria-label="AirPlay" data-state="idle">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17a8 8 0 1 1 14 0" fill="none"></path><path d="M8 21l4-5 4 5z" fill="none"></path></svg>
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
    const npAlbum = host.querySelector<HTMLElement>("#np-album");
    const npBadge = host.querySelector<HTMLElement>("#np-explicit");
    // The explicit badge sits after the title while the title fits. When the title is
    // cut off, the badge moves to the right end of the artist line. The badge is always
    // measured in the title line first, so the choice can't oscillate. The title's
    // native tooltip carries the full text only when it is cut off.
    const placeBadge = () => {
      if (!npTitle || !npBadge || !npArtist) return;
      npTitle.after(npBadge);
      if (npTitle.scrollWidth > npTitle.clientWidth) npArtist.after(npBadge);
      npTitle.title = npTitle.scrollWidth > npTitle.clientWidth ? npTitle.textContent ?? "" : "";
    };
    let titleKey = ""; // title + badge last placed — re-measured only on change
    const npElapsed = host.querySelector<HTMLElement>("#np-elapsed");
    const npRemaining = host.querySelector<HTMLElement>("#np-remaining");
    const fmt = (s: number) => {
      const t = Math.max(0, Math.floor(s));
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    };
    const npEl2 = host.querySelector<HTMLElement>(".np");
    const prevBtn = host.querySelector<HTMLButtonElement>('.np__controls [aria-label="Previous"]');
    const nextBtn = host.querySelector<HTMLButtonElement>('.np__controls [aria-label="Next"]');

    // Drive the icon, title/artist, cover, and radio transport caps from playback
    // state. A LIVE station has no seek and no skip (STATIONS.md §1): `.np--live`
    // swaps the scrubber for a LIVE marker and the prev/next buttons disable.
    let onStation = false; // radio mode → the menu offers Stop Station
    let artKey = ""; // what the cover box currently shows — rebuilt only on change
    const unsubState = onPlayerState((s) => {
      onStation = !!s.station;
      playBtn.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      // Between songs MusicKit reports no item for a beat. The queue already knows what
      // is about to play, so fill the gap from its current entry instead of showing the
      // placeholder and the "Not playing" text for a frame (the between-songs jitter).
      const cur = queue.getCurrent();
      const next = !s.station && cur ? resolveEntry(cur) : undefined;
      const title = s.title ?? next?.title;
      const artist = s.artist ?? next?.artistName;
      const album = s.album ?? next?.albumName;
      const artwork = s.artworkUrl ?? artURL(next, 480) ?? undefined;
      const text = title ?? "Not playing";
      const badge = next ? explicitBadge(next) : "";
      if (npArtist) npArtist.textContent = artist ?? (s.station ? s.station.name : "");
      if (npTitle && `${text}|${badge}` !== titleKey) {
        titleKey = `${text}|${badge}`;
        npTitle.textContent = text;
        if (npBadge) npBadge.innerHTML = badge;
        placeBadge();
      }
      if (npAlbum) npAlbum.textContent = album ?? "";
      // The cover is rebuilt ONLY when the artwork or station changes: state fires on
      // every play/pause/loading tick, and re-creating the <img> each time flashed the
      // placeholder between identical covers.
      const key = `${artwork ?? ""}|${s.station?.name ?? ""}`;
      if (npArt && key !== artKey) {
        artKey = key;
        npArt.innerHTML = artwork
          ? `<img src="${artwork}" alt="" data-art />`
          : GLYPH_NOTE;
        // Radio: the station's name rides the cover as a hover chip (STATIONS.md §3b).
        if (s.station) {
          const chip = document.createElement("span");
          chip.className = "np__station";
          chip.textContent = s.station.name;
          npArt.appendChild(chip);
        }
      }
      const live = !!s.station?.live;
      npEl2?.classList.toggle("np--live", live);
      // Idle (nothing queued, no station): the aurora goes dark so the card matches its
      // neighbors instead of glowing over an empty placeholder (Glass).
      npEl2?.classList.toggle("np--idle", !title && !s.station);
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

    // Add to Library square (option B, 2026-09-10), the tray panel's four states: hidden
    // (toggle off / no catalog id), "+" to add, a spinner while adding, and a check once
    // the song is in the library (mirrors the extension). Re-evaluated on every song
    // change, library reload, and toggle flip.
    const addBtn = host.querySelector<HTMLButtonElement>("#np-add");
    const currentTrack = () => {
      const cur = queue.getCurrent();
      return cur ? resolveEntry(cur) : undefined;
    };
    let adding = false;
    const setAdd = (state: "hidden" | "idle" | "add" | "added" | "busy") => {
      if (!addBtn) return;
      addBtn.hidden = state === "hidden";
      addBtn.disabled = state !== "add";
      addBtn.classList.toggle("is-busy", state === "busy");
      addBtn.innerHTML = state === "added" ? ICON_CHECK : ICON_PLUS;
      addBtn.setAttribute("aria-label", state === "added" ? "In your library" : "Add to Library");
      addBtn.title = state === "added" ? "In your library" : "Add to Library";
    };
    const refreshAdd = () => {
      if (!libraryAddEnabled()) return setAdd("hidden"); // the toggle is the only thing that removes it
      const t = currentTrack();
      if (!t?.catalogId) return setAdd("idle"); // nothing playing / no catalog id: greyed, in place
      if (adding) return setAdd("busy");
      setAdd(libraryAddOffered(t) ? "add" : "added");
    };
    addBtn?.addEventListener("click", () => {
      const t = currentTrack();
      if (!t || adding) return;
      adding = true;
      refreshAdd();
      addTrackToLibrary(t)
        .catch((e) => console.error("[np] add to library", e))
        .finally(() => {
          adding = false;
          refreshAdd();
        });
    });
    const unsubAddState = onPlayerState(refreshAdd);
    const unsubAddTracks = onTracksChange(refreshAdd, "np.add");
    const unsubAddToggle = onLibraryAddChange(refreshAdd);
    refreshAdd();

    // ♥ square (NEXT-VERSION §3): hidden without consent or a catalog id; filled
    // when loved. Optimistic — favorites.ts flips the state and rolls back on error.
    const favBtn = host.querySelector<HTMLButtonElement>("#np-fav");
    const refreshFav = () => {
      if (!favBtn) return;
      favBtn.hidden = !libraryAddEnabled(); // same consent as the "+"; only the toggle removes it
      const t = currentTrack();
      if (!favoriteOffered(t)) { // nothing playing / no catalog id: greyed, in place
        favBtn.disabled = true;
        favBtn.setAttribute("aria-pressed", "false");
        favBtn.dataset.state = "off";
        return;
      }
      favBtn.disabled = false;
      const on = isLoved(t);
      favBtn.setAttribute("aria-pressed", String(on));
      favBtn.dataset.state = on ? "on" : "off";
      favBtn.setAttribute("aria-label", on ? "Unfavorite" : "Favorite");
      favBtn.title = on ? "Unfavorite" : "Favorite";
    };
    favBtn?.addEventListener("click", () => {
      const t = currentTrack();
      if (!favoriteOffered(t)) return;
      toggleLoved(t).catch((e) => console.error("[np] favorite", e));
    });
    const unsubFavState = onPlayerState(refreshFav);
    const unsubFavChange = onFavoritesChange(refreshFav);
    const unsubFavToggle = onLibraryAddChange(refreshFav);
    const unsubFavTracks = onTracksChange(refreshFav, "np.fav");
    refreshFav();

    // Stage volume row (max only, CSS-gated): the same app gain the titlebar pill
    // drives, on the horizontal scrubber primitive. onVolumeChange keeps every
    // control in step whoever moved the level. The AirPlay square opens the
    // "Play on" panel (airplay.ts); the pill's panel has the same square for mini/midi.
    const volMute = host.querySelector<HTMLButtonElement>("#np-vol-mute");
    const volScrub = host.querySelector<HTMLElement>("#np-vol-scrub");
    let unsubVolume = () => {};
    let airplay: AirplayMount | null = null;
    const airplaySquare = host.querySelector<HTMLElement>("#np-airplay");
    if (airplaySquare) airplay = mountAirplay(airplaySquare);
    if (volMute && volScrub) {
      const volSlider = makeSlider(volScrub, {
        axis: "x",
        onDrag: (frac) => setVolume(frac),
        onCommit: (frac) => setVolume(frac),
      });
      const reflectVolume = () => {
        const v = getVolume();
        volSlider.setValue(v);
        volMute.innerHTML = isMuted() || v === 0 ? ICON_MUTE : ICON_VOL;
        volMute.setAttribute("aria-pressed", String(isMuted()));
      };
      volMute.addEventListener("click", () => toggleMute());
      unsubVolume = onVolumeChange(reflectVolume);
      reflectVolume();
    }

    // Shuffle — one-shot: manual picks to the top, auto tail shuffles; idle press
    // plays the whole library shuffled (see player.shuffleQueue / FUTURE-SETTINGS §5).
    host.querySelector<HTMLElement>("#np-shuffle")?.addEventListener("click", () => {
      shuffleQueue().catch((e) => console.error("[player] shuffle failed:", e));
    });

    // Queue summon — bring the Queue card into the least-recently-touched slot
    // (flips if it's already on-screen in the other slot; see layout.ts).
    host.querySelector<HTMLElement>("#np-summon")?.addEventListener("click", () => requestCard("queue"));
    // Search square (NEXT-VERSION §5): same bus, the Search card.
    host.querySelector<HTMLElement>("#np-search")?.addEventListener("click", () => requestCard("search"));

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
        copySongLinkItem(cur.catalogId),
        startStationItem("songs", cur.catalogId),
        t ? addSongToLibraryItem(t) : null,
        favoriteItem(t),
        onStation
          ? { label: "Stop Station", run: () => void stopStation().catch((err) => console.error("[np] stop station", err)) }
          : null,
      ].filter(Boolean) as MenuItem[];
      if (!items.length) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, items);
    };
    host.querySelector<HTMLElement>(".np__art")?.addEventListener("contextmenu", npMenu);
    host.querySelector<HTMLElement>(".np__meta")?.addEventListener("contextmenu", npMenu);

    // Drag the cover (the current song) to another card; a drop on this card plays at once
    // (DRAG-DROP.md §2–3, fork 2). It is also mini's one drop target.
    const artEl = host.querySelector<HTMLElement>(".np__art");
    const drag = artEl
      ? rowDrag({
          root: artEl,
          label: "now-playing",
          rowAt: () => {
            const cur = queue.getCurrent();
            const t = cur ? resolveEntry(cur) : undefined;
            return cur && t
              ? { row: artEl, index: 0, payload: { source: "now-playing", kind: "song", tracks: () => [t], context: cur.context } }
              : null;
          },
        })
      : null;
    const unregisterDrop = registerDropTarget({
      el: host,
      over: (_under, _x, _y, p) =>
        p.source === "now-playing" || p.source === "queue-now" ? null : { highlight: host, drop: () => dropToPlay(p) },
    });

    // Transport row overflow (mini at minimum width): when shuffle + prev/play/next +
    // summon can't fit one row, drop the two side buttons to a second row. Measured
    // from the rendered buttons (their widths don't change when stacked, so the
    // threshold can't oscillate) and the grid's own column-gap, so it follows the skin.
    const bottom = host.querySelector<HTMLElement>(".np__bottom");
    const leftCluster = host.querySelector<HTMLElement>(".np__left"); // shuffle · queue · search
    const controls = host.querySelector<HTMLElement>(".np__controls");
    const rightCluster = host.querySelector<HTMLElement>(".np__right"); // ♥ · "+"
    let stackObserver: ResizeObserver | undefined;
    if (bottom && leftCluster && controls && rightCluster) {
      const fit = () => {
        const gap = parseFloat(getComputedStyle(bottom).columnGap) || 0;
        const needed = leftCluster.offsetWidth + controls.offsetWidth + rightCluster.offsetWidth + gap * 2;
        bottom.classList.toggle("np__bottom--stacked", bottom.clientWidth < needed);
      };
      stackObserver = new ResizeObserver(fit);
      stackObserver.observe(bottom);
      fit();
    }
    // A width change (window resize, surface switch, skin font) can cut the title off
    // or free it, so the badge is placed again.
    const meta = host.querySelector<HTMLElement>(".np__meta");
    const badgeObserver = new ResizeObserver(placeBadge);
    if (meta) badgeObserver.observe(meta);

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
      unsubProgress = onPlayerProgress((p) => {
        seek.setValue(p.progress); // no-op while dragging
        if (npElapsed) npElapsed.textContent = fmt(p.currentTime);
        if (npRemaining) npRemaining.textContent = p.duration ? `-${fmt(p.duration - p.currentTime)}` : "0:00";
      });
    }

    return {
      destroy() {
        unsubState();
        unsubProgress();
        unsubAlbumColor();
        unsubAddState();
        unsubAddTracks();
        unsubAddToggle();
        unsubFavState();
        unsubFavChange();
        unsubFavToggle();
        unsubFavTracks();
        unsubVolume();
        airplay?.destroy();
        stackObserver?.disconnect();
        badgeObserver.disconnect();
        drag?.destroy();
        unregisterDrop();
        host.innerHTML = "";
      },
    };
  },
};
