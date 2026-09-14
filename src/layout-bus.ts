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

// ── Settings at one row (a toast's [Settings] button, SETTINGS.md) ──
// The request is held until a Settings card takes it: a card mounted by this request
// takes it on mount, a card already on-screen takes it through the subscription.
let pendingRow: string | null = null;
const rowSubs = new Set<() => void>();

/** Bring the Settings card on-screen, unfold the section holding `rowId`, scroll to the row, highlight it. */
export function requestSetting(rowId: string): void {
  pendingRow = rowId;
  requestCard("settings");
  rowSubs.forEach((cb) => cb());
}

/** Settings-card side: take the waiting row id (null when none). */
export function takeSettingRequest(): string | null {
  const id = pendingRow;
  pendingRow = null;
  return id;
}

/** Settings-card side: be told when a row request arrives. Returns an unsubscribe fn. */
export function onSettingRequest(cb: () => void): () => void {
  rowSubs.add(cb);
  return () => rowSubs.delete(cb);
}
