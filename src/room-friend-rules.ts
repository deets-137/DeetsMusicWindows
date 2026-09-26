// The pure rules of "Add a room member as a friend" (docs/integrations/FRIENDS.md §18).
// No DOM, no socket, no Tauri: room-friends.ts does the wiring, and tests/room-friend-rules
// checks these.

/**
 * A member's room tag (§18.5): the first 16 hex characters of SHA-256 over the room code and
 * the friend code. Only a member who already holds that friend code can make the same tag,
 * and a new room gives a new tag, so a stranger cannot follow one person from room to room.
 */
export async function roomTag(roomCode: string, friendCode: string): Promise<string> {
  const bytes = new TextEncoder().encode(`deetsmusic-room-tag:${roomCode}:${friendCode}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What an arriving friend offer does (§18.2, §18.5):
 *   - "answer" — you asked them first, so this is their answer: add them, no question;
 *   - "reply"  — they are already on your list, so send your code back, with no toast;
 *   - "ask"    — a new person: the toast with Add and Not now.
 */
export type OfferAction = "answer" | "reply" | "ask";
export function offerAction(askedThem: boolean, alreadyFriend: boolean): OfferAction {
  if (askedThem) return "answer";
  if (alreadyFriend) return "reply";
  return "ask";
}

/** The room makes two equal names unique as `Sam (2)`. The friend is called `Sam`. */
export function friendNameFromMember(name: string): string {
  return name.replace(/\s\(\d+\)$/, "").trim();
}
