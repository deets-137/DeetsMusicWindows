// Apple's license traffic, recorded in every build (2026-10-18, his call; QUEUE.md §License
// heal › Why Apple refused). MusicKit raises only "MEDIA_LICENSE"; the reason is in Apple's reply
// and in the key session's events, which MusicKit does not pass on. So, observe only:
//  - the license request (a `fetch` to acquireWebPlaybackLicense): HTTP status, round trip, and
//    Apple's `status`, `errorCode` and `renew-after` from a clone of the reply (license-reply.ts).
//    The license itself, the request body and every header (the tokens) are never read or kept.
//  - each key session: its messages (`license-request`, `license-renewal`, …), its key statuses
//    (`usable`, `expired`, `output-restricted`, `internal-error`, …) and its expiration.
// Nothing is changed or delayed: the wrappers hand MusicKit the same objects. Everything stays in
// this window's ring and the local log file; nothing is sent anywhere. A refusal, a failed
// request, a key that is not usable and a renewal go to the log file at once (`diag.warn` /
// `diag.info`); the ring is dumped with each license failure (`player:licenseTrace`).
import * as diag from "./diag";
import { parseLicenseReply, isRefusal } from "./license-reply";

export interface LicenseEvent {
  /** performance.now(), ms. */
  t: number;
  kind: "req" | "fail" | "session" | "msg" | "keys" | "closed";
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

function watchFetch(): void {
  const original = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const p = original.call(this ?? window, input, init);
    let url = "";
    try {
      url = requestUrl(input);
    } catch {
      return p;
    }
    if (!LICENSE_URL.test(url)) return p;
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
        // A skip aborts the old song's request: that is MusicKit's choice, not a failure.
        (/AbortError/.test(ev.err ?? "") ? diag.log : diag.warn)("license:failed", ev);
      },
    );
    return p;
  } as typeof window.fetch;
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
        if (keys.some((k) => k !== "usable")) diag.warn("license:keys", ev);
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
