// Apple's license reply, read (2026-10-18, QUEUE.md §License heal › Why Apple refused). Pure:
// license-watch.ts records the traffic, this decides. Tested in tests/license-reply.test.ts.
//
// MusicKit asks `play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense` once
// per song. The probe of 2026-10-18 on the dev app read a good reply as JSON with four keys:
// `license` (the key, never logged), `status` 0, `errorCode` 0 and `renew-after` 780 (seconds),
// and the key session's expiration came 899 s after it. MusicKit raises MEDIA_LICENSE when the
// reply is a refusal; the reply's numbers are Apple's reason.

export interface LicenseReply {
  /** Apple's `status`: 0 is a license. null when the body is not JSON or has none. */
  status: number | null;
  /** Apple's `errorCode`: 0 when fine. */
  errorCode: number | null;
  /** Seconds until MusicKit must renew the license. */
  renewAfter: number | null;
  /** True when the body carries a license (its value is never kept). */
  hasLicense: boolean;
  /** The first characters of a body that is not JSON (an HTML error page, say), for the log. */
  text?: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Read a reply body. Never keeps the license itself. */
export function parseLicenseReply(body: string): LicenseReply {
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return { status: null, errorCode: null, renewAfter: null, hasLicense: false, text: body.slice(0, 80).replace(/\s+/g, " ") };
  }
  if (!j || typeof j !== "object") return { status: null, errorCode: null, renewAfter: null, hasLicense: false };
  const o = j as Record<string, unknown>;
  return {
    status: num(o.status),
    errorCode: num(o.errorCode),
    renewAfter: num(o["renew-after"]),
    hasLicense: typeof o.license === "string" && o.license.length > 0,
  };
}

/** One license event in a few characters, for a log line (Rust caps a line's data at 600):
 *  `-2300 req 200 s0 e0 r780 630ms` · `-90 req 200 s-1004 REFUSED 410ms` · `-5 keys#3 expired 0s`
 *  · `-40 msg#3 license-renewal` · `-12000 session#3`. `ago` is ms before the failure. */
export function compactEvent(ago: number, e: {
  kind: string; http?: number; ms?: number; status?: number | null; errorCode?: number | null;
  renewAfter?: number | null; refused?: boolean; text?: string; id?: number; type?: string;
  keys?: string[]; expiresIn?: number | null; err?: string;
}): string {
  const head = `-${Math.max(0, Math.round(ago))} ${e.kind}${e.id !== undefined ? `#${e.id}` : ""}`;
  const parts: string[] = [head];
  if (e.kind === "req") {
    parts.push(String(e.http ?? "?"));
    if (e.status !== undefined && e.status !== null) parts.push(`s${e.status}`);
    if (e.errorCode !== undefined && e.errorCode !== null) parts.push(`e${e.errorCode}`);
    if (e.renewAfter !== undefined && e.renewAfter !== null) parts.push(`r${e.renewAfter}`);
    if (e.refused) parts.push("REFUSED");
    if (e.text) parts.push(JSON.stringify(e.text.slice(0, 30)));
  }
  if (e.type && e.kind !== "req") parts.push(e.type);
  if (e.keys) parts.push(e.keys.join(","));
  if (e.expiresIn !== undefined && e.expiresIn !== null) parts.push(`${e.expiresIn}s`);
  if (e.err) parts.push(e.err.slice(0, 40));
  if (e.ms !== undefined) parts.push(`${e.ms}ms`);
  return parts.join(" ");
}

const SECRET_KEY = /token|license|auth|cookie|key|signature/i;

/**
 * MusicKit's error object, for the log: its `name`, `reason`, `description` and `data`
 * (2026-10-18; only `message` was logged before, and Apple's reason may sit in the rest).
 * Fields whose names look secret are dropped, strings are cut short, and the whole is capped.
 */
export function errorFields(e: unknown): Record<string, unknown> {
  if (!e || typeof e !== "object") return {};
  const o = e as Record<string, unknown>;
  const clean = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return v.slice(0, 160);
    if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
    if (!v || typeof v !== "object" || depth > 2) return v === undefined ? undefined : typeof v;
    if (Array.isArray(v)) return v.slice(0, 5).map((x) => clean(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = clean(x, depth + 1);
    }
    return out;
  };
  const out: Record<string, unknown> = {};
  for (const k of ["name", "reason", "description", "errorCode", "data"]) {
    if (o[k] !== undefined) out[k] = clean(o[k], 0);
  }
  const text = JSON.stringify(out);
  return text.length > 400 ? { cut: text.slice(0, 400) } : out; // the line's data is cut at 600 in Rust
}

/** The cut of a hung license request (his calls, 2026-10-18; license-watch.ts § The cut). */
export const FIRST_CUT_MS = 5000;
export const RETRY_CUT_MS = 15_000;

/** When to cut a license request, after `cutsInRow` cuts with no answer between: the first at
 *  5 s, the retry at 15 s, then never (a slow network must not loop). null = no cut. */
export function cutAfterMs(cutsInRow: number): number | null {
  return cutsInRow <= 0 ? FIRST_CUT_MS : cutsInRow === 1 ? RETRY_CUT_MS : null;
}

/** A refusal: an HTTP error, a nonzero status or errorCode, or a reply with no license. */
export function isRefusal(http: number, r: LicenseReply): boolean {
  if (http !== 200) return true;
  if ((r.status ?? 0) !== 0 || (r.errorCode ?? 0) !== 0) return true;
  return !r.hasLicense;
}
