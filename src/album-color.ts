// Album Color (ALBUM-COLOR.md) — the data path for the NP aurora.
//
// Watches the current track and applies its real Apple palette as inline runtime
// roles (--album-bg/-c1/-c2) on the NP card, plus the .np--album presence class.
// Cache-first through the Rust enrichment layer (`album_palette`): a hit applies
// immediately; a miss leaves the theme fallback showing while the palette is
// fetched lazily, then the @property-registered transition crossfades it in.
// Clearing the props (no track / no palette) falls back to the theme roles.

import { invoke } from "@tauri-apps/api/core";
import { onPlayerState } from "./player";
import { getCurrent } from "./queue";
import { trackById } from "./track-store";

interface AlbumPalette {
  bg?: string; // "#rrggbb" — normalized in Rust
  c1?: string;
  c2?: string;
}

const PROPS = ["--album-bg", "--album-c1", "--album-c2"] as const;

/** Watch playback and tint `card` (the .np element) with the current album's palette. */
export function watchAlbumColor(card: HTMLElement): () => void {
  let liveKey: string | null = null; // the cover the card currently reflects

  const clear = () => {
    PROPS.forEach((p) => card.style.removeProperty(p));
    card.classList.remove("np--album");
  };

  const apply = (p: AlbumPalette) => {
    if (p.bg) card.style.setProperty("--album-bg", p.bg);
    else card.style.removeProperty("--album-bg");
    if (p.c1) card.style.setProperty("--album-c1", p.c1);
    else card.style.removeProperty("--album-c1");
    if (p.c2) card.style.setProperty("--album-c2", p.c2);
    else card.style.removeProperty("--album-c2");
    card.classList.add("np--album");
  };

  const unsub = onPlayerState(() => {
    const cur = getCurrent();
    const track = trackById(cur?.catalogId ?? cur?.libraryId);
    const cover = track?.artwork?.urlTemplate ?? null;

    if (cover === liveKey) return; // same album (or still nothing) — no work
    liveKey = cover;

    if (!cover) {
      clear();
      return;
    }
    // Theme fallback shows until (unless) a palette arrives — never stall the UI.
    clear();
    const requestedKey = cover;
    invoke<AlbumPalette | null>("album_palette", {
      coverUrl: cover,
      catalogId: cur?.catalogId ?? track?.catalogId ?? null,
    })
      .then((p) => {
        if (liveKey !== requestedKey) return; // track changed while fetching — stale
        if (p) apply(p);
      })
      .catch((e) => console.warn("[album-color] palette lookup failed:", e));
  });

  return () => {
    unsub();
    clear();
  };
}
