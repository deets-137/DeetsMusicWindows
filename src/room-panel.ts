// The Room item in the title bar and its panel (docs/integrations/ROOMS.md §1).
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
import { buildFriends } from "./friends-panel";
import { ensureIdentity, onFriendsChange } from "./friends";
import { addMemberAsFriend, memberFriendState, onRoomFriendsChange } from "./room-friends";
import { enterRows } from "./pop";
import { toast } from "./toast";
import { onMeter, soundStatus } from "./sound";
import * as frames from "./frames";
import { el } from "./dom";
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
  type RoomMember,
  type RoomState,
} from "./room";

/** The name over the panel. It says **Friends**, because that is what you open it for
 *  (his call, 2026-09-20); the rooms half is a section inside it. */
const TITLE = "Friends";
/** The heading over the rooms half — Start a room and Join, under one name. */
const TITLE_ROOMS = "DeetsRooms";

/**
 * The stage: silhouettes of the people listening, you at the front, everyone who
 * joined behind you and to the sides (his design, 2026-09-17; confirmed from a
 * mockup before any of it was written).
 *
 * **Three figures, and no more** (his call the same day): the stage is a picture of
 * a room, not a count of it. The member list under it is the count. A fourth
 * silhouette bought nothing and cost the panel its width.
 */
const STAGE_MAX = 3;

/**
 * The heads move ONLY to the loudness meter, and the meter only exists while the
 * Sound graph is routed — which is while an effect is on (SOUND.md §1: nothing is
 * routed while everything is off, at zero cost). **His call, 2026-09-17: no steady
 * fallback bob.** A made-up rhythm against a slow song is worse than stillness, and
 * nobody pays for an analyser they did not ask for. With Sound off the stage is a
 * still picture of the room, which is most of what it is for.
 */
const BOB_MAX_PX = 7;
/** Hops arrive every 100 ms; a gap this long means the music or the graph stopped. */
const BOB_IDLE_MS = 400;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

let dropdown: DropdownHandle | null = null;
let btn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let idleTimer: number | undefined;

/** The control rows the host can hand out (§8). Pause is not here: it never greys out. */
const CONTROL_ROWS: { key: keyof GuestControls; label: string; hint: string }[] = [
  { key: "playPause", label: "Play", hint: "Guests may start the music and stop it for everyone. Off: a guest's Pause stops only their own app" },
  { key: "skip", label: "Skip", hint: "Guests may play the next or the previous song for everyone" },
  { key: "seek", label: "Seek", hint: "Guests may move the play position for everyone" },
  { key: "add", label: "Add songs", hint: "Guests may add songs to the room's Up Next" },
  { key: "changeQueue", label: "Reorder", hint: "Guests may remove songs from Up Next and put them in another order" },
];

/**
 * Is the Permissions fold open (§16.7)? The panel is rebuilt on every room change — a
 * member joins, the host reconnects — so the state cannot live in the DOM, or the fold
 * would shut under the host's hand. It starts shut, the Sound panel's rule for a fold,
 * and it forgets when you leave the room.
 */
let permsOpen = false;

export function initRoomPanel(): void {
  const root = $("room");
  btn = $<HTMLButtonElement>("room-btn");
  panel = $("room-panel");
  if (!root || !btn || !panel) return;

  btn.innerHTML = glyph();
  panel.dataset.frames = "room-panel"; // frames.ts times the arrival
  // Rows arrive while the panel is open — a member joins, "Waiting for the host" shows —
  // so the gutter is measured again whenever the panel's own box changes, not only on a
  // render.
  new ResizeObserver(() => requestAnimationFrame(measureGutters)).observe(panel);

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    onOpen: () => {
      // Opening the panel is the moment Friends is wanted, so it is one of the three doors
      // that mints a friend code (FRIENDS.md §16.5). It writes one small file and makes no
      // network call; the panel repaints through onFriendsChange when the code arrives.
      void ensureIdentity();
      render(roomState());
      keepInWindow(root, panel!); // a narrow window must not push the panel off the edge
      // A shut fold is display:none: it would take the class and never hear the
      // animation end, then play its arrival late, when you open it.
      enterRows([...panel!.children].filter((c) => !(c as HTMLElement).hidden));
    },
  });

  onRoomChange((state) => {
    if (state.phase === "off") permsOpen = false; // a new room starts with the fold shut
    paintButton(state);
    if (!panel!.hidden) render(state);
  });

  // A friend started a song, went offline or was added: repaint only while the panel is
  // open. Nothing here costs anything when it is shut — reading is a side effect of being
  // connected (FRIENDS.md §5.1 rule 5), so no work is done for a panel nobody is looking at.
  onFriendsChange(() => {
    if (!panel!.hidden) render(roomState());
  });
  // A member row's Add friend / Asked / Friend (FRIENDS.md §18).
  onRoomFriendsChange(() => {
    if (!panel!.hidden) render(roomState());
  });
  paintButton(roomState());

  // The meter's 100 ms hops drive the bob. The subscription is permanent and the
  // work is one style write per hop, only while the panel is open: no loop, no
  // rAF, and nothing at all while the panel is shut or the graph is not routed.
  onMeter((ms) => {
    if (!stage || !panel || panel.hidden) return;
    if (reduced()) return;
    // The hop is a mean square with MusicKit's volume still in it. The fourth root
    // pulls a quiet passage up into something the eye can see without the loud
    // parts pinning the heads at the top.
    const level = Math.min(1, Math.pow(Math.max(ms, 0), 0.25) * 1.9);
    stage.style.setProperty("--room-bob", `${(level * BOB_MAX_PX).toFixed(1)}px`);
    stage.toggleAttribute("data-bobbing", true);
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      stage?.style.setProperty("--room-bob", "0px");
      stage?.removeAttribute("data-bobbing");
    }, BOB_IDLE_MS);
  });
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  btn.title = inRoom
    ? `${state.members.length} listening together in room ${formatCode(state.code)}`
    : "Listen with friends";
}

// ── the builders (the Sound panel's, in room clothes) ────────────────────────

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
  // Where the two parts sit RIGHT NOW, read before the panel is rebuilt. It is what the
  // slide below plays back from (`slideParts`).
  const before = new Map<string, number>();
  if (!panel.hidden) {
    for (const part of panel.querySelectorAll<HTMLElement>("[data-part]")) {
      before.set(part.dataset.part ?? "", part.getBoundingClientRect().top);
    }
  }

  panel.replaceChildren();
  gated.length = 0; // the buttons are rebuilt below; the old ones are gone
  const inRoom = state.phase === "in" || state.phase === "reconnecting";
  // "A room is open or actively joined" — starting and joining count, so the section
  // travels up the moment you press the button rather than when the socket lands.
  const roomLive = state.phase !== "off";

  panel.append(head(state, inRoom));
  panel.append(buildStage(state, inRoom));
  // Your name first, and REQUIRED (his call, 2026-09-20). It is not a room setting: it is
  // what a friend's box and a room's member list BOTH call you, so it sits above the two
  // halves rather than inside one of them — and nothing that publishes it works until it
  // is filled in.
  panel.append(nameRow(state));

  const friends = part("friends", "Friends", "The people you added, and what they are playing");
  buildFriends(friends.body, (b) => gateOnName(b));

  const rooms = part("rooms", TITLE_ROOMS, "Start a room, or join one with a code");
  if (inRoom) renderInRoom(state, rooms.body);
  else renderOutOfRoom(state, rooms.body);

  // In a room, the room is what you came for, so it goes first (his call, 2026-09-20).
  // Out of one, Friends is the part you look at.
  if (roomLive) panel.append(rooms.box, friends.box);
  else panel.append(friends.box, rooms.box);

  slideParts(before);
  requestAnimationFrame(measureGutters); // the rows are in place; ask what really overflows
}

/**
 * Is a part open? Both start **open** (his call, 2026-09-20) and the state lives here
 * rather than in the DOM, because the panel is rebuilt on every room change and every
 * friend's song — a fold that lived in the markup would spring shut under your hand.
 *
 * It is deliberately NOT a stored setting: it is how the panel is arranged this session,
 * not a preference about the app.
 */
const partOpen: Record<string, boolean> = { friends: true, rooms: true };

/**
 * One collapsible part: a heading that folds, and the box under it. The heading is the
 * `.room__fold-btn` family the Permissions fold already uses — same size, same colour,
 * same turning caret — so the panel has one idiom for "this opens", not two.
 */
function part(id: string, label: string, hint: string): { box: HTMLElement; body: HTMLElement } {
  const box = el("div", "room__part");
  box.dataset.part = id;
  const body = el("div", "room__part-body");
  body.hidden = !partOpen[id];
  const button = el("button", "room__fold-btn room__fold-btn--part", label);
  button.type = "button";
  button.title = hint;
  button.setAttribute("aria-expanded", String(partOpen[id]));
  button.addEventListener("click", () => {
    partOpen[id] = body.hidden;
    body.hidden = !partOpen[id];
    button.setAttribute("aria-expanded", String(partOpen[id]));
    if (partOpen[id] && !reduced()) enterRows(Array.from(body.children) as HTMLElement[]);
    requestAnimationFrame(measureGutters);
  });
  box.append(button, body);
  return { box, body };
}

/** How long the two parts take to change places. */
const SLIDE_MS = 260;

/**
 * The gentle slide when the parts change places (his call, 2026-09-20). A FLIP: each part
 * is put back where it was with a transform, then released to travel to where it now is.
 *
 * It fires only when a part really moved, so the ordinary rebuild — a friend's song
 * changing, a member joining — animates nothing. Reduced motion snaps, as everywhere else.
 */
function slideParts(before: Map<string, number>): void {
  if (!panel || before.size < 2 || reduced()) return;
  const moving: [HTMLElement, number][] = [];
  for (const part of panel.querySelectorAll<HTMLElement>("[data-part]")) {
    const was = before.get(part.dataset.part ?? "");
    if (was === undefined) return; // a part that was not there cannot slide from anywhere
    moving.push([part, was - part.getBoundingClientRect().top]);
  }
  if (!moving.some(([, delta]) => Math.abs(delta) > 1)) return;

  for (const [part, delta] of moving) {
    part.style.transition = "none";
    part.style.transform = `translateY(${delta}px)`;
  }
  frames.during("room-part-slide", SLIDE_MS);
  requestAnimationFrame(() => {
    for (const [part] of moving) {
      part.style.transition = ""; // back to the token in styles.css
      part.style.transform = "";
    }
  });
}

/**
 * Who needs the scrollbar's gutter, measured rather than assumed (styles.css). The old
 * rule opened it on every in-room panel, so a panel that fitted still carried a blank
 * strip down its side.
 *
 * Both boxes open the gutter WITHOUT changing their own content box — the panel widens
 * by the bar, the member list reaches into the panel's padding by the bar — so the
 * answer to "does this overflow" is the same before and after the attribute is written.
 * That is what stops this from flipping on and off for ever. The write is skipped when
 * nothing changed, and it runs a frame late, outside the ResizeObserver's own delivery,
 * so it cannot raise the loop warning.
 */
function measureGutters(): void {
  if (!panel || panel.hidden) return;
  const boxes: (HTMLElement | null)[] = [
    panel,
    panel.querySelector(".room__members"),
    panel.querySelector(".friend__list"),
  ];
  for (const box of boxes) {
    if (!box) continue;
    const scrolls = box.scrollHeight > box.clientHeight + 1;
    if (scrolls !== box.hasAttribute("data-scrolls")) box.toggleAttribute("data-scrolls", scrolls);
  }
}

/**
 * The stage. Out of a room it holds one still figure — the room you have not made
 * yet — and in one it fills from the middle outwards as people join.
 *
 * Decorative: the member list below is what actually says who is here, so this is
 * `aria-hidden` and carries no text a screen reader needs.
 */
function buildStage(state: RoomState, inRoom: boolean): HTMLElement {
  const box = el("div", "room__stage");
  box.setAttribute("aria-hidden", "true");
  box.dataset.frames = "room-stage";
  const count = inRoom ? Math.max(1, state.members.length) : 1;
  const shown = Math.min(count, STAGE_MAX);

  // Drawn from the back forwards, so the front figure is painted over the others
  // without a z-index on every one of them.
  for (let rank = shown - 1; rank >= 0; rank--) {
    const side = rank === 0 ? 0 : rank % 2 ? -1 : 1;
    const depth = Math.ceil(rank / 2);
    const fig = el("div", `room__figure${rank === 0 ? " room__figure--you" : ""}`);
    fig.style.setProperty("--fig-x", `${side * depth}`);
    fig.style.setProperty("--fig-depth", `${depth}`);
    fig.innerHTML = figure();
    box.append(fig);
  }
  // Past three the stage stops drawing people and simply says how many are here.
  if (count > shown) box.append(el("span", "room__stage-more", `+${count - shown}`));

  // Why the heads may be still: said once, where the stillness is (§16.6).
  box.title = inRoom
    ? soundStatus().routed
      ? "Everyone listening. The heads move with the music"
      : "Everyone listening. The heads move with the music when Sound is on"
    : "Start a room and the others join here";
  stage = box;
  return box;
}

/**
 * The same figure as the title bar glyph, and hollow like it (his call, 2026-09-17):
 * line work, not a filled shape. The shoulders are an open arc whose ends meet the
 * stage's own floor, so the figure stands on it rather than carrying a baseline of
 * its own. The stroke does not scale with the rank behind (`non-scaling-stroke`), so
 * the figures at the back keep a line you can see.
 *
 * ONE TO ONE WITH `glyph()`'s middle figure (2026-09-18, his call). It is that figure
 * multiplied by 5, the largest whole scale the 64x80 box takes (the head clears the top
 * at 5.28, the shoulders clear the sides at 5.04), with the baseline on the floor:
 *
 *     head cy 8 -> 23.5   r 3.1 -> 15.5   shoulders 5.6 -> 28   baseline 19.3 -> 80
 *
 * so all three proportions are the glyph's to four decimals — the head sits 0.8387
 * radii above the shoulders, the shoulders reach 1.8065 radii to each side, and the
 * floor is 2.6452 radii below the head. The first cut picked its numbers by eye and
 * drifted to a 1.40-radii gap, which at 62 px read as a head floating over an
 * unrelated hump.
 *
 * TWO THINGS DELIBERATELY DO NOT SCALE.
 *   - The `Z`. The glyph's bust is closed because it floats 4.7 units above its box;
 *     here the stage's own floor closes it, which is the point of the open arc.
 *   - The stroke. Scaling it would give 7.3 px of line on a 30 px head — an icon's
 *     weight is an optical choice for 16 px, not a proportion. The stage keeps the
 *     app's line-work weight, `--room-fig-stroke`.
 */
function figure(): string {
  return `<svg viewBox="0 0 64 80" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="3.2" stroke-linecap="round" vector-effect="non-scaling-stroke">
    <circle class="room__figure-head" cx="32" cy="23.5" r="15.5" vector-effect="non-scaling-stroke" />
    <path class="room__figure-body" d="M4 80a28 28 0 0 1 56 0" vector-effect="non-scaling-stroke" />
  </svg>`;
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
  }
  // Out of a room the head end is EMPTY (his call, 2026-09-20). "Listen together" was a
  // subtitle for a panel called DeetsRooms; a panel called Friends does not need one.
  h.append(end);
  return h;
}

/** Is there a name to publish? Everything that puts you in front of somebody else needs
 *  one, so this gates Start a room, Join and Add a friend. */
const haveName = (): boolean => roomName().length > 0;

/**
 * *Your name*, at the top and required. Shown in a room as well as out of one: a friend's
 * box reads it live, so it is never irrelevant. Renaming inside a room reaches your
 * friends at once and that room's member list at the next join — the hint says so.
 */
function nameRow(state: RoomState): HTMLElement {
  const inRoom = state.phase === "in" || state.phase === "reconnecting";
  const nameField = field(
    inRoom
      ? "What your friends and the other members call you. A change here reaches your friends at once, and this room at the next join"
      : "What your friends and the other members call you. It is needed before you can add a friend or start a room",
    "room__field--name",
  );
  nameField.maxLength = 24;
  nameField.value = roomName();
  nameField.placeholder = "Type a name";
  nameField.required = true;
  nameField.toggleAttribute("data-empty", !haveName());
  // `input`, not `change`: the gated buttons unlock on the first letter rather than when
  // the field happens to lose focus. It must NOT re-render — a rebuilt field loses the
  // caret half way through a name.
  nameField.addEventListener("input", () => {
    setRoomName(nameField.value);
    const have = haveName();
    nameField.toggleAttribute("data-empty", !have);
    for (const b of gated) b.disabled = !have || b.dataset.busy === "1";
  });
  return row("Your name", nameField, "room__row--name");
}

/**
 * The buttons that publish your name: Start a room, Join, and Friends' own Add. They are
 * collected per render and unlocked by the name field above, so the rule lives in one
 * place instead of three.
 */
const gated: HTMLButtonElement[] = [];
function gateOnName(button: HTMLButtonElement, busy = false): HTMLButtonElement {
  button.dataset.busy = busy ? "1" : "0";
  button.disabled = busy || !haveName();
  if (!haveName()) button.title = `${button.title}. Type your name first`;
  gated.push(button);
  return button;
}

function renderOutOfRoom(state: RoomState, into: HTMLElement): void {
  const busy = state.phase === "starting" || state.phase === "joining";

  // Your name moved to the top of the panel (his call, 2026-09-20) — it is not a room
  // setting, and Friends needs it too.
  const start = gateOnName(
    chip("Start a room", "Makes a room from what you play now and shows its code", "room__chip--wide"),
    busy,
  );
  start.addEventListener("click", () => void startRoom());
  into.append(start);

  // No "or join one" divider: Start a room and Join are one section now, DeetsRooms.
  const codeField = field(
    "The 8-character code the host reads out. Upper or lower case, with or without the dash",
    "room__field--code",
  );
  codeField.maxLength = 9;
  codeField.placeholder = "K7QM-4XHT";
  const go = gateOnName(chip("Join", "Joins the room with that code"), busy);
  const doJoin = () => {
    if (go.disabled) return;
    void joinRoom(codeField.value);
  };
  codeField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doJoin();
  });
  go.addEventListener("click", doJoin);
  const join = el("div", "room__row room__row--join");
  join.append(codeField, go);
  into.append(join);

  if (busy) into.append(note(state.phase === "starting" ? "Making the room…" : "Joining…"));
}

function renderInRoom(state: RoomState, into: HTMLElement): void {
  // The code, the panel's one piece of large type, with the two copies under it.
  const code = el("div", "room__code", formatCode(state.code));
  code.title = "The code a friend types to join this room";
  into.append(code);

  const copies = el("div", "room__row room__row--copies");
  const copyCode = chip("Copy code", "Copies the room code");
  copyCode.addEventListener("click", () => copy(formatCode(state.code), "Room code copied."));
  const copyLink = chip("Copy invite link", "Copies a link that opens DeetsMusic and joins this room");
  copyLink.addEventListener("click", () => copy(inviteLink(), "Invite link copied."));
  copies.append(copyCode, copyLink);
  into.append(copies);

  if (state.phase === "reconnecting") into.append(note("Reconnecting…"));
  else if (!state.hostConnected) into.append(note("Waiting for the host"));
  if (state.stopped) into.append(note("You stopped listening. The room plays on."));

  // The members.
  into.append(el("div", "room__section", state.members.length === 1 ? "Listening" : `Listening (${state.members.length})`));
  const list = el("div", "room__members app-scroll");
  for (const member of state.members) {
    const line = el("div", "room__member");
    const who = el("span", "room__who", member.name + (member.memberId === state.memberId ? " (you)" : ""));
    // The name takes the room left over; Host, the friend control and Remove sit together
    // at the end (FRIENDS.md §18).
    const end = el("span", "room__member-end");
    if (member.isHost) end.append(el("span", "room__tag", "Host"));
    const friendly = friendControl(member);
    if (friendly) end.append(friendly);
    if (!member.isHost && state.isHost) {
      const remove = chip("Remove", `Removes ${member.name} from the room`, "room__chip--small");
      remove.addEventListener("click", () => removeMember(member.memberId));
      end.append(remove);
    }
    line.append(who, end);
    list.append(line);
  }
  into.append(list);

  // The host's controls, in one fold (§8, §16.7). The Sound panel's fold: a row with a
  // turning caret, and the rows in a tinted box under it.
  if (!state.isHost) return;
  const body = el("div", "room__fold");
  body.hidden = !permsOpen;
  body.append(el("div", "room__section room__section--first", "Guests may"));
  for (const control of CONTROL_ROWS) {
    body.append(controlRow(control, state.guestControls[control.key] ?? DEFAULT_CONTROLS[control.key]));
  }
  into.append(foldButton("Permissions", "Shows what a guest may do: play, skip, seek, add songs and reorder Up Next", body), body);
}

/**
 * A member row's friend control (FRIENDS.md §18): an Add friend chip (the Remove chip's
 * family), or the Host tag's family for "Asked" and "Friend". Nothing on your own row.
 */
function friendControl(member: RoomMember): HTMLElement | null {
  const said = memberFriendState(member);
  if (said === "self") return null;
  if (said === "friend") {
    const tag = el("span", "room__tag", "Friend");
    tag.title = `${member.name} is on your Friends list`;
    return tag;
  }
  if (said === "asked") {
    const tag = el("span", "room__tag", "Asked");
    tag.title = `You sent ${member.name} your friend code. They are added when they press Add`;
    return tag;
  }
  const add = chip(
    "Add friend",
    `Sends ${member.name} your friend code. One press on their side adds you both`,
    "room__chip--small",
  );
  add.addEventListener("click", () => {
    add.disabled = true; // one offer per person; the row repaints to "Asked"
    void addMemberAsFriend(member);
  });
  return add;
}

/** A fold: the button and the box it opens (`.sound__fold-btn`, sound-panel.ts). */
function foldButton(label: string, hint: string, body: HTMLElement): HTMLButtonElement {
  const b = el("button", "room__fold-btn", label);
  b.type = "button";
  b.title = hint;
  b.setAttribute("aria-expanded", String(permsOpen));
  b.addEventListener("click", () => {
    permsOpen = body.hidden;
    body.hidden = !permsOpen;
    b.setAttribute("aria-expanded", String(permsOpen));
    if (permsOpen && !reduced()) enterRows(Array.from(body.children));
  });
  return b;
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
