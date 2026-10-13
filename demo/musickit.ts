// A stand-in for MusicKit JS in the web demo (docs/features/WEB-DEMO.md §3.4). It has the
// parts player.ts reads and calls — the queue window, the transport, the clock and the
// events. A song plays Apple's 30-second preview (§15, his call 2026-10-12) on an <audio>
// with MusicKit's own element id, so the Press record reads its exact clock and the Sound
// graph can route it (both servers allow a cross-origin read). The song's length in the
// player is the preview's. A song with no preview plays silent on a timer, as before.

import * as cat from "./catalog";

/** Apple's previews are 30 s; the element's own duration replaces this once it is known. */
const PREVIEW_S = 30;

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
      durationInMillis: cat.previewOf(id) ? Math.min(t.durationMs ?? Infinity, PREVIEW_S * 1000) : t.durationMs,
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

/** The song now playing, for the host page's Apple Music panel (shim.ts → demo.js). */
export interface NowPlaying {
  id: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
}
const nowPlayingSubs = new Set<(np: NowPlaying | null) => void>();
export const onNowPlaying = (cb: (np: NowPlaying | null) => void): void => void nowPlayingSubs.add(cb);

/** The one element the previews play on. Made on the first song, the way MusicKit makes its own. */
function previewElement(): HTMLAudioElement {
  let el = document.getElementById("apple-music-player") as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = "apple-music-player";
    el.crossOrigin = "anonymous"; // the Sound graph reads it; Apple's server allows it
    el.preload = "auto";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

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
  repeatMode = 0;
  bitrate = 256;
  isAuthorized = true;
  authorizationStatus = 3;
  private token = "demo";
  private listeners = new Map<string, Set<(e?: unknown) => void>>();
  private timer = 0;
  private lastTick = 0;
  private level = 1;
  /** The current song plays its preview (else the silent timer). */
  private audible = false;
  private el: HTMLAudioElement | null = null;

  /** player.ts sets this for its own gain (volume, duck, fades): it reaches the element. */
  get volume(): number {
    return this.level;
  }
  set volume(v: number) {
    this.level = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.el) this.el.volume = this.level;
  }
  private audio(): HTMLAudioElement {
    if (!this.el) {
      this.el = previewElement();
      this.el.volume = this.level;
      this.el.addEventListener("ended", () => this.songEnded());
      this.el.addEventListener("loadedmetadata", () => this.fire(Events.playbackTimeDidChange));
    }
    return this.el;
  }

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
    const d = this.audible ? this.el?.duration : NaN;
    return d !== undefined && isFinite(d) && d > 0 ? d : (this.nowPlayingItem?.playbackDuration ?? 0) / 1000;
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
    this.tellNowPlaying();
  }
  private moveTo(index: number): void {
    this.nowPlayingItemIndex = index;
    this.currentPlaybackTime = 0;
    this.load();
    this.fire(Events.nowPlayingItemDidChange, { item: this.nowPlayingItem });
    this.fire(Events.playbackTimeDidChange);
    this.tellNowPlaying();
  }
  /** Put the current song's preview on the element, or none. */
  private load(): void {
    const item = this.nowPlayingItem;
    const url = item ? cat.previewOf(item.id) : undefined;
    this.audible = !!url;
    if (!url && !this.el) return;
    const el = this.audio();
    el.pause();
    if (url) {
      if (el.src !== url) el.src = url;
      el.currentTime = 0;
    } else {
      el.removeAttribute("src");
      el.load();
    }
  }
  private tellNowPlaying(): void {
    const item = this.nowPlayingItem;
    const t = item ? cat.trackById(item.id) : undefined;
    const np: NowPlaying | null = t ? { id: t.catalogId!, title: t.title, artist: t.artistName, album: t.albumName ?? "", playing: this.isPlaying } : null;
    nowPlayingSubs.forEach((cb) => cb(np));
  }
  /** Start the clock and, for a preview, the sound. A browser that refuses the sound pauses. */
  private run(): void {
    window.clearInterval(this.timer);
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    if (!this.audible) return;
    const el = this.audio();
    el.play().catch((err: DOMException) => {
      if (err?.name === "AbortError") return; // a newer song or a pause came first
      if (err?.name === "NotAllowedError") {
        console.info("[demo] the browser held the sound until a click");
        void this.pause();
        return;
      }
      // The preview did not load: the song goes on silent, on the timer.
      console.info("[demo] preview not played:", String(err));
      this.audible = false;
    });
  }
  private halt(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.el?.pause();
  }
  private tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.isPlaying) return;
    if (this.audible && this.el) {
      // The element's own `ended` event moves on (songEnded).
      this.currentPlaybackTime = this.el.currentTime;
    } else {
      this.currentPlaybackTime += dt;
      const dur = this.currentPlaybackDuration;
      if (dur > 0 && this.currentPlaybackTime >= dur) return this.songEnded();
    }
    this.fire(Events.playbackTimeDidChange);
  }
  private songEnded(): void {
    if (this.repeatMode === 1) {
      this.currentPlaybackTime = 0;
      if (this.el && this.audible) this.el.currentTime = 0;
      this.fire(Events.playbackTimeDidChange);
      if (this.isPlaying) this.run();
      return;
    }
    const next = this.nowPlayingItemIndex + 1;
    if (next < this.queue.items.length) {
      this.moveTo(next);
      if (this.isPlaying) this.run();
      return;
    }
    // The end of the window: MusicKit reports no item and a finished state.
    this.halt();
    this.currentPlaybackTime = 0;
    this.nowPlayingItemIndex = -1;
    this.load();
    this.fire(Events.nowPlayingItemDidChange, { item: undefined });
    this.setState(PlaybackStates.completed as number);
  }

  async setQueue(desc: any): Promise<Queue> {
    let items: MediaItem[];
    if (Array.isArray(desc?.items)) items = desc.items.map((d: any) => (d instanceof MediaItem ? d : new MediaItem(d)));
    else if (Array.isArray(desc?.songs)) items = resolve(desc.songs.map(String));
    else if (desc?.station || desc?.stations) items = this.stationItems(String(desc.station ?? desc.stations[0]));
    else items = [];
    this.halt();
    this.queue.items = items;
    this.fire(Events.queueItemsDidChange);
    this.moveTo(items.length ? 0 : -1);
    this.setState(PlaybackStates.paused as number);
    return this.queue;
  }
  /** A station plays 25 songs from its own pool (catalog.ts `stationPool`), shuffled. */
  private stationItems(stationId: string): MediaItem[] {
    let seed = 0;
    for (const ch of stationId + Date.now()) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const r = cat.rng(seed);
    const pool = cat.stationPool(stationId).slice();
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
    this.run();
  }
  async pause(): Promise<void> {
    if (!this.isPlaying) return;
    this.halt();
    this.setState(PlaybackStates.paused as number);
  }
  async stop(): Promise<void> {
    this.halt();
    this.currentPlaybackTime = 0;
    if (this.el && this.audible) this.el.currentTime = 0;
    this.setState(PlaybackStates.stopped as number);
  }
  async seekToTime(sec: number): Promise<void> {
    this.currentPlaybackTime = Math.max(0, Math.min(Number(sec) || 0, this.currentPlaybackDuration));
    if (this.el && this.audible) this.el.currentTime = this.currentPlaybackTime;
    this.lastTick = performance.now();
    this.fire(Events.playbackTimeDidChange);
  }
  async changeToMediaAtIndex(i: number): Promise<void> {
    if (i < 0 || i >= this.queue.items.length) return;
    this.moveTo(i);
    this.setState(PlaybackStates.playing as number);
    this.run();
  }
  async skipToNextItem(): Promise<void> {
    const next = this.nowPlayingItemIndex + 1;
    if (next >= this.queue.items.length) return;
    const was = this.isPlaying;
    this.moveTo(next);
    if (was) this.run();
  }
  async skipToPreviousItem(): Promise<void> {
    const prev = this.nowPlayingItemIndex - 1;
    if (prev < 0) return this.seekToTime(0);
    const was = this.isPlaying;
    this.moveTo(prev);
    if (was) this.run();
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
