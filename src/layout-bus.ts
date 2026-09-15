// Card-summon bus — lets a mounted card ask the layout manager to bring another
// card on-screen without importing layout.ts directly (that would close an import
// cycle: layout → cards → now-playing-card → layout). Same subscribe idiom as
// onPlayerState / onSyncEvent / onTracksChange.

import type { CardId } from "./cards";

type RequestCb = (id: CardId) => void;
const subs = new Set<RequestCb>();

/**
 * Ask the layout to bring `id` on-screen. The layout mounts it into the
 * least-recently-touched content slot. A card already on screen stays where it is
 * (ARTIST-VIEW.md §6); one in a hidden slot (mini's right) comes into the visible one.
 */
export function requestCard(id: CardId): void {
  subs.forEach((cb) => cb(id));
}

// The on-screen panel that shows a card (the chip flight's landing, handoff.ts). The layout
// installs the lookup; before it does, nothing is on screen.
let hostLookup: (id: CardId) => HTMLElement | null = () => null;
/** Layout-side: install the lookup. */
export function setCardHostLookup(fn: (id: CardId) => HTMLElement | null): void {
  hostLookup = fn;
}
/** The panel showing `id` on screen now, or null. */
export const cardHost = (id: CardId): HTMLElement | null => hostLookup(id);

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
