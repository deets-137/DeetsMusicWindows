// Which name a friend's row shows (FRIENDS.md §21, 2026-11-06).
//
// Two names can exist for one friend. `name` is what YOU called them: it is local, and it is
// empty until you rename them. `theirName` is what they typed in *Your name*, and it reaches
// you on their presence. Your own name for them wins; theirs fills in until you give one.
//
// This file is the pure rule, so `tests/friend-name.test.ts` can hold it still. The wiring
// (the socket, the copy kept on disk for an offline friend) is friends.ts.

/** What the app and the worker send for somebody who typed no name. It names nobody, so a row
 *  shows the friend code instead, which at least tells two such friends apart. */
const NO_NAME = "Listener";

/** A name off a presence message, or "" when it says nothing about who they are. */
export const heardName = (raw: unknown): string => {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name === NO_NAME ? "" : name;
};

/** The name to show, or "" when neither side has one (the caller has its own word for that). */
export const shownName = (friend: { name: string; theirName: string }): string =>
  friend.name || friend.theirName;
