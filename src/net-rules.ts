// The Network panel's rules (docs/features/speedtest.md §8), pure so tests/net-rules.test.ts
// holds them: one minute's numbers → one verdict per row, the title's verdict, the song
// pieces' speed, and the host test of the fetch wrap. net.ts collects the minutes; this file
// only judges them. Every threshold says why it sits where it does.

export type Verdict = "good" | "ok" | "bad";
/** "none": the minute has nothing to judge (no ping while paused, no Apple call). */
export type CellVerdict = Verdict | "none";

/** One minute of the last hour. Every count is for this minute only. */
export interface Minute {
  /** Minutes since the epoch. */
  m: number;
  /** The webview went offline at some point in this minute. */
  offline: boolean;
  pingSent: number;
  /** The round trip of each echo that came back, ms. */
  rtts: number[];
  /** A Rooms or Friends socket closed and had to reconnect. */
  drops: number;
  /** The Wi-Fi signal quality, 0–100, the lowest read this minute; null = not on Wi-Fi. */
  wifi: number | null;
  /** Music played at some point in this minute. */
  playing: boolean;
  /** Mid-song pauses to load, and their seconds. */
  stalls: number;
  stallS: number;
  /** AirPlay, the session's counts that grew in this minute. */
  apPackets: number;
  apResends: number;
  apStarved: number;
  /** AirPlay keep-alive p95, ms, the highest this minute; null = no speaker. */
  apRtt: number | null;
  /** The song pieces the fetch wrap saw: each one's speed, kbps. */
  pieceKbps: number[];
}

export const emptyMinute = (m: number): Minute => ({
  m, offline: false, pingSent: 0, rtts: [], drops: 0, wifi: null, playing: false,
  stalls: 0, stallS: 0, apPackets: 0, apResends: 0, apStarved: 0, apRtt: null, pieceKbps: [],
});

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Lost echoes as a share, 0–1; null without a ping. */
export const lossOf = (c: Pick<Minute, "pingSent" | "rtts">): number | null =>
  c.pingSent ? Math.max(0, c.pingSent - c.rtts.length) / c.pingSent : null;

// ── Internet: offline, the ping, the sockets ──
// A ping round is 3 echoes every 30 s, so a minute holds 6. One lost echo is a hiccup a song's
// buffer rides out (OK); three of six is a link that drops packets (Bad). Music needs no low
// latency: 120 ms is a slow link, 250 ms one where a song start waits.
const LOSS_BAD = 0.34;
const RTT_OK_MS = 120;
const RTT_BAD_MS = 250;
/** Three socket drops in a minute is a link going up and down. */
const DROPS_BAD = 3;

export function internetVerdict(c: Minute): CellVerdict {
  if (c.offline) return "bad";
  const loss = lossOf(c);
  const rtt = median(c.rtts);
  if (c.drops >= DROPS_BAD || (loss !== null && loss >= LOSS_BAD) || (rtt !== null && rtt >= RTT_BAD_MS)) return "bad";
  if (c.drops > 0 || (loss !== null && loss > 0) || (rtt !== null && rtt >= RTT_OK_MS)) return "ok";
  return loss === null ? "none" : "good";
}

// ── Wi-Fi: Windows' signal quality ──
// Windows draws its own bars from the same number: under 40 is one bar, where a 256 kbps
// stream starts to stall; 65 and up is the full set.
const WIFI_BAD = 40;
const WIFI_OK = 65;

export function wifiVerdict(c: Minute): CellVerdict {
  if (c.wifi === null) return "none";
  return c.wifi < WIFI_BAD ? "bad" : c.wifi < WIFI_OK ? "ok" : "good";
}

// ── Apple Music: the calls of that minute (apple_calls.rs, `apple_calls_minutes`) ──
// A failed call is a 429, a 5xx or no reply. One is a retry away; three, or nothing but
// failures, is Apple out of reach.
export function appleVerdict(ok: number, bad: number): CellVerdict {
  if (ok + bad === 0) return "none";
  if (bad >= 3 || (bad > 0 && ok === 0)) return "bad";
  return bad > 0 ? "ok" : "good";
}

// ── Stream: the pauses to load ──
// One short pause is noticed; two, or ten seconds of silence, is a stream that cannot keep up.
const STALL_BAD_S = 10;

export function streamVerdict(c: Minute): CellVerdict {
  if (!c.playing && c.stalls === 0) return "none";
  if (c.stalls >= 2 || c.stallS >= STALL_BAD_S) return "bad";
  return c.stalls > 0 ? "ok" : "good";
}

// ── AirPlay: the packets the speaker asked for again, the PC's gaps, the round trip ──
// The crate resends what the speaker asks for, so a few resends play clean (0.5 %); 2 % is
// where the speaker's buffer runs dry. 150 ms keep-alives on a LAN mean a busy Wi-Fi.
const RESEND_OK = 0.005;
const RESEND_BAD = 0.02;
const AP_RTT_OK_MS = 150;

export const resendShare = (c: Pick<Minute, "apPackets" | "apResends">): number | null =>
  c.apPackets ? c.apResends / c.apPackets : null;

export function airplayVerdict(c: Minute): CellVerdict {
  const r = resendShare(c);
  if (r === null) return "none";
  if (r >= RESEND_BAD) return "bad";
  if (r >= RESEND_OK || c.apStarved > 0 || (c.apRtt !== null && c.apRtt >= AP_RTT_OK_MS)) return "ok";
  return "good";
}

const RANK: Record<CellVerdict, number> = { none: -1, good: 0, ok: 1, bad: 2 };

export function worst(vs: CellVerdict[]): CellVerdict {
  return vs.reduce<CellVerdict>((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
}

/** The title's word: the worst cell of any row in the last `last` minutes; offline now is Bad.
 *  Nothing to judge (paused, online) is Good: the link has given no sign of trouble. */
export const TITLE_MINUTES = 5;
export function titleVerdict(rows: CellVerdict[][], onlineNow: boolean, last = TITLE_MINUTES): Verdict {
  if (!onlineNow) return "bad";
  const v = worst(rows.flatMap((r) => r.slice(-last)));
  return v === "none" ? "good" : v;
}

/** The title's words (his, 2026-10-19). */
export const VERDICT_WORDS: Record<Verdict, string> = { good: "Good", ok: "OK", bad: "Bad" };

// ── The Test (net_test) ──
// A 256 kbps stream needs about 0.3 Mbps; 2 Mbps holds it with room for covers and a second
// app; under 0.5 a song start waits.
const TEST_OK_MBPS = 2;
const TEST_BAD_MBPS = 0.5;
export const testVerdict = (mbps: number): Verdict => (mbps < TEST_BAD_MBPS ? "bad" : mbps < TEST_OK_MBPS ? "ok" : "good");

// ── The fetch wrap (speedtest.md §5.3) ──
/** The one host whose replies the wrap reads: Apple's song server. */
export const SONG_HOST = "aod-ssl.itunes.apple.com";
export function isSongUrl(url: string): boolean {
  // A plain substring test after the scheme: cheaper than new URL() on every fetch.
  const i = url.indexOf("://");
  if (i < 0) return false;
  const rest = url.slice(i + 3);
  return rest.startsWith(SONG_HOST + "/") || rest === SONG_HOST || rest.startsWith(SONG_HOST + ":");
}

/** A piece's speed, kbps; null when the time is too short to mean anything (a cache hit). */
export const PIECE_MIN_MS = 5;
export function pieceKbps(bytes: number, ms: number): number | null {
  if (!(bytes > 0) || !(ms >= PIECE_MIN_MS)) return null;
  return (bytes * 8) / ms; // bits per ms = kbps
}

/** A ring that keeps the last `cap` items. */
export function pushRing<T>(ring: T[], item: T, cap: number): void {
  ring.push(item);
  if (ring.length > cap) ring.splice(0, ring.length - cap);
}
