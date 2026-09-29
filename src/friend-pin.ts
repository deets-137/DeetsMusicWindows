// The friend key pin (FRIENDS.md §19, 2026-09-29): trust on first use.
//
// A friend code is 40 bits of SHA-256 over a friend's Ed25519 public key. The worker checks
// that a socket's key hashes to the code it claims, but 40 bits can be ground: a stranger
// with enough GPU time can make a key with the same code and pass that check. They cannot
// make the same KEY. So the app keeps each friend's full key (friends.rs, in the DPAPI
// file) the first time the worker hands one over, and a message under that code with any
// other key is not trusted.
//
// This file is the pure rule, so `tests/friend-pin.test.ts` can hold it still. The wiring
// (what is dropped, the warning, the write to disk) is friends.ts.

/**
 * - `legacy`  the message carries no key: a worker from before the pin. Trusted as before,
 *             because refusing would blank every friend until the worker deploys.
 * - `pin`     no key is pinned yet: this one becomes the pin, and is trusted.
 * - `trust`   the pinned key.
 * - `changed` a different key under the same code. Dropped, and the user is told once.
 */
export type KeyVerdict = "legacy" | "pin" | "trust" | "changed";

/** Judge the key a message carries against the one pinned for that friend. */
export function judgeKey(pinned: string | null | undefined, seen: unknown): KeyVerdict {
  if (typeof seen !== "string" || !seen.trim()) return "legacy";
  if (!pinned) return "pin";
  return pinned === seen.trim() ? "trust" : "changed";
}

/**
 * The pins the home socket hands the worker, so the worker also refuses a WATCHER that
 * signs in under a friend's code with a different key (it would see what you play).
 * Only pinned friends appear; an old worker ignores the field.
 */
export function pinsForWorker(list: readonly { code: string; key?: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of list) if (f.key) out[f.code] = f.key;
  return out;
}
