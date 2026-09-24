// The Friends half of the people panel (docs/integrations/FRIENDS.md §3, §6 fork 5A).
//
// The title bar item Rooms already owns becomes the people item: one glyph, one panel,
// two parts. **Friends** is the list of boxes at the top — his design, 2026-09-20: a
// friend is a rectangle you can see a cover in, not a row of text — and **DeetsRooms**
// is everything the panel held before.
//
// **The control family** (CLAUDE.md checklist 2a). Every control here is the ROOM panel's
// own: `room__chip` for a button, `room__field` for a field, `room__row` for a labelled
// line, `room__section` for a heading. Only the box itself is new, and it takes alias
// tokens (`--friend-*` → `--room-*`) rather than raw values, so a skin that restyles the
// room panel restyles this with it.
//
// **A friend's box is a `button`**, because the whole box does something: it asks to
// listen along. The right-click menu carries the song actions (his call, 2026-09-20: Play
// this and Go to Album are a menu, not buttons — a box with three buttons in it is a
// toolbar, not a person).

import { openContextMenu, type MenuItem } from "./context-menu";
import {
  addFriend,
  exportKey,
  formatFriendCode,
  friendInviteLink,
  friendsState,
  importKey,
  inviteToRoom,
  listenAlong,
  removeFriend,
  renameFriend,
  takePendingInvite,
  type FriendRow,
} from "./friends";
import { goToAlbumItem } from "./go-to";
import { playContext } from "./player";
import { roomState } from "./room";
import { setSetting } from "./settings-store";
import { toast } from "./toast";

/** How long a box keeps drawing a song after it was last heard about. Past this the row
 *  says the time instead of pretending it is live — a friend whose PC slept should not
 *  look like they are still listening. */
const STALE_MS = 30 * 60_000;

type El = HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function chip(text: string, hint: string, cls = ""): HTMLButtonElement {
  const b = el("button", `room__chip ${cls}`.trim(), text);
  b.type = "button";
  b.title = hint;
  return b;
}

/** "just now", "3 min ago", "2 h ago" — the shortest true thing (§3, 3A). */
function ago(at: number): string {
  const ms = Date.now() - at;
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Apple's artwork template at the box's own size. A friend's cover costs no Apple call:
 *  it is the URL their app already had in order to play the song (§9). */
const thumb = (url: string | null): string | null =>
  url ? url.replace(/\{w\}/g, "96").replace(/\{h\}/g, "96").replace(/\{f\}/g, "jpg") : null;

/**
 * Build the Friends part and append it to the panel. Called from `room-panel.ts`'s
 * render, so the whole panel is still one repaint.
 */
/**
 * `gate` is the room panel's "this button publishes your name, so it waits for one" rule.
 * It is PASSED IN rather than imported, so the two panels stay one-directional: the room
 * panel knows about Friends, and Friends does not need to know about the room panel.
 */
export type NameGate = (button: HTMLButtonElement) => HTMLButtonElement;

export function buildFriends(panel: El, gate: NameGate): void {
  const state = friendsState();

  if (!state.rows.length) {
    // It has to say HANDSHAKE, not "add a friend" (his call, 2026-09-20). The first
    // wording read as a one-sided add, and then nothing happens and nobody knows why.
    panel.append(
      el(
        "div",
        "room__note",
        "You and your friend need to add each other's code to add friend!",
      ),
    );
  } else {
    const list = el("div", "friend__list app-scroll");
    for (const row of state.rows) list.append(box(row));
    panel.append(list);
  }

  // Your own code, and the two ways to hand it over (§3, forks 2A and 2C).
  const mine = el("div", "room__row room__row--mine");
  mine.append(el("span", "room__label", "Your code"));
  const code = el("button", "friend__code", state.me ? formatFriendCode(state.me) : "…");
  code.type = "button";
  code.title = "Your friend code. A friend types it to add you — and you must add theirs before either of you sees anything";
  code.addEventListener("click", () => copy(formatFriendCode(state.me), "Your friend code is copied."));
  const share = chip("Link", "Copies a link that opens DeetsMusic with your code filled in", "room__chip--small");
  share.addEventListener("click", () => copy(friendInviteLink(), "Your invite link is copied."));
  mine.append(code, share);
  panel.append(mine);

  panel.append(addRow(gate));

  // The one line that says whether anybody can see you. It is here rather than in Settings
  // because this is where you look when you wonder — but only once you HAVE somebody who
  // could see you (his call, 2026-09-20). With an empty list, "your friends cannot see you"
  // is asking a person to switch something on for nobody.
  if (!state.rows.length) return;
  if (!state.sharing) {
    const line = el("div", "room__note friend__quiet", "You are not sharing, so your friends cannot see you.");
    const open = el("button", "friend__inline", "Turn on");
    open.type = "button";
    open.title = "Starts sharing what you play with the friends you added";
    open.addEventListener("click", () => setSetting("shareActivityApp", true));
    line.append(" ", open);
    panel.append(line);
  } else if (!state.connected) {
    // Rule 2 of §5.2: the panel says one quiet line and blocks nothing.
    panel.append(el("div", "room__note", "Not connected."));
  }
}

/** The add field, pre-filled when a `deetsmusic://friend?code=…` link brought one in. */
function addRow(gate: NameGate): El {
  const row = el("div", "room__row room__row--join");
  const codeField = el("input", "room__field room__field--code");
  codeField.type = "text";
  codeField.maxLength = 9;
  codeField.placeholder = "K7QM-4XHT";
  codeField.spellcheck = false;
  codeField.title = "Their 8-character friend code. Upper or lower case, with or without the dash";
  codeField.value = takePendingInvite();
  // Adding somebody puts your name in front of them, so it waits for a name like the two
  // DeetsRooms buttons do.
  const go = gate(chip("Add", "Adds them. They must add your code too before either of you sees anything"));
  const add = () => {
    const value = codeField.value.trim();
    if (!value || go.disabled) return;
    void addFriend(value, "").then((done) => {
      if (done) codeField.value = "";
    });
  };
  codeField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") add();
  });
  go.addEventListener("click", add);
  row.append(codeField, go);
  return row;
}

/**
 * One friend. The whole box is the Listen Along button when there is something to listen
 * to; otherwise it is a plain box that still carries the right-click menu.
 */
function box(row: FriendRow): El {
  const live = !!row.presence && Date.now() - row.presence.at < STALE_MS;
  // Whether they ALLOW listening along is their app's setting, not ours, so this cannot
  // be read from here. The box asks, and their answer is what decides (§7).
  const can = row.online && row.allowed && live;

  const b = el("button", "friend__box");
  b.type = "button";
  b.disabled = !can;
  b.toggleAttribute("data-offline", !row.online);

  const art = el("div", "friend__art");
  const url = live ? thumb(row.presence!.artworkUrl) : null;
  if (url) {
    const img = el("img", "friend__img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    art.append(img);
  }
  b.append(art);

  const lines = el("div", "friend__lines");
  lines.append(el("span", "friend__name", row.name || formatFriendCode(row.code)));
  if (!row.allowed) {
    lines.append(el("span", "friend__song friend__song--quiet", "Waiting for them to add you"));
  } else if (!row.online) {
    lines.append(el("span", "friend__song friend__song--quiet", "Offline"));
  } else if (!live) {
    lines.append(el("span", "friend__song friend__song--quiet", "Not playing anything"));
  } else {
    const p = row.presence!;
    lines.append(el("span", "friend__song", p.title));
    lines.append(el("span", "friend__sub", [p.artist, ago(p.startedAt)].filter(Boolean).join(" · ")));
  }
  b.append(lines);

  // A friend hosting a room gets the mark, so "they are already listening with people"
  // is visible before you press anything.
  if (live && row.presence!.room) b.append(el("span", "friend__tag", "In a room"));

  b.title = !row.allowed
    ? "They have not added your code yet. Until they do, neither of you sees the other"
    : !row.online
      ? "They are not online right now"
      : !live
        ? "They are online but not playing anything"
        : "Listen along — they host a room and you hear what they hear";

  if (can) b.addEventListener("click", () => listenAlong(row.code));
  b.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, menuFor(row, live));
  });
  return b;
}

/** The right-click menu: the song's actions, then the friend's (§3, his call 2026-09-20). */
function menuFor(row: FriendRow, live: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  const p = live ? row.presence : null;

  if (p?.catalogId) {
    items.push({
      label: "Play Now",
      run: () => void playContext([{ catalogId: p.catalogId!, context: `friend:${row.code}` }], 0),
    });
    const album = goToAlbumItem(p.catalogId, p.album || undefined);
    if (album) items.push(album);
  }
  // Invite by name (§7.1): no pasting, one message on a socket that is already open.
  if (roomState().isHost && roomState().code && row.online) {
    items.push({ label: "Invite to my room", run: () => inviteToRoom(row.code) });
  }
  items.push({
    label: "Copy their code",
    run: () => copy(formatFriendCode(row.code), "Their friend code is copied."),
  });
  items.push({
    input: {
      label: "Rename",
      placeholder: "What you call them",
      value: row.name,
      onSubmit: (value: string) => void renameFriend(row.code, value),
    },
  });
  items.push({
    label: "Remove",
    run: () => {
      void removeFriend(row.code);
      toast({
        kind: "info",
        text: `${row.name || "They"} is off your list.`,
        actions: [{ label: "Undo", run: () => void addFriend(row.code, row.name) }],
      });
    },
  });
  return items;
}

/**
 * Settings › Friends: *Copy my key* and *Paste a key* (§2a, fork 1a-A). The warning is
 * the row, not a footnote — the key IS you, and anybody holding it is you.
 */
export function copyMyKey(): void {
  void exportKey().then((key) => {
    void navigator.clipboard.writeText(key);
    toast({
      kind: "warn",
      sticky: true,
      text: "Your key is copied. It IS you — anybody who has it can be you to your friends. Paste it only into DeetsMusic on your own PC.",
      actions: [{ label: "Got it" }],
    });
  });
}

export function pasteAKey(): void {
  void navigator.clipboard.readText().then((key) => {
    if (!key.trim()) {
      toast({ kind: "warn", text: "There is no key on the clipboard." });
      return;
    }
    toast({
      kind: "warn",
      sticky: true,
      text: "Use the key on the clipboard? This PC stops being its current friend code, and friends who added the old one will not see you.",
      actions: [
        { label: "Use it", run: () => void importKey(key) },
        { label: "Cancel" },
      ],
    });
  });
}

function copy(text: string, said: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast({ kind: "info", text: said }),
    () => toast({ kind: "warn", text: "Could not reach the clipboard." }),
  );
}
