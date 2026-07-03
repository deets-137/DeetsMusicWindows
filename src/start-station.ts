// "Start Station" (STATIONS.md §2): the seeded-radio context-menu verb. A sibling of
// the library-add builders — callers spread it into their menu arrays and drop nulls
// with `.filter(Boolean)`. It returns `null` when there's no catalog id (stations only
// seed from the catalog). No consent gate: unlike Add to Library this is read-only +
// playback, never an account write.
//
// Lives in its own module because player.ts already imports from radio.ts
// (recordStationPlay) — a playStation call inside radio.ts would be an import cycle.

import { invoke } from "@tauri-apps/api/core";
import { seedStation, type SeedKind } from "./radio";
import { playStation } from "./player";
import type { MenuItem } from "./context-menu";

export function startStationItem(kind: SeedKind, catalogId?: string | null): MenuItem | null {
  if (!catalogId) return null;
  return {
    label: "Start Station",
    run: () =>
      void seedStation(kind, catalogId)
        .then((s) => {
          // No station for this seed (rare) — nothing to play; the negative result is
          // cached so repeat picks stay free. No toast system yet, so a quiet warn
          // (FUTURE-SETTINGS §18).
          if (s) return playStation(s);
          console.warn(`[station] no station for ${kind} seed`, catalogId);
        })
        .catch((e) => console.error("[station] start", e)),
  };
}

// ── Library artist tiles (derived groups: a NAME, no catalog artist id) ────────
// The artist seed resolves in two lazy hops on pick: one of the artist's songs'
// catalog ids → its primary artist id (catalog_song_artist) → that artist's station
// (seedStation → playStation). Both hops are session-cached; the artist-id hop
// caches under the group's name — the same key the library derives artist groups
// by, so it stays consistent with the app's own grouping semantics.
const artistIdCache = new Map<string, string | null>();

export function startArtistStationItem(
  name: string,
  songCatalogIds: (string | undefined)[],
): MenuItem | null {
  const seed = songCatalogIds.find(Boolean);
  if (!seed) return null; // no catalog song to resolve the artist from (uploads-only artist)
  return {
    label: "Start Station",
    run: () =>
      void (async () => {
        let artistId = artistIdCache.get(name);
        if (artistId === undefined) {
          artistId = await invoke<string | null>("catalog_song_artist", { id: seed });
          artistIdCache.set(name, artistId);
        }
        if (!artistId) {
          console.warn("[station] no artist id resolvable for", name); // FUTURE-SETTINGS §18
          return;
        }
        const s = await seedStation("artists", artistId);
        if (s) return playStation(s);
        console.warn("[station] no station for artist", name);
      })().catch((e) => console.error("[station] artist start", e)),
  };
}
