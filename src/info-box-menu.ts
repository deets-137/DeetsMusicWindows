// The right-click menu inside a Last.fm facts box (LISTENERS.md §7.1 item 5; his call,
// 2026-10-13): a small menu of its own, not the hero's. *Open Last.fm*, then *Hide artist
// info* / *Hide album info* / *Hide song info* (LISTENERS.md §8), which turns that box's Settings row off and says so in a toast
// with Undo. The rest of the hero keeps the hero's menu. A module of its own so
// collection-card.ts can import it (info-box.ts imports collection-card.ts).

import { openUrl } from "@tauri-apps/plugin-opener";
import { openContextMenu, type MenuItem } from "./context-menu";
import { setSetting } from "./settings-store";
import { toast } from "./toast";
import * as diag from "./diag";

/** The box under a right-click, or null when the click was elsewhere on the hero. */
export function infoBoxAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-info-box]") : null;
}

/** Open the box's menu at the pointer. The caller has already checked `infoBoxAt`. */
export function openInfoBoxMenu(e: MouseEvent, box: HTMLElement): void {
  e.preventDefault();
  e.stopPropagation();
  const kind = box.dataset.infoBox === "album" ? "album" : box.dataset.infoBox === "song" ? "song" : "artist";
  const key = kind === "album" ? "showAlbumInfo" : kind === "song" ? "showSongInfo" : "showArtistInfo";
  const word = kind === "album" ? "Album" : kind === "song" ? "Song" : "Artist";
  const url = box.dataset.url;
  const items: MenuItem[] = [];
  if (url) items.push({ label: "Open Last.fm", run: () => void openUrl(url) });
  items.push({
    label: `Hide ${word.toLowerCase()} info`,
    run: () => {
      // The row goes off for good (no more calls). Every open box of this kind fades out and
      // its cover slides back to the center, and comes back the same way on Undo (hero-slide.ts
      // watches the row).
      setSetting(key, false, "panel");
      diag.log("info-box:hide", { kind });
      toast({
        kind: "info",
        text: `${word} info hidden. Settings › Playback brings it back.`,
        actions: [
          {
            label: "Undo",
            run: () => setSetting(key, true, "panel"),
          },
        ],
      });
    },
  });
  openContextMenu(e.clientX, e.clientY, items);
}
