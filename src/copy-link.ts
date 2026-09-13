// "Copy Link": a catalog song's or album's share URL, onto the clipboard. A sibling of
// the start-station / library-add builders — callers spread it into their menu arrays
// and drop nulls with `.filter(Boolean)`; it returns `null` without a catalog id
// (uploads, matched-only tracks have no public page).
//
// Apple's page resolves a bare id with no storefront (music.apple.com/song/<id>,
// /album/<id>) and opens in the viewer's own region — so no storefront lookup, and a
// song or catalog album costs no Apple call. A library album tile carries only its
// tracks, so its album id comes from one song→album hop (catalogRelated, memoized) on
// pick. No toast system yet (FUTURE-SETTINGS §18), so failures are a quiet log.

import { catalogRelated } from "./search";
import type { MenuItem } from "./context-menu";

const LABEL = "Copy Link";

const url = (kind: "song" | "album", id: string) => `https://music.apple.com/${kind}/${id}`;

const copy = (text: string) =>
  navigator.clipboard.writeText(text).catch((e) => console.error("[copy-link] clipboard", e));

/** A song's link, from its catalog id. */
export function copySongLinkItem(catalogId?: string | null): MenuItem | null {
  if (!catalogId) return null;
  return { label: LABEL, run: () => void copy(url("song", catalogId)) };
}

/** An album's link, from the album's own catalog id (Search results). */
export function copyAlbumLinkItem(catalogId?: string | null): MenuItem | null {
  if (!catalogId) return null;
  return { label: LABEL, run: () => void copy(url("album", catalogId)) };
}

/** An album's link, resolved from one of its songs' catalog ids (library album tiles). */
export function copyAlbumLinkFromSongItem(songCatalogId?: string | null): MenuItem | null {
  if (!songCatalogId) return null;
  return {
    label: LABEL,
    run: () =>
      void catalogRelated("songs", songCatalogId, "albums")
        .then((ref) => {
          if (ref) return copy(url("album", ref.id));
          console.warn("[copy-link] no catalog album for song", songCatalogId);
        })
        .catch((e) => console.error("[copy-link] album resolve", e)),
  };
}
