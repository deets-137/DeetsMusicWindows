// Apple's license traffic, recorded in every build (2026-10-18, his call; QUEUE.md §License
// heal › Why Apple refused). MusicKit raises only "MEDIA_LICENSE"; the reason is in Apple's reply
// and in the key session's events, which MusicKit does not pass on. It observes, and it does ONE
// thing (his call, 2026-10-18): a license request that hangs past CUT_MS is cut (§ The cut,
// below). Observed:
//  - the license request (a `fetch` to acquireWebPlaybackLicense): HTTP status, round trip, and
//    Apple's `status`, `errorCode` and `renew-after` from a clone of the reply (license-reply.ts).
//    The license itself, the request body and every header (the tokens) are never read or kept.
//  - each key session: its messages (`license-request`, `license-renewal`, …), its key statuses
//    (`usable`, `expired`, `output-restricted`, `internal-error`, …) and its expiration.
// Nothing else is changed or delayed: the wrappers hand MusicKit the same objects. Everything stays in
// this window's ring and the local log file; nothing is sent anywhere. A refusal, a failed
// request, a key that is not usable and a renewal go to the log file at once (`diag.warn` /
// `diag.info`); the ring is dumped with each license failure (`player:licenseTrace`).
import * as diag from "./diag";
import { parseLicenseReply, isRefusal, cutAfterMs, FIRST_CUT_MS } from "./license-reply";

export interface LicenseEvent {
  /** performance.now(), ms. */
  t: number;
  /** `slow`: a license or lookup out for SLOW_MS (`type` names which); `lookup`: a song lookup
   *  answered (`http`, `ms`). */
  kind: "req" | "fail" | "session" | "msg" | "keys" | "closed" | "slow" | "lookup" | "cut";
  /** req: HTTP status, round trip, Apple's numbers. */
  http?: number;
  ms?: number;
  status?: number | null;
  errorCode?: number | null;
  renewAfter?: number | null;
  refused?: boolean;
  text?: string;
  /** session / msg / keys / closed: the session's number in this window. */
  id?: number;
  type?: string;
  keys?: string[];
  /** keys: seconds until the session expires, when it says. */
  expiresIn?: number | null;
  err?: string;
}

declare global {
  interface Window {
    __license?: { trace: () => LicenseEvent[] };
  }
}

const LICENSE_URL = /\/acquireWebPlaybackLicense\b/;
const RING = 40;
const ring: LicenseEvent[] = [];
let installed = false;
let sessions = 0;

function push(e: Omit<LicenseEvent, "t">): LicenseEvent {
  const ev = { t: Math.round(performance.now()), ...e } as LicenseEvent;
  ring.push(ev);
  if (ring.length > RING) ring.shift();
  return ev;
}

/** The last RING events, oldest first. */
export function licenseTrace(): LicenseEvent[] {
  return ring.slice();
}

/** The last license request's event, if any. */
export function lastLicenseRequest(): LicenseEvent | undefined {
  for (let i = ring.length - 1; i >= 0; i--) if (ring[i].kind === "req" || ring[i].kind === "fail") return ring[i];
  return undefined;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// ── Requests in flight (2026-10-18, QUEUE.md §End stall) ─────────────────────────────
// A song that sticks in `waiting` at its end was reproduced by holding the NEXT song's license
// unanswered: MusicKit asks for it ~15 s before the end and waits for it at the end, with no
// error. So each playback request is tracked while it is out: the song lookup, the license, the
// audio. A license or lookup out for SLOW_MS is logged at once (`license:slow`), and the end-stall
// line lists what is still out (`inFlightNow`). Only the kind and the times are kept, never a URL.
type PlayKind = "license" | "lookup" | "audio";
const KINDS: [RegExp, PlayKind][] = [
  [LICENSE_URL, "license"],
  [/\/MZPlay\.woa\/wa\/webPlayback\b/, "lookup"],
  [/\/itunes-assets\//, "audio"],
];
const SLOW_MS = 5000;
const inFlight = new Map<number, { kind: PlayKind; t0: number }>();
let reqSeq = 0;

/** The playback requests still out, oldest first, with their age in ms. */
export function inFlightNow(): { kind: PlayKind; ageMs: number }[] {
  const now = performance.now();
  return [...inFlight.values()].sort((a, b) => a.t0 - b.t0).map((r) => ({ kind: r.kind, ageMs: Math.round(now - r.t0) }));
}

function track(kind: PlayKind, p: Promise<Response>, warnSlow: boolean): void {
  const id = ++reqSeq;
  const t0 = performance.now();
  inFlight.set(id, { kind, t0 });
  const slow = !warnSlow
    ? 0
    : window.setTimeout(() => {
          diag.warn("license:slow", push({ kind: "slow", type: kind, ms: SLOW_MS }));
        }, SLOW_MS);
  const done = (): void => {
    inFlight.delete(id);
    window.clearTimeout(slow);
  };
  p.then(
    (r) => {
      done();
      if (kind !== "lookup") return;
      const ev = push({ kind: "lookup", http: r.status, ms: Math.round(performance.now() - t0) });
      if (r.status !== 200) diag.warn("license:lookup", ev);
    },
    done,
  );
}

// ── The cut (2026-10-18, his call: "cut a hung license request at 5 s") ──────────────
// A license request still out after CUT_MS fails, for MusicKit, as the network error it would
// see from a dropped connection (`TypeError: Failed to fetch`), and the request is aborted. On the
// dev app MusicKit then asked again: for the next song, at the song change, with no `waiting` at
// all; for a play's own song, at once (playing 1.3 s after the cut). Without it a hung request
// held the song silent at its end, and even a reload waited for it (`m.stop()` does).
// A good license takes 0.2–0.6 s. The retry after a cut is cut too, at 15 s, once (his call, the
// same evening: a retry that hung as well held the song silent ~22 s in the test); the one after
// that is never cut, so a slow network cannot loop. `cutAfterMs` (license-reply.ts) holds the
// rule; an answered request starts it over.
let cutsInRow = 0;

function cutLicense(this: unknown, original: typeof window.fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const after = cutAfterMs(cutsInRow);
  const theirs = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  // No cut when MusicKit brings its own signal and this browser cannot join two.
  const ctl = after !== null && (!theirs || typeof any === "function") ? new AbortController() : null;
  const signal = ctl ? (theirs && any ? any([theirs, ctl.signal]) : ctl.signal) : undefined;
  const p = original.call(this ?? window, input, signal ? { ...init, signal } : init);
  // license:slow at 5 s for every request the 5 s cut does not answer.
  track("license", p, after !== FIRST_CUT_MS || !ctl);
  readReply(p);
  if (!ctl || after === null) return p;
  return new Promise<Response>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cutsInRow++;
      diag.warn("license:cut", push({ kind: "cut", ms: after }));
      reject(new TypeError("Failed to fetch"));
      ctl.abort();
    }, after);
    p.then(
      (r) => {
        window.clearTimeout(timer);
        cutsInRow = 0;
        resolve(r);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function watchFetch(): void {
  const original = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url = "";
    try {
      url = requestUrl(input);
    } catch {
      /* not a URL we know */
    }
    const kind = url ? KINDS.find(([re]) => re.test(url))?.[1] : undefined;
    if (kind === "license") return cutLicense.call(this, original, input, init);
    const p = original.call(this ?? window, input, init);
    if (kind) track(kind, p, kind === "lookup");
    return p;
  } as typeof window.fetch;
}

/** Apple's numbers from a clone of the license reply (the license itself is never kept). */
function readReply(p: Promise<Response>): void {
  const t0 = performance.now();
  p.then(
    (r) => {
      const ms = Math.round(performance.now() - t0);
      r.clone()
        .text()
        .then((body) => {
          const reply = parseLicenseReply(body);
          const refused = isRefusal(r.status, reply);
          const { hasLicense: _drop, ...numbers } = reply;
          const ev = push({ kind: "req", http: r.status, ms, refused, ...numbers });
          if (refused) diag.warn("license:refused", ev);
        })
        .catch((e) => {
          const ev = push({ kind: "req", http: r.status, ms, refused: r.status !== 200, err: String(e).slice(0, 80) });
          if (ev.refused) diag.warn("license:refused", ev);
        });
    },
    (e) => {
      const ev = push({ kind: "fail", ms: Math.round(performance.now() - t0), err: String(e).slice(0, 120) });
      // A skip aborts the old song's request (MusicKit's choice), and so does the cut: not a failure.
      (/AbortError/.test(ev.err ?? "") ? diag.log : diag.warn)("license:failed", ev);
    },
  );
}

function watchSessions(): void {
  if (typeof MediaKeys === "undefined" || typeof MediaKeys.prototype.createSession !== "function") return;
  const original = MediaKeys.prototype.createSession;
  MediaKeys.prototype.createSession = function (this: MediaKeys, ...args: [MediaKeySessionType?]): MediaKeySession {
    const s = original.apply(this, args);
    try {
      const id = ++sessions;
      push({ kind: "session", id, type: args[0] ?? "temporary" });
      s.addEventListener("message", (e) => {
        const ev = push({ kind: "msg", id, type: (e as MediaKeyMessageEvent).messageType });
        // A renewal is rare (renew-after was 780 s on 2026-10-18): log it when it happens.
        if (ev.type !== "license-request") diag.info("license:message", ev);
      });
      s.addEventListener("keystatuseschange", () => {
        const keys: string[] = [];
        s.keyStatuses.forEach((v) => keys.push(String(v)));
        const exp = s.expiration;
        const ev = push({ kind: "keys", id, keys, expiresIn: Number.isFinite(exp) ? Math.round((exp - Date.now()) / 1000) : null });
        // "released" is a session MusicKit closed after its song: the normal end, once per song.
        // As a warning it filled the log (222 lines in 4 days, so the 512 KB file kept 3 days)
        // and counted on 12 of 14 installs' weekly reports (2026-10-30). The ring still has it.
        if (keys.some((k) => k !== "usable" && k !== "released")) diag.warn("license:keys", ev);
        else if (keys.some((k) => k !== "usable")) diag.log("license:keys", ev);
      });
      s.closed.then(() => push({ kind: "closed", id })).catch(() => {});
    } catch (e) {
      diag.log("license:watchSkipped", { err: String(e) });
    }
    return s;
  };
}

/** Start recording (idempotent). Called before MusicKit's first play. */
export function installLicenseWatch(): void {
  if (installed) return;
  installed = true;
  try {
    watchFetch();
    watchSessions();
    window.__license = { trace: licenseTrace };
  } catch (e) {
    diag.warn("license:watchFailed", { err: String(e) });
  }
}
