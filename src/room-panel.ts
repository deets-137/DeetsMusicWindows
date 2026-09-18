// The Room item in the title bar and its panel (docs/ROOMS.md §1).
//
// The glyph is three figures side by side, the middle one a little higher and in front.
// In a room it fills (the AirPlay square's idiom) and carries the member count.
//
// The panel wears the Sound panel's clothes (SOUND.md §2.3, src/sound-panel.ts): the same
// head with a title at the left and an action at the right, the same label-left /
// control-right rows, the same pills and chips, the same width and type scale. Only the
// content differs. Out of a room it holds your name, Start a room and Join by code; in one
// it holds the code, the two copies, the members, the host's guest-control pills and Leave.
//
// Geometry = --room-* skin tokens, color = theme roles. The panel arrives with `.pop` and
// its rows slide in with enterRows (CLAUDE.md pre-build checklist).

import { makeDropdown, keepInWindow, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { toast } from "./toast";
import {
  DEFAULT_CONTROLS,
  endRoom,
  formatCode,
  inviteLink,
  joinRoom,
  leaveRoom,
  onRoomChange,
  removeMember,
  roomName,
  roomState,
  setControls,
  setRoomName,
  startRoom,
  type GuestControls,
  type RoomState,
} from "./room";

/** The name over the panel. */
const TITLE = "DeetsRadio";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

let dropdown: DropdownHandle | null = null;
let btn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;

/** The control rows the host can hand out (§8). Pause is not here: it never greys out. */
const CONTROL_ROWS: { key: keyof GuestControls; label: string; hint: string }[] = [
  { key: "playPause", label: "Start and stop", hint: "Guests may start the music and stop it for everyone. Off: a guest's Pause stops only their own app" },
  { key: "skip", label: "Skip", hint: "Guests may play the next or the previous song for everyone" },
  { key: "seek", label: "Seek", hint: "Guests may move the play position for everyone" },
  { key: "add", label: "Add songs", hint: "Guests may add songs to the room's Up Next" },
  { key: "changeQueue", label: "Change Up Next", hint: "Guests may remove songs from Up Next and put them in another order" },
];

export function initRoomPanel(): void {
  const root = $("room");
  btn = $<HTMLButtonElement>("room-btn");
  panel = $("room-panel");
  if (!root || !btn || !panel) return;

  btn.innerHTML = glyph();
  panel.dataset.frames = "room-panel"; // frames.ts times the arrival

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    onOpen: () => {
      render(roomState());
      keepInWindow(root, panel!); // a narrow window must not push the panel off the edge
      enterRows(panel!.children);
    },
  });

  onRoomChange((state) => {
    paintButton(state);
    if (!panel!.hidden) render(state);
  });
  paintButton(roomState());
}

/** The Compass reaches the panel through this (COMPASS.md §9). */
export function openRoomPanel(): void {
  dropdown?.open();
}

// ── the title bar item ───────────────────────────────────────────────────────

/**
 * Three figures: the middle one in FRONT, the two behind it showing only the part
 * that sticks out. Drawing all three as whole figures crossed their strokes and
 * read as a knot of arcs (first cut, 2026-09-17) — an icon at 16 px has room for
 * one silhouette and two hints of one. Proportions follow the app's other line
 * glyphs: a 24 grid, 1.5 stroke, round joins.
 *
 * Only the middle figure fills in a room: it is the one in front, so it carries
 * the state, and the two behind stay line work at any size.
 */
function glyph(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle class="room__fig-head room__fig-head--side" cx="4.9" cy="10.3" r="2.1" />
    <path class="room__fig-body room__fig-body--side" d="M1.2 18.4a3.7 3.7 0 0 1 3.8-3.6" />
    <circle class="room__fig-head room__fig-head--side" cx="19.1" cy="10.3" r="2.1" />
    <path class="room__fig-body room__fig-body--side" d="M22.8 18.4a3.7 3.7 0 0 0-3.8-3.6" />
    <circle class="room__fig-head room__fig-head--mid" cx="12" cy="8" r="3.1" />
    <path class="room__fig-body room__fig-body--mid" d="M6.4 19.3a5.6 5.6 0 0 1 11.2 0Z" />
  </svg>`;
}

function paintButton(state: RoomState): void {
  if (!btn) return;
  const inRoom = state.phase === "in" || state.phase === "reconnecting";
  btn.toggleAttribute("data-in", inRoom);
  btn.toggleAttribute("data-away", state.phase === "reconnecting" || !state.hostConnected);
  btn.dataset.count = inRoom && state.members.length > 1 ? String(state.members.length) : "";
  btn.title = inRoom
    ? `${state.members.length} listening together in room ${formatCode(state.code)}`
    : "Listen with friends";
}

// ── the builders (the Sound panel's, in room clothes) ────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Label left, control right — `.sound__row`'s shape. */
function row(label: string, control: HTMLElement, cls = ""): HTMLDivElement {
  const r = el("div", `room__row ${cls}`.trim());
  r.append(el("span", "room__label", label), control);
  return r;
}
function chip(text: string, hint: string, cls = ""): HTMLButtonElement {
  const b = el("button", `room__chip ${cls}`.trim(), text);
  b.type = "button";
  b.title = hint;
  return b;
}
function field(hint: string, cls = ""): HTMLInputElement {
  const f = el("input", `room__field ${cls}`.trim());
  f.type = "text";
  f.title = hint;
  f.spellcheck = false;
  return f;
}
function note(text: string): HTMLElement {
  return el("div", "room__note", text);
}

// ── the panel ────────────────────────────────────────────────────────────────

function render(state: RoomState): void {
  if (!panel) return;
  panel.replaceChildren();
  const inRoom = state.phase === "in" || state.phase === "reconnecting";
  // Only the in-room panel can outgrow the window, and only it gains rows while it
  // is open, so only it reserves the scrollbar's gutter (styles.css).
  panel.toggleAttribute("data-scrolls", inRoom);
  panel.append(head(state, inRoom));
  if (inRoom) renderInRoom(state);
  else renderOutOfRoom(state);
}

/** The head: the title at the left, one action at the right (the Sound panel's shape). */
function head(state: RoomState, inRoom: boolean): HTMLElement {
  const h = el("div", "room__head");
  h.append(el("span", "room__title", TITLE));
  const end = el("div", "room__head-end");
  if (inRoom) {
    const leave = chip(
      state.isHost ? "End room" : "Leave room",
      state.isHost
        ? "Ends the room for everyone. Your own queue comes back"
        : "Leaves the room. Your own queue comes back",
      "room__chip--leave",
    );
    leave.addEventListener("click", () => (state.isHost ? endRoom() : leaveRoom()));
    end.append(leave);
  } else {
    end.append(el("span", "room__head-note", "Listen together"));
  }
  h.append(end);
  return h;
}

function renderOutOfRoom(state: RoomState): void {
  const busy = state.phase === "starting" || state.phase === "joining";

  const nameField = field("The name the other members see", "room__field--name");
  nameField.maxLength = 24;
  nameField.value = roomName();
  nameField.placeholder = "Listener";
  nameField.addEventListener("change", () => setRoomName(nameField.value));
  panel!.append(row("Your name", nameField));

  const start = chip("Start a room", "Makes a room from what you play now and shows its code", "room__chip--wide");
  start.disabled = busy;
  start.addEventListener("click", () => {
    setRoomName(nameField.value);
    void startRoom();
  });
  panel!.append(start);

  panel!.append(el("div", "room__divider", "or join one"));

  const codeField = field(
    "The 8-character code the host reads out. Upper or lower case, with or without the dash",
    "room__field--code",
  );
  codeField.maxLength = 9;
  codeField.placeholder = "K7QM-4XHT";
  const go = chip("Join", "Joins the room with that code");
  go.disabled = busy;
  const doJoin = () => {
    setRoomName(nameField.value);
    void joinRoom(codeField.value);
  };
  codeField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doJoin();
  });
  go.addEventListener("click", doJoin);
  const join = el("div", "room__row room__row--join");
  join.append(codeField, go);
  panel!.append(join);

  if (busy) panel!.append(note(state.phase === "starting" ? "Making the room…" : "Joining…"));
}

function renderInRoom(state: RoomState): void {
  // The code, the panel's one piece of large type, with the two copies under it.
  const code = el("div", "room__code", formatCode(state.code));
  code.title = "The code a friend types to join this room";
  panel!.append(code);

  const copies = el("div", "room__row room__row--copies");
  const copyCode = chip("Copy code", "Copies the room code");
  copyCode.addEventListener("click", () => copy(formatCode(state.code), "Room code copied."));
  const copyLink = chip("Copy invite link", "Copies a link that opens DeetsMusic and joins this room");
  copyLink.addEventListener("click", () => copy(inviteLink(), "Invite link copied."));
  copies.append(copyCode, copyLink);
  panel!.append(copies);

  if (state.phase === "reconnecting") panel!.append(note("Reconnecting…"));
  else if (!state.hostConnected) panel!.append(note("Waiting for the host"));
  if (state.stopped) panel!.append(note("You stopped listening. The room plays on."));

  // The members.
  panel!.append(el("div", "room__section", state.members.length === 1 ? "Listening" : `Listening (${state.members.length})`));
  const list = el("div", "room__members app-scroll");
  for (const member of state.members) {
    const line = el("div", "room__member");
    const who = el("span", "room__who", member.name + (member.memberId === state.memberId ? " (you)" : ""));
    line.append(who);
    if (member.isHost) {
      line.append(el("span", "room__tag", "Host"));
    } else if (state.isHost) {
      const remove = chip("Remove", `Removes ${member.name} from the room`, "room__chip--small");
      remove.addEventListener("click", () => removeMember(member.memberId));
      line.append(remove);
    }
    list.append(line);
  }
  panel!.append(list);

  // The host's controls (§8).
  if (!state.isHost) return;
  panel!.append(el("div", "room__section", "Guests may"));
  for (const control of CONTROL_ROWS) {
    panel!.append(controlRow(control, state.guestControls[control.key] ?? DEFAULT_CONTROLS[control.key]));
  }
}

function controlRow(
  control: { key: keyof GuestControls; label: string; hint: string },
  value: string,
): HTMLElement {
  const pill = el("div", "room__pill");
  for (const option of ["everyone", "host"] as const) {
    const half = el("button", "room__half", option === "everyone" ? "Everyone" : "Host only");
    half.type = "button";
    half.setAttribute("aria-pressed", String(value === option));
    half.title = control.hint;
    half.addEventListener("click", () => setControls({ [control.key]: option } as Partial<GuestControls>));
    pill.append(half);
  }
  const line = row(control.label, pill, "room__row--control");
  (line.firstElementChild as HTMLElement).title = control.hint;
  return line;
}

function copy(text: string, said: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ kind: "info", text: said }))
    .catch(() => toast({ kind: "warn", text: "Couldn't copy that." }));
}
