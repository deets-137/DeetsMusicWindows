// Card-summon bus — lets a mounted card ask the layout manager to bring another
// card on-screen without importing layout.ts directly (that would close an import
// cycle: layout → cards → now-playing-card → layout). Same subscribe idiom as
// onPlayerState / onSyncEvent / onTracksChange.

import type { CardId } from "./cards";

type RequestCb = (id: CardId) => void;
const subs = new Set<RequestCb>();

/**
 * Ask the layout to bring `id` on-screen. The layout mounts it into the
 * least-recently-touched content slot; if it's already visible in the other
 * slot, the two slots exchange (see docs/FUTURE-SETTINGS.md §10).
 */
export function requestCard(id: CardId): void {
  subs.forEach((cb) => cb(id));
}

/** Layout-side: subscribe to summon requests. Returns an unsubscribe fn. */
export function onCardRequest(cb: RequestCb): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
