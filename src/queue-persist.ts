// Queue persistence (QUEUE.md "Restore across sessions", 2026-09-12).
//
// The model's three zones are saved as ONE JSON blob in the cache db's `meta` table
// (Rust `queue_state_get` / `queue_state_set`) — debounced on every queue change and on
// unload — and read back once at launch according to the `restoreQueue` setting:
//   "song"  — last session's song comes back as Now Playing, PAUSED, with Up Next and
//             the Previous chain. Nothing is fed to MusicKit until Play or a click; the
//             first play goes through the normal load (player.ts playPause).
//   "queue" — the song is parked at the head of Up Next instead; Now Playing stays idle.
//   "off"   — start empty. The blob is still written, so switching on later just works.
// The update restart (updater.ts, RELEASE.md §6.3) writes the blob with `updateRestart` and
// the playback position: that launch restores as "song" whatever the setting (the user did
// not choose to quit), and the first Play resumes at the position.
// A 3,895-song plan is ~250 KB of ids; stringify + upsert cost a few ms.

import { invoke } from "@tauri-apps/api/core";
import * as queue from "./queue";
import { setting } from "./settings-store";
import { onTracksChange } from "./track-store";
import { refreshPlayerState, playbackPosition, setResumeAt } from "./player";

const SAVE_DEBOUNCE_MS = 500;
let timer: number | undefined;
let started = false;

function save(): void {
  timer = undefined;
  invoke("queue_state_set", { json: JSON.stringify(queue.snapshot()) }).catch((e) =>
    console.warn("[queue-persist] save", e),
  );
}
function scheduleSave(): void {
  if (timer === undefined) timer = window.setTimeout(save, SAVE_DEBOUNCE_MS);
}

/** Restore per the setting, then keep the blob current. Idempotent. */
export async function initQueuePersist(): Promise<void> {
  if (started) return;
  started = true;
  let fromUpdate = false;
  try {
    const json = await invoke<string | null>("queue_state_get");
    const s = json ? (JSON.parse(json) as queue.QueueSnapshot) : null;
    fromUpdate = !!s?.updateRestart;
    const mode = fromUpdate ? "song" : setting("restoreQueue");
    if (s && s.v === 1 && mode !== "off") {
      queue.restore(s, mode === "song");
      const cur = queue.getCurrent();
      const id = cur?.catalogId ?? cur?.libraryId;
      if (fromUpdate && id && typeof s.at === "number" && s.at > 1) setResumeAt(s.at, id);
      refreshPlayerState(); // Now Playing reads the model's current when MusicKit has no item
      // Names/art resolve through the track store, which may still be loading — repaint once it lands.
      const off = onTracksChange((why) => {
        if (why !== "library") return;
        refreshPlayerState();
        off();
      }, "queue-persist.np");
    }
  } catch (e) {
    console.warn("[queue-persist] restore", e);
  }
  // Subscribe AFTER the restore so its own emit doesn't rewrite what was just read.
  queue.onQueueChange(scheduleSave);
  // Clear the update-restart marks at once, so a later plain launch follows the setting again.
  if (fromUpdate) scheduleSave();
  window.addEventListener("beforeunload", () => {
    if (timer === undefined) return; // nothing pending
    window.clearTimeout(timer);
    save(); // same fire-and-forget invoke the diag flush relies on at unload
  });
}

/** The update restart (updater.ts): write the blob NOW, with the playback position, and wait
 *  for the write — the installer ends the process, so no unload save runs. */
export async function flushForRestart(): Promise<void> {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  const snap: queue.QueueSnapshot = { ...queue.snapshot(), updateRestart: true, at: playbackPosition() };
  try {
    await invoke("queue_state_set", { json: JSON.stringify(snap) });
  } catch (e) {
    console.warn("[queue-persist] flush for restart", e);
  }
}
