// "Copy Link": a catalog song's or album's share URL, onto the clipboard. A sibling of
// the start-station / library-add builders — callers spread it into their menu arrays
// and drop nulls with `.filter(Boolean)`; it returns `null` without a catalog id
// (uploads, matched-only tracks have no public page).
//
// Apple's page resolves a bare id with no storefront (music.apple.com/song/<id>,
// /album/<id>) and opens in the viewer's own region — so no storefront lookup, and a
// song or catalog album costs no Apple call. A library album tile carries only its
// tracks, so its album id comes from one song→album hop (catalogRelated, memoized) on
// pick. Feedback is a toast (TOASTS.md): "Link copied" under the Everything tier (the
// clipboard shows nothing otherwise), a timed warn on any failure.

import { catalogRelated } from "./search";
import type { MenuItem } from "./context-menu";
import { toast } from "./toast";

const LABEL = "Copy Link";

const url = (kind: "song" | "album", id: string) => `https://music.apple.com/${kind}/${id}`;

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => void toast({ kind: "success", text: "Link copied." }),
    (e) => {
      console.error("[copy-link] clipboard", e);
      toast({ kind: "warn", text: "Couldn't copy the link." });
    },
  );

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
          toast({ kind: "warn", text: "This album has no Apple Music page to link." });
        })
        .catch((e) => {
          console.error("[copy-link] album resolve", e);
          toast({ kind: "warn", text: "Couldn't copy the link." });
        }),
  };
}
