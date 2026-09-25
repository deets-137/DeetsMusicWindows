// Card-summon bus — lets a mounted card ask the layout manager to bring another
// card on-screen without importing layout.ts directly (that would close an import
// cycle: layout → cards → now-playing-card → layout). Same subscribe idiom as
// onPlayerState / onSyncEvent / onTracksChange.

import type { CardId } from "./cards";
import type { Track } from "./library";

/** A drill request opens one thing in the target card (Go to Album, a shelf tile, a playlist).
 *  From a grown card it swaps that card into the grown place (CARD-GROW.md §14). */
export type RequestHow = "summon" | "drill";
type RequestCb = (id: CardId, how: RequestHow) => void;
const subs = new Set<RequestCb>();

/**
 * Ask the layout to bring `id` on-screen. The layout mounts it into the
 * least-recently-touched content slot. A card already on screen stays where it is
 * (ARTIST-VIEW.md §6); one in a hidden slot (mini's right) comes into the visible one.
 */
export function requestCard(id: CardId, how: RequestHow = "summon"): void {
  subs.forEach((cb) => cb(id, how));
}

/** Ask for `id` because the user is drilling into something in the card they are looking at. */
export const requestDrillCard = (id: CardId): void => requestCard(id, "drill");

// The on-screen panel that shows a card (the chip flight's landing, handoff.ts). The layout
// installs the lookup; before it does, nothing is on screen.
let hostLookup: (id: CardId) => HTMLElement | null = () => null;
/** The drill swap (CARD-GROW.md §14): would a drill for `id` land in the grown card's own
 *  place? The layout installs the answer; before it does, nothing swaps. */
let swapCheck: (id: CardId) => boolean = () => false;
/** Layout-side: install the drill-swap check. */
export function setDrillSwapCheck(fn: (id: CardId) => boolean): void {
  swapCheck = fn;
}
/** True when a drill for `id` takes the grown card's place (so a chip would fly to itself). */
export const drillSwapsInPlace = (id: CardId): boolean => swapCheck(id);

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

// ── A card at one thing (COMPASS.md §6): the same held-request shape, for any card ──
// The request waits until the card takes it: a card mounted by the request takes it on
// mount, a card already on screen takes it through the subscription.
function heldRequest<T>(card: CardId) {
  let pending: T | null = null;
  const subs = new Set<() => void>();
  return {
    request(v: T): void {
      pending = v;
      requestCard(card);
      subs.forEach((cb) => cb());
    },
    take(): T | null {
      const v = pending;
      pending = null;
      return v;
    },
    on(cb: () => void): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** The Library card at an artist (a credited name, as the card's own groups have it) or at an album (any of its songs). */
export type LibraryDrill = { kind: "artist"; name: string } | { kind: "album"; track: Track } | { kind: "genre"; name: string };
const libraryDrill = heldRequest<LibraryDrill>("library");
export const requestLibraryDrill = (d: LibraryDrill): void => libraryDrill.request(d);
export const takeLibraryDrill = (): LibraryDrill | null => libraryDrill.take();
export const onLibraryDrill = (cb: () => void): (() => void) => libraryDrill.on(cb);

/** The Diary card at an album (DIARY.md §2): "Add to Diary" on an album's menu. The songs load
 *  when the card takes the request, so a Search album costs no fetch until then. */
export interface DiaryRequest {
  album: { title: string; artistName: string; artwork?: Track["artwork"]; catalogId?: string; libraryId?: string; releaseDate?: string };
  tracks: () => Track[] | Promise<Track[]>;
}
const diaryAlbum = heldRequest<DiaryRequest>("diary");
export const requestDiaryAlbum = (r: DiaryRequest): void => diaryAlbum.request(r);
export const takeDiaryAlbum = (): DiaryRequest | null => diaryAlbum.take();
export const onDiaryAlbum = (cb: () => void): (() => void) => diaryAlbum.on(cb);

/** The Search card with a term typed and its search running. */
const searchTerm = heldRequest<string>("search");
export const requestSearchTerm = (term: string): void => searchTerm.request(term);
export const takeSearchTerm = (): string | null => searchTerm.take();
export const onSearchTerm = (cb: () => void): (() => void) => searchTerm.on(cb);
