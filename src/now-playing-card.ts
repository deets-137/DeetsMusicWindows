// Now Playing card — the transport strip (cover · title/artist · scrubber · prev/play/next),
// driven by real MusicKit playback state. Extracted from main.ts into the card registry so
// it can be mounted into a slot like any other card (in midi it's anchored to the top slot).
// Volume lives in the titlebar chrome, not here.

import { playPause, nextTrack, prevTrack, onPlayerState, onPlayerProgress, seekToFraction } from "./player";
import { makeSlider } from "./slider";
import type { CardDef } from "./cards";

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>';

const TEMPLATE = `
  <div class="np">
    <div class="np__art" id="np-art" aria-hidden="true">♪</div>
    <div class="np__center">
      <div class="np__meta">
        <span class="np__title" id="np-title">Not playing</span>
        <span class="np__artist" id="np-artist"></span>
      </div>
      <div class="np__scrub scrub">
        <div class="scrub__track"><div class="scrub__fill"></div></div>
        <span class="scrub__handle" aria-hidden="true"></span>
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

    // Drive the icon, title/artist, and cover from actual playback state.
    const unsubState = onPlayerState((s) => {
      playBtn.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      if (npTitle) npTitle.textContent = s.title ?? "Not playing";
      if (npArtist) npArtist.textContent = s.artist ?? "";
      if (npArt) npArt.innerHTML = s.artworkUrl ? `<img src="${s.artworkUrl}" alt="" />` : "♪";
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
        host.innerHTML = "";
      },
    };
  },
};
