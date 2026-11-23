// Apple's restriction flag (QUEUE.md § The real restriction flag, 2026-11-22). Pure, with a test.
//
// MusicKit gets the account's explicit-content flag (`itre`) only from Apple's sign-in window.
// Our app hands MusicKit a bare token, so before 1.5.1 MusicKit never had the flag and guessed
// from the storefront: these 14 storefronts read as restricted, every other one as not
// restricted. The list is MusicKit's own (musickit.js v3, the `restrictedEnabled` getter).

/** The storefronts MusicKit takes as restricted when it has no flag. */
export const GUESSED_RESTRICTED = ["br", "ch", "gt", "hu", "id", "in", "it", "kr", "la", "lt", "my", "ru", "sg", "tr"] as const;

/** The saved flag (`null` = not known) and the storefront, as Rust's `apple_restrict_state` returns them. */
export interface RestrictState {
  flag: boolean | null;
  storefront: string | null;
}

/** MusicKit's guess blocks this user's explicit songs, and only a new sign-in gives the real
 *  flag: no flag is saved, and the storefront is one of the 14. */
export function needsSignIn(s: RestrictState): boolean {
  if (s.flag !== null) return false;
  const sf = (s.storefront ?? "").trim().toLowerCase();
  return (GUESSED_RESTRICTED as readonly string[]).includes(sf);
}
