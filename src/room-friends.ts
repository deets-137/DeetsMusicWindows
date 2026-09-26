// Add a room member as a friend (docs/integrations/FRIENDS.md §18).
//
// The room is a live channel between two people at the moment they want to be friends, so
// it closes the mutual add's gap: one press on each side, and both halves are done.
//
//   You press "Add friend" on Sam's row → the room carries YOUR code to Sam alone.
//   Sam presses Add on the toast      → Sam's app adds you, and carries Sam's code back.
//   Your app sees Sam's code arrive    → you asked, so it adds Sam with no question.
//
// A friend already on your list shows "Friend" at once: each member's join carries a room
// tag made from their friend code and the room code (room-friend-rules.ts), and this app
// makes the same tag from every code on your list.
//
// The pure rules are in room-friend-rules.ts; this file is the wiring.

import * as diag from "./diag";
import { addFriend, ensureIdentity, friendsState, onFriendsChange } from "./friends";
import {
  normalizeCode,
  onFriendOffer,
  onFriendOfferFailed,
  onRoomChange,
  roomState,
  sendFriendOffer,
  type FriendOffer,
  type RoomMember,
} from "./room";
import { friendNameFromMember, offerAction, roomTag } from "./room-friend-rules";
import { toast, type ToastHandle } from "./toast";

/** What a member row shows (room-panel.ts). */
export type MemberFriendState = "self" | "friend" | "asked" | "none";

/** The room these sets belong to. A new room starts them empty. */
let roomCode = "";
/** Members you sent your code to. Their row says "Asked" (F4A: it stays, whatever they do). */
const asked = new Set<string>();
/** memberId → friend code, for every code that crossed the room this session. */
const known = new Map<string, string>();
/** Offers you have not answered yet, and their toasts. */
const offers = new Map<string, { name: string; code: string; toast: ToastHandle }>();
/** tag → friend code, for every code on your list, in THIS room. */
let tags = new Map<string, string>();
let tagsFor = "";
/** The last offer this app sent, so a refusal from the worker can be put on the right row. */
let lastSent: { to: string; name: string; ask: boolean; at: number } | null = null;

const listeners = new Set<() => void>();
/** The panel repaints on this, as it does on the room and on Friends. */
export function onRoomFriendsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = (): void => listeners.forEach((cb) => cb());

const onList = (code: string): boolean => friendsState().rows.some((r) => r.code === code);

export function memberFriendState(member: RoomMember): MemberFriendState {
  if (member.memberId === roomState().memberId) return "self";
  const code = known.get(member.memberId) ?? (member.tag ? tags.get(member.tag) : undefined);
  if (code && onList(code)) return "friend";
  if (asked.has(member.memberId)) return "asked";
  return "none";
}

/** "Add friend" on a member row. */
export async function addMemberAsFriend(member: RoomMember): Promise<void> {
  // They asked you first: the row's button is the same answer as the toast's Add.
  if (offers.has(member.memberId)) return accept(member.memberId);
  // Pressing Add friend is one of the doors that mints a friend code (§16.5).
  await ensureIdentity();
  const me = friendsState().me;
  if (!me) {
    toast({ kind: "warn", text: "Couldn't make your friend code." });
    return;
  }
  asked.add(member.memberId);
  lastSent = { to: member.memberId, name: friendNameFromMember(member.name), ask: true, at: Date.now() };
  sendFriendOffer(member.memberId, me);
  emit();
}

/** Add on the toast (or on their row): your half, then your code goes back to them. */
async function accept(from: string): Promise<void> {
  const offer = offers.get(from);
  if (!offer) return;
  offers.delete(from);
  offer.toast.dismiss();
  // F3A: Add is a mint door, so a person who never opened Friends needs no extra step.
  const added = onList(offer.code) || (await addFriend(offer.code, offer.name, `${offer.name} is now your friend.`));
  if (!added) return emit();
  const me = friendsState().me;
  if (me) {
    lastSent = { to: from, name: offer.name, ask: false, at: Date.now() };
    sendFriendOffer(from, me);
  }
  diag.log("room:friend-accept", { from });
  emit();
}

async function arrived(offer: FriendOffer): Promise<void> {
  const code = normalizeCode(offer.code);
  if (!code || code === friendsState().me) return;
  const name = friendNameFromMember(offer.name) || "A listener";
  known.set(offer.from, code);

  switch (offerAction(asked.has(offer.from), onList(code))) {
    case "answer":
      // You asked them, and this is their code coming back: the mutual add is done.
      asked.delete(offer.from);
      if (onList(code)) toast({ kind: "info", text: `${name} is already your friend.` });
      else await addFriend(code, name, `${name} is now your friend.`);
      diag.log("room:friend-done", { from: offer.from });
      break;
    case "reply": {
      // Already on your list: they only need your code. No toast, no question.
      await ensureIdentity();
      const me = friendsState().me;
      if (me) {
        lastSent = { to: offer.from, name, ask: false, at: Date.now() };
        sendFriendOffer(offer.from, me);
      }
      diag.log("room:friend-reply", { from: offer.from });
      break;
    }
    case "ask": {
      if (offers.has(offer.from)) return; // the worker sends one; this is only a guard
      const handle = toast({
        kind: "info",
        sticky: true,
        text: `${name} wants to add you as a friend.`,
        actions: [
          { label: "Add", run: () => void accept(offer.from) },
          // F4A: Not now tells them nothing. Their row keeps "Asked".
          { label: "Not now", run: () => void notNow(offer.from) },
        ],
      });
      offers.set(offer.from, { name, code, toast: handle });
      diag.log("room:friend-ask", { from: offer.from });
      break;
    }
  }
  emit();
}

function notNow(from: string): void {
  offers.delete(from);
  diag.log("room:friend-not-now", { from });
  emit();
}

/** The worker refused the offer this app just sent. */
function refused(why: string): void {
  const last = lastSent;
  if (!last || Date.now() - last.at > 10_000) return;
  lastSent = null;
  diag.warn("room:friend-refused", { to: last.to, why });
  if (!last.ask) return; // a reply that missed: they left, and their row went with them
  asked.delete(last.to);
  emit();
  if (why === "unknown-command") {
    toast({ kind: "info", text: "This room can't carry a friend ask yet. Add them by code in Friends." });
  } else if (why === "no-member") {
    toast({ kind: "info", text: `${last.name} has left the room.` });
  } else {
    toast({ kind: "warn", text: "Couldn't send your friend code." });
  }
}

/** Every code on your list, as this room's tag. Made again when the room or the list changes. */
async function remakeTags(): Promise<void> {
  const codes = friendsState().rows.map((r) => r.code).sort();
  const key = `${roomCode}|${codes.join(",")}`;
  if (!roomCode || key === tagsFor) return;
  tagsFor = key;
  const next = new Map<string, string>();
  for (const code of codes) next.set(await roomTag(roomCode, code), code);
  if (tagsFor !== key) return; // a newer list or room arrived while this one hashed
  tags = next;
  emit();
}

function reset(): void {
  for (const offer of offers.values()) offer.toast.dismiss();
  offers.clear();
  asked.clear();
  known.clear();
  tags = new Map();
  tagsFor = "";
  lastSent = null;
}

export function initRoomFriends(): void {
  onFriendOffer((offer) => void arrived(offer));
  onFriendOfferFailed(refused);
  onRoomChange((state) => {
    // A reconnect keeps the same code and the same sets; a new room, or none, starts over.
    const code = state.phase === "off" ? "" : state.code;
    if (code === roomCode) return;
    roomCode = code;
    reset();
    void remakeTags();
  });
  onFriendsChange(() => void remakeTags());
}
