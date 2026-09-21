// When a social service is busy, or switched off (docs/integrations/FRIENDS.md §5.2).
//
// **The rule: a social feature may fail, and the music must not notice.** Friends,
// DeetsRooms and the Discord card all talk to something that is not us. Apple playback
// goes through none of them. So when one of them fails, the app says so in a sentence —
// and says, in the same breath, what is still fine.
//
// It is shared because Rooms had the same problem first: it put the raw status number in
// front of the user ("the rooms server answered 429"). One helper, two callers, and a 429
// now reads like a sentence instead of an error code.
//
// **Three things it must not do** (§5.2):
//   1. Never toast per retry. The reconnect has its own backoff; this has its own floor.
//   2. Never block a control. The panel greys and says one quiet line; every music
//      control keeps working. Nothing here returns a value a caller must handle.
//   3. Never toast at launch, before the first connection has had its chance. A cold
//      start on slow Wi-Fi is not a busy service.

import { toast } from "./toast";
import { onPlayerState } from "./player";
import * as diag from "./diag";

/** At most one toast per service per ten minutes, however many retries run. */
const FLOOR_MS = 10 * 60_000;
/** The launch quiet period. A first connection is allowed to be slow. */
const LAUNCH_QUIET_MS = 20_000;
/** A song that just started owns the screen; a service notice can wait for the floor. */
const PLAY_QUIET_MS = 3_000;

/** Why the service is not answering. `off` is the kill switch and is NOT temporary. */
export type BusyCause = "rate" | "off" | "gone";

const startedAt = Date.now();
const lastToldAt = new Map<string, number>();
let lastPlayAt = 0;

let watching = false;
function watchPlayback(): void {
  if (watching) return;
  watching = true;
  let wasPlaying = false;
  onPlayerState((s) => {
    if (s.playing && !wasPlaying) lastPlayAt = Date.now();
    wasPlaying = s.playing;
  });
}

/**
 * Read a failed response, or a thrown fetch, as one of the three causes. The worker's
 * own answers are what make this possible: 429 for the IP rate limit, and
 * 503 `{error:"off"}` for the kill switch (DeetsMusicFriends/src/index.js).
 */
export function causeOf(status: number | null): BusyCause {
  if (status === 429) return "rate";
  if (status === 503) return "off";
  return "gone";
}

/**
 * Say it, at most once per service per ten minutes.
 *
 * `service` is the name the person sees on the panel — "Friends", "DeetsRooms" — not the
 * worker's name. Nobody has to know what a worker is.
 */
export function busy(service: string, cause: BusyCause): void {
  watchPlayback();
  const now = Date.now();
  const last = lastToldAt.get(service) ?? 0;

  // The three silences, each with its own reason, and each logged so a complaint about
  // "it said nothing" can be read rather than guessed (CLAUDE.md checklist item 6).
  let quiet: string | null = null;
  if (now - startedAt < LAUNCH_QUIET_MS) quiet = "launch";
  else if (now - lastPlayAt < PLAY_QUIET_MS) quiet = "playback-start";
  else if (now - last < FLOOR_MS) quiet = "floor";
  if (quiet) {
    diag.log("busy:quiet", { service, cause, why: quiet });
    return;
  }

  lastToldAt.set(service, now);
  diag.warn("busy:told", { service, cause });
  // A 429 is temporary and a 503 is not. The toast does not say "it will come back" when
  // the owner has closed the door (§5.2).
  toast({
    kind: "warn",
    text:
      cause === "off"
        ? `${service} is switched off right now. Your music is not affected.`
        : `${service} is busy right now — it will come back on its own. Your music is not affected.`,
  });
}

/**
 * A connection came back. The floor is cleared, so the NEXT outage is told about at once
 * rather than swallowed by a ten-minute window that began during the last one.
 */
export function busyOver(service: string): void {
  lastToldAt.delete(service);
}
