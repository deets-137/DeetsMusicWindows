// Rulez's file words (RULEZ.md §5): "Use picture" and "Play sound" over the user's own files.
//
// A picture in a While row is a state target on two rule keys (`glassCanvas` = picture and
// `glassPictureId` = the id), so the engine's overlay holds it and gives your canvas back;
// no action runs. A picture in a When row is the `picture` action: it writes both as your
// value, as a press would (§1.4). A sound is the `playSound` action: the clip is decoded once
// and kept, then played over the music with a short duck (sound.ts `playClip`, the tap after
// the EQ, so a HomePod hears it). One clip at a time; the 5-in-10-s cap stops a loop.

import { invoke } from "@tauri-apps/api/core";
import { setSetting } from "./settings-store";
import { registerAction } from "./rules";
import { decodeClip, playClip } from "./sound";
import { fileUrl, loadFiles, userFile } from "./user-files";
import * as diag from "./diag";

const clips = new Map<string, Promise<AudioBuffer>>();

/** A skin token that is a plain number (`--clip-gain-db: -6`). */
const tokenNum = (name: string, fallback: number): number => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

/** The decoded clip, fetched and decoded on first use and kept. */
function clipOf(id: string): Promise<AudioBuffer> {
  let p = clips.get(id);
  if (!p) {
    p = fetch(fileUrl(id))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`clip ${id}: ${r.status}`))))
      .then(decodeClip);
    p.catch(() => clips.delete(id)); // a failed decode is tried again next time
    clips.set(id, p);
  }
  return p;
}

export function initRulesFiles(): void {
  void loadFiles();
  registerAction("picture", {
    cost: "free",
    run: (id) => {
      const f = userFile(String(id));
      if (!f || f.kind !== "picture") {
        diag.warn("rule:file", { do: "picture", id, why: "gone" });
        return;
      }
      setSetting("glassCanvas", "picture");
      setSetting("glassPictureId", f.id);
    },
  });
  registerAction("playSound", {
    cost: "free",
    run: async (id) => {
      const f = userFile(String(id));
      if (!f || f.kind !== "sound") {
        diag.warn("rule:file", { do: "playSound", id, why: "gone" });
        return;
      }
      try {
        const buffer = await clipOf(f.id);
        const played = await playClip(buffer, { gainDb: tokenNum("--clip-gain-db", -6), duckDb: tokenNum("--clip-duck-db", 6) });
        diag.log("rule:file", { do: "playSound", id: f.id, played });
      } catch (e) {
        diag.warn("rule:file", { do: "playSound", id: f.id, why: e instanceof Error ? e.message : String(e) });
      }
    },
  });
}

/** A file a rule names is gone (Rulez's idle hint, RULEZ.md §5.1): true when the rule's Do names a missing file. */
export function fileGone(id: string): boolean {
  return !userFile(id);
}

/** Preview a sound from a menu (the play button beside its name). */
export async function previewSound(id: string): Promise<boolean> {
  try {
    return await playClip(await clipOf(id), { gainDb: tokenNum("--clip-gain-db", -6), duckDb: tokenNum("--clip-duck-db", 6) });
  } catch {
    return false;
  }
}

/** A picture's saved aurora colors (`{ bg, c1, c2 }`), or null (wallpaper.ts reads it). */
export const pictureColors = (id: string) => invoke<{ bg: string; c1: string; c2: string } | null>("user_files_colors", { id }).catch(() => null);
