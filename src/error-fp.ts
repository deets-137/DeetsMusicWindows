// An error's fingerprint (USAGE-COUNTS.md §16, his call 1A, 2026-10-30): what broke and where in
// our code, with no text a user typed or saw. `window.TypeError@main.js:2:4439`: how it reached
// us (an uncaught error, a promise nobody caught, a console.error), the error's type, and the
// first place in a script file. When that place is our own code and a frame from another file
// (MusicKit) called it, that file's place follows after `<`. The message is never part of it:
// a message can carry a song, a playlist or a path.
//
// The weekly health report counts installs per fingerprint; `npm run errors:where` turns the
// place back into a source line through the release's hidden source maps. Pure, so it has a
// unit test (tests/error-fp.test.ts).

export type ErrorFamily = "window" | "rejection" | "console";

/** The characters a fingerprint may hold; usage.rs and the worker hold it to the same rule. */
export const FP_RULE = /^[a-z]+\.[A-Za-z][A-Za-z0-9]{0,23}@[A-Za-z0-9_.:-]{1,48}(<[A-Za-z0-9_.:-]{1,48})?$/;

/** A frame's place, `file.js:line:col`, with the query and the build hash dropped
 *  (`/assets/main-BAWGLJv6.js` → `main.js`; `/src/player.ts?t=1` → `player.ts`). */
export function framePlace(frame: string): string | null {
  const m = /([^\s()/\\]+?)(?:\?[^\s():]*)?:(\d+):(\d+)\)?\s*$/.exec(frame.trim());
  if (!m) return null;
  const file = m[1].replace(/-[A-Za-z0-9_-]{8}(\.m?js)$/, "$1").slice(-32);
  return /^[A-Za-z0-9_.-]+$/.test(file) ? `${file}:${m[2]}:${m[3]}` : null;
}

/** Is this frame in a file we serve (not MusicKit from Apple's CDN)? */
function ours(frame: string, origin: string): boolean {
  return !/https?:\/\//.test(frame) || (!!origin && frame.includes(origin));
}

/** The type of what was thrown: an Error's name, or what a non-Error is. */
export function errorName(thrown: unknown): string {
  const n = (thrown as { name?: unknown } | null)?.name;
  if (typeof n === "string" && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(n)) return n;
  if (typeof thrown === "string") return "String";
  return "Value";
}

/** The fingerprint for one error. `stack` is the error's stack (or one taken at the call);
 *  `skip` drops that many frames from its top (the console hook's own frame); `fallback` is a
 *  place when the stack has none (`window.onerror`'s file and line). */
export function errorFp(
  family: ErrorFamily,
  thrown: unknown,
  stack: unknown,
  opts: { origin?: string; skip?: number; fallback?: string } = {},
): string {
  const frames = (typeof stack === "string" ? stack.split("\n") : [])
    .filter((l) => /^\s*at\s/.test(l))
    .slice(opts.skip ?? 0);
  const origin = opts.origin ?? "";
  const own = frames.findIndex((f) => ours(f, origin) && framePlace(f));
  let place: string | null = null;
  let via: string | null = null;
  if (own >= 0) {
    place = framePlace(frames[own]);
    const caller = frames.slice(own + 1).find((f) => !ours(f, origin) && framePlace(f));
    via = caller ? framePlace(caller) : null;
  } else {
    const any = frames.find((f) => framePlace(f));
    place = any ? framePlace(any) : null;
  }
  place = place ?? (opts.fallback ? framePlace(opts.fallback) : null) ?? "unknown";
  const fp = `${family}.${errorName(thrown)}@${place}${via ? `<${via}` : ""}`;
  return FP_RULE.test(fp) ? fp : `${family}.${errorName(thrown)}@unknown`;
}
