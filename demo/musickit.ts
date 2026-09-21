// A stand-in for MusicKit JS in the web demo (docs/features/WEB-DEMO.md §3.4). It has the
// parts player.ts reads and calls — the queue window, the transport, the clock and the
// events — and plays no sound: a timer moves the clock (fork 3A).

import * as cat from "./catalog";

const PlaybackStates: Record<string | number, string | number> = {
  none: 0, loading: 1, playing: 2, paused: 3, stopped: 4, ended: 5, seeking: 6, waiting: 8, stalled: 9, completed: 10,
};
for (const [k, v] of Object.entries({ ...PlaybackStates })) PlaybackStates[v] = k;

const Events = {
  playbackStateDidChange: "playbackStateDidChange",
  nowPlayingItemDidChange: "nowPlayingItemDidChange",
  playbackTimeDidChange: "playbackTimeDidChange",
  mediaPlaybackError: "mediaPlaybackError",
  authorizationStatusDidChange: "authorizationStatusDidChange",
  queueItemsDidChange: "queueItemsDidChange",
};

interface Descriptor {
  id: string;
  type?: string;
  attributes?: Record<string, any>;
}

class MediaItem {
  id: string;
  type: string;
  attributes: Record<string, any>;
  playParams: Record<string, any>;
  constructor(d: Descriptor) {
    this.id = d.id;
    this.type = d.type ?? "songs";
    this.attributes = d.attributes ?? {};
    this.playParams = this.attributes.playParams ?? { id: d.id, kind: "song" };
  }
  get title(): string {
    return this.attributes.name ?? "";
  }
  get artistName(): string {
    return this.attributes.artistName ?? "";
  }
  get albumName(): string {
    return this.attributes.albumName ?? "";
  }
  get artwork(): { url: string; width: number; height: number } | undefined {
    return this.attributes.artwork;
  }
  /** Milliseconds, as MusicKit's own item reports it. */
  get playbackDuration(): number {
    return this.attributes.durationInMillis ?? 0;
  }
}

function itemFor(id: string): MediaItem | null {
  const t = cat.trackById(id);
  if (!t) return null;
  return new MediaItem({
    id,
    type: id === t.libraryId ? "library-songs" : "songs",
    attributes: {
      playParams: { id, kind: "song" },
      name: t.title,
      artistName: t.artistName,
      albumName: t.albumName ?? "",
      durationInMillis: t.durationMs,
      artwork: t.artwork ? { url: t.artwork.urlTemplate, width: t.artwork.width, height: t.artwork.height } : undefined,
    },
  });
}

function resolve(ids: string[]): MediaItem[] {
  const bad = ids.filter((id) => !cat.trackById(id));
  if (bad.length) throw new Error(`The following ids could not be resolved: ${bad.join(", ")}`);
  return ids.map((id) => itemFor(id)!);
}

const TICK_MS = 250;

class Queue {
  items: MediaItem[] = [];
  constructor(private owner: Player) {}
  get position(): number {
    return this.owner.nowPlayingItemIndex;
  }
  get length(): number {
    return this.items.length;
  }
  get isEmpty(): boolean {
    return this.items.length === 0;
  }
  splice(start: number, count: number, ...add: MediaItem[]): MediaItem[] {
    const out = this.items.splice(start, count, ...add);
    const np = this.owner.nowPlayingItemIndex;
    if (np > start) this.owner.nowPlayingItemIndex = Math.max(start, np - count + add.length);
    this.owner.fire(Events.queueItemsDidChange);
    return out;
  }
}

class Player {
  queue = new Queue(this);
  nowPlayingItemIndex = -1;
  playbackState: number = PlaybackStates.none as number;
  currentPlaybackTime = 0;
  volume = 1;
  repeatMode = 0;
  bitrate = 256;
  isAuthorized = true;
  authorizationStatus = 3;
  private token = "demo";
  private listeners = new Map<string, Set<(e?: unknown) => void>>();
  private timer = 0;
  private lastTick = 0;

  get musicUserToken(): string {
    return this.token;
  }
  set musicUserToken(v: string) {
    this.token = v;
  }
  get nowPlayingItem(): MediaItem | undefined {
    return this.nowPlayingItemIndex >= 0 ? this.queue.items[this.nowPlayingItemIndex] : undefined;
  }
  get isPlaying(): boolean {
    return this.playbackState === PlaybackStates.playing;
  }
  get currentPlaybackDuration(): number {
    return (this.nowPlayingItem?.playbackDuration ?? 0) / 1000;
  }
  get currentPlaybackTimeRemaining(): number {
    return Math.max(0, this.currentPlaybackDuration - this.currentPlaybackTime);
  }

  addEventListener(name: string, fn: (e?: unknown) => void): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: (e?: unknown) => void): void {
    this.listeners.get(name)?.delete(fn);
  }
  fire(name: string, e?: unknown): void {
    this.listeners.get(name)?.forEach((fn) => {
      try {
        fn(e);
      } catch (err) {
        console.error("[demo] MusicKit listener", name, err);
      }
    });
  }

  private setState(s: number): void {
    if (this.playbackState === s) return;
    this.playbackState = s;
    this.fire(Events.playbackStateDidChange, { state: s });
  }
  private moveTo(index: number): void {
    this.nowPlayingItemIndex = index;
    this.currentPlaybackTime = 0;
    this.fire(Events.nowPlayingItemDidChange, { item: this.nowPlayingItem });
    this.fire(Events.playbackTimeDidChange);
  }
  private startClock(): void {
    window.clearInterval(this.timer);
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }
  private stopClock(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
  private tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.isPlaying) return;
    this.currentPlaybackTime += dt;
    const dur = this.currentPlaybackDuration;
    if (dur > 0 && this.currentPlaybackTime >= dur) return this.songEnded();
    this.fire(Events.playbackTimeDidChange);
  }
  private songEnded(): void {
    if (this.repeatMode === 1) {
      this.currentPlaybackTime = 0;
      this.fire(Events.playbackTimeDidChange);
      return;
    }
    const next = this.nowPlayingItemIndex + 1;
    if (next < this.queue.items.length) {
      this.moveTo(next);
      return;
    }
    // The end of the window: MusicKit reports no item and a finished state.
    this.stopClock();
    this.currentPlaybackTime = 0;
    this.nowPlayingItemIndex = -1;
    this.fire(Events.nowPlayingItemDidChange, { item: undefined });
    this.setState(PlaybackStates.completed as number);
  }

  async setQueue(desc: any): Promise<Queue> {
    let items: MediaItem[];
    if (Array.isArray(desc?.items)) items = desc.items.map((d: any) => (d instanceof MediaItem ? d : new MediaItem(d)));
    else if (Array.isArray(desc?.songs)) items = resolve(desc.songs.map(String));
    else if (desc?.station || desc?.stations) items = this.stationItems(String(desc.station ?? desc.stations[0]));
    else items = [];
    this.stopClock();
    this.queue.items = items;
    this.fire(Events.queueItemsDidChange);
    this.moveTo(items.length ? 0 : -1);
    this.setState(PlaybackStates.paused as number);
    return this.queue;
  }
  private stationItems(stationId: string): MediaItem[] {
    let seed = 0;
    for (const ch of stationId + Date.now()) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const r = cat.rng(seed);
    const pool = cat.tracks.slice();
    const out: MediaItem[] = [];
    while (out.length < 25 && pool.length) out.push(itemFor(pool.splice(Math.floor(r() * pool.length), 1)[0].catalogId!)!);
    return out;
  }

  async play(): Promise<void> {
    if (!this.nowPlayingItem) {
      if (!this.queue.items.length) return;
      this.moveTo(0);
    }
    this.setState(PlaybackStates.playing as number);
    this.startClock();
  }
  async pause(): Promise<void> {
    if (!this.isPlaying) return;
    this.stopClock();
    this.setState(PlaybackStates.paused as number);
  }
  async stop(): Promise<void> {
    this.stopClock();
    this.currentPlaybackTime = 0;
    this.setState(PlaybackStates.stopped as number);
  }
  async seekToTime(sec: number): Promise<void> {
    this.currentPlaybackTime = Math.max(0, Math.min(Number(sec) || 0, this.currentPlaybackDuration));
    this.lastTick = performance.now();
    this.fire(Events.playbackTimeDidChange);
  }
  async changeToMediaAtIndex(i: number): Promise<void> {
    if (i < 0 || i >= this.queue.items.length) return;
    this.moveTo(i);
    this.setState(PlaybackStates.playing as number);
    this.startClock();
  }
  async skipToNextItem(): Promise<void> {
    const next = this.nowPlayingItemIndex + 1;
    if (next >= this.queue.items.length) return;
    const was = this.isPlaying;
    this.moveTo(next);
    if (was) this.startClock();
  }
  async skipToPreviousItem(): Promise<void> {
    const prev = this.nowPlayingItemIndex - 1;
    if (prev < 0) return this.seekToTime(0);
    const was = this.isPlaying;
    this.moveTo(prev);
    if (was) this.startClock();
  }
  async playNext(desc: any): Promise<void> {
    const items = resolve((desc?.songs ?? []).map(String));
    const at = Math.max(0, this.nowPlayingItemIndex + 1);
    this.queue.items.splice(at, 0, ...items);
    this.fire(Events.queueItemsDidChange);
  }
  async playLater(desc: any): Promise<void> {
    const items = resolve((desc?.songs ?? []).map(String));
    this.queue.items.push(...items);
    this.fire(Events.queueItemsDidChange);
  }
  async authorize(): Promise<string> {
    return this.token;
  }
  async unauthorize(): Promise<void> {}
}

let instance: Player | null = null;

export const FakeMusicKit = {
  PlaybackStates,
  Events,
  MediaItem,
  PlayerRepeatMode: { none: 0, one: 1, all: 2 },
  async configure(): Promise<Player> {
    instance ??= new Player();
    return instance;
  },
  getInstance(): Player | null {
    return instance;
  },
};
