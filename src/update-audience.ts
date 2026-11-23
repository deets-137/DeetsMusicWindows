// A release for one group of users (UPDATE-CARD.md §3.23, his call 2026-11-22). A release marked
// `### Show after update` with a group name under it opens the update card only for users in that
// group. Each group is one test here; the names are `AUDIENCES` (release-leads.ts), and the
// Record type makes tsc fail a name with no test.

import { invoke } from "@tauri-apps/api/core";
import type { Audience } from "./release-leads";
import { needsSignIn, type RestrictState } from "./restrict-rules";

/** Rust's saved restriction flag and cached storefront (no Apple call). */
export const restrictState = (): Promise<RestrictState> => invoke<RestrictState>("apple_restrict_state");

const TESTS: Record<Audience, () => Promise<boolean>> = {
  // 1.5.1: MusicKit guessed "restricted" from the storefront, and only a new sign-in gives
  // Apple's real flag (QUEUE.md § The real restriction flag).
  "explicit-sign-in": async () => needsSignIn(await restrictState()),
};

/** Is this user in the group? An unknown name or a failed test counts as not in it. */
export async function inAudience(name: string): Promise<boolean> {
  const test = (TESTS as Record<string, (() => Promise<boolean>) | undefined>)[name];
  if (!test) return false;
  try {
    return await test();
  } catch (e) {
    console.warn("[updates] audience test failed:", name, e);
    return false;
  }
}

/** The marked versions this user should see: every marked release with no group, and those
 *  whose group the user is in. */
export async function markedForUser(shown: string[], audiences: Record<string, string>): Promise<string[]> {
  const out: string[] = [];
  for (const v of shown) {
    const group = audiences[v];
    if (!group || (await inAudience(group))) out.push(v);
  }
  return out;
}
