// When a paused song lets go of Apple (QUEUE.md § Let go after a pause; his calls 2026-11-03).
//
// A paused song keeps its DRM key session open, and the browser renews its license every
// `renew-after` seconds (780 s on 2026-10-18). Apple counts a renewal as a stream, so a paused
// DeetsMusic stopped the music on the user's iPhone. The release (player.ts) stops MusicKit,
// which closes the key session. It fires after the user's minutes, OR just before the next
// renewal if that comes first: no renewal ever goes out after a pause (his call, 2026-11-03).
// A Mac plays through FairPlay (OS-LAYER.md §2), which may name no renewal time: then the
// minutes alone decide. Pure, so it has a test (tests/idle-release.test.ts).

/** How long before a renewal the release fires: the stop must land first. */
export const RELEASE_MARGIN_MS = 30_000;

/**
 * The next renewal, as a wall-clock ms time, or null when none is known.
 * `open`: each open key session's last license message (Date.now() ms).
 * A due time already past is skipped: that session renewed (its time moved on) or is dead.
 */
export function nextRenewalAt(open: readonly number[], renewAfterS: number | null, now: number): number | null {
  if (renewAfterS === null || !(renewAfterS > 0)) return null;
  let next: number | null = null;
  for (const at of open) {
    const due = at + renewAfterS * 1000;
    if (due < now) continue;
    if (next === null || due < next) next = due;
  }
  return next;
}

/**
 * When to release, as a wall-clock ms time; null = never (the setting is Never, 0).
 * The release fires at the user's minutes after the pause, or RELEASE_MARGIN_MS before the
 * next renewal if that is sooner, and never before the pause itself.
 */
export function releaseAt(o: { pausedAt: number; minutes: number; renewalAt: number | null; marginMs?: number }): number | null {
  if (!(o.minutes > 0)) return null;
  const byMinutes = o.pausedAt + o.minutes * 60_000;
  if (o.renewalAt === null) return byMinutes;
  const byRenewal = Math.max(o.pausedAt, o.renewalAt - (o.marginMs ?? RELEASE_MARGIN_MS));
  return Math.min(byMinutes, byRenewal);
}
