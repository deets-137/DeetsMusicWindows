// A press on an album, a playlist or an artist anywhere in the app (HOME.md §11.5): what the Settings
// pair says, unless a rule says otherwise for this type. Home and the Pinned shelves keep their own
// verbs and call tile-press.ts directly.

import { decided } from "./rules";
import { tilePress, type TileVerb } from "./tile-press";
import { setting } from "./settings-store";
import { runListAction } from "./collection-card";
import { playTracks } from "./player";
import { addTransientTracks } from "./track-store";
import { materializeTrack } from "./search";
import type { Track } from "./library";
import * as diag from "./diag";

export type CollectionKind = "album" | "playlist" | "artist";

export interface Collection {
  kind: CollectionKind;
  /** The tile: a second press counts only on the same key. */
  key: string;
  /** The play log's tag, as the item's own Play row gives it. */
  context: string;
  open: () => void;
  tracks: () => Track[] | Promise<Track[]>;
}

/** A catalog list made ready to play, as a pin's off-library tile does (pins.ts). */
export async function catalogTracks(read: () => Promise<Track[]>): Promise<Track[]> {
  const ts = await read();
  addTransientTracks(ts);
  ts.forEach(materializeTrack);
  return ts;
}

/** A rule's answer for this type in this card (the `press.*` events, HOME.md §11.5). */
function ruled(event: `press.${CollectionKind}` | `press.${CollectionKind}.double`, card: string, fallback: TileVerb): TileVerb {
  const d = decided(event, { card });
  return d && "useVerb" in d ? d.useVerb : fallback;
}

export function collectionPress(e: MouseEvent | undefined, c: Collection): void {
  const card = (e?.target instanceof Element ? e.target.closest<HTMLElement>(".panel")?.dataset.mounted : undefined) ?? "*";
  const click = ruled(`press.${c.kind}`, card, setting("collectionClick"));
  const double = ruled(`press.${c.kind}.double`, card, setting("collectionDouble"));
  tilePress(e, c.key, click, double, (verb) => {
    diag.log("ui:act", { at: card, do: "collection", kind: c.kind, verb });
    if (verb === "open") return c.open();
    void Promise.resolve(c.tracks())
      .then((ts) => {
        if (ts.length) runListAction(verb === "shuffle" ? "shuffle" : "play", ts, (list, start) => void playTracks(list, start, c.context).catch((err) => console.error("[press] play", err)), c.kind === "album");
      })
      .catch((err) => console.error("[press] tracks", err));
  });
}
