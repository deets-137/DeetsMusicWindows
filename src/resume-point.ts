// The pure half of Play on a song that MusicKit no longer holds (player.ts `playPause`): the
// second to pick it up at. No MusicKit and no DOM here, so tests/resume-point.test.ts can pin
// the rule (the 2026-09-27 bug: Play after a network drop restarted the song at 0 s).

/** A position an update restart saved (queue-persist.ts), by song id. */
export type RestartSpot = { sec: number; id: string };
/** A position a network drop saved (player.ts `onMusicKitTrouble`), by queue entry. */
export type DropSpot<E> = { entry: E; at: number };

/** Where Play starts the model's current song after it reloads it into MusicKit.
 *  - A network drop's spot wins when it is for this very entry: it is the newer of the two.
 *    A spot of 3 s or less starts at 0, the same as the resume after a reconnect.
 *  - Else an update restart's spot, when it is for this song id.
 *  - Else 0. */
export function resumePoint<E>(
  cur: E | undefined,
  curId: string | undefined,
  restart: RestartSpot | null,
  drop: DropSpot<E> | null,
): number {
  if (!cur) return 0;
  if (drop && drop.entry === cur) return drop.at > 3 ? drop.at : 0;
  if (restart && curId === restart.id) return restart.sec;
  return 0;
}
