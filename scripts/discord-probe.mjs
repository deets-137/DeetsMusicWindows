// Discord Rich Presence probe (FRIENDS.md §8.4) — the three measurements 7A's shape depends
// on, run against the real Discord desktop client before any app code is written.
//
// It speaks the same local IPC the app will speak: the named pipe `\\.\pipe\discord-ipc-N`,
// a 4-byte opcode, a 4-byte length, then JSON. Nothing leaves the machine, there is no bot
// and no token, and the presence it sets disappears the moment the pipe closes — which is
// why the script HOLDS the connection open and counts down instead of exiting.
//
//   node scripts/discord-probe.mjs --id <application id> [--case <name>] [--image <url>]
//                                  [--hold <seconds>] [--room <code>]
//
// Cases (each one answers a different line of §8.4):
//   full      type 2 + status_display_type + https artwork + details_url + two buttons
//   type      type 2 alone, nothing else — does "Listening to" hold on its own
//   playing   type 0, the fallback the doc names if type 2 is refused
//   art       the artwork alone, to tell an artwork failure from a field failure
//   buttons   the two buttons alone (§8.4 item 3: invisible to the account that sets them)
//
// What it prints: the READY payload (which Discord account is signed in), the activity it
// sent, and Discord's own answer — the answer is the normalized activity, so a field that
// was dropped shows up there without anyone looking at a profile. Whether the card READS
// the way we want is still a human's eyes on the profile.

import net from "node:net";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const CLIENT_ID = arg("id");
const CASE = arg("case", "full");
const HOLD = Number(arg("hold", 120));
const ROOM = arg("room", "ABCD1234");
// status_display_type (§8.4 item 1): 0 = the application's name, 1 = state (the artist),
// 2 = details (the song). 2 is the one that reads "Listening to <song>".
const SDT = Number(arg("sdt", 2));
// A real Apple Music cover, so item 2 is measured against the URLs the app actually holds.
const IMAGE = arg(
  "image",
  "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/1a/2b/3c/placeholder/source/512x512bb.jpg",
);
const SONG = arg("song", "Blue Monday");
const ARTIST = arg("artist", "New Order");
const ALBUM = arg("album", "Power, Corruption & Lies");
const LINK = arg("link", "https://music.apple.com/us/album/blue-monday/1440655511");

if (!CLIENT_ID) {
  console.error("discord-probe: --id <application id> is required (FRIENDS.md §8.1).");
  process.exit(2);
}

const now = Date.now();
const base = {
  details: SONG,
  state: ARTIST,
  timestamps: { start: now, end: now + 3 * 60 * 1000 },
};
const artwork = { large_image: IMAGE, large_text: ALBUM, small_text: "DeetsMusic" };
const buttons = [
  { label: "Play on Apple Music", url: LINK },
  { label: "Listen Along", url: `https://rooms.deets.solutions/j/${ROOM}` },
];

const CASES = {
  // Everything §8.7.1 asks for, in one activity.
  full: {
    type: 2,
    status_display_type: SDT,
    ...base,
    details_url: LINK,
    state_url: LINK,
    assets: artwork,
    buttons,
  },
  type: { type: 2, ...base },
  // status_display_type alone, so a headline change cannot be credited to anything else.
  head: { type: 2, status_display_type: SDT, ...base },
  playing: { type: 0, ...base },
  art: { type: 2, ...base, assets: artwork },
  buttons: { type: 2, ...base, buttons },
};

const activity = CASES[CASE];
if (!activity) {
  console.error(`discord-probe: unknown case "${CASE}". Try: ${Object.keys(CASES).join(", ")}`);
  process.exit(2);
}

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

const frame = (op, payload) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

/** Discord listens on the first free pipe number, so a second client (or a leftover) moves it. */
function connect(n = 0) {
  return new Promise((resolve, reject) => {
    if (n > 9) return reject(new Error("no discord-ipc pipe answered (0-9). Is Discord running?"));
    const path = `\\\\.\\pipe\\discord-ipc-${n}`;
    const sock = net.createConnection({ path });
    sock.once("connect", () => {
      console.log(`[probe] connected on discord-ipc-${n}`);
      resolve(sock);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(connect(n + 1));
    });
  });
}

const sock = await connect();

let buf = Buffer.alloc(0);
sock.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) return;
    const body = buf.subarray(8, 8 + len).toString("utf8");
    buf = buf.subarray(8 + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      console.log(`[probe] op ${op} (unparsed): ${body}`);
      continue;
    }
    if (msg.evt === "READY") {
      const u = msg.data?.user ?? {};
      console.log(`[probe] READY — signed in as ${u.username ?? "?"}${u.discriminator && u.discriminator !== "0" ? `#${u.discriminator}` : ""} (id ${u.id ?? "?"})`);
      console.log(`[probe] sending case "${CASE}":`);
      console.log(JSON.stringify(activity, null, 2));
      sock.write(
        frame(OP.FRAME, {
          cmd: "SET_ACTIVITY",
          args: { pid: process.pid, activity },
          nonce: String(now),
        }),
      );
      return;
    }
    // The answer to SET_ACTIVITY is the activity AS DISCORD KEPT IT: a field it refused is
    // simply missing here, which answers §8.4 items 1 and 2 without reading a profile.
    console.log(`[probe] answer (op ${op}):`);
    console.log(JSON.stringify(msg, null, 2));
    if (msg.evt === "ERROR") {
      console.log("[probe] Discord refused the frame. Nothing is set.");
      process.exit(1);
    }
    const kept = msg.data ?? {};
    const say = (label, ok) => console.log(`   ${ok ? "KEPT   " : "DROPPED"}  ${label}`);
    console.log("[probe] what survived:");
    say(`type ${activity.type}${kept.type === activity.type ? "" : ` (came back as ${kept.type})`}`, kept.type === activity.type);
    if ("status_display_type" in activity) say("status_display_type", "status_display_type" in kept);
    if (activity.details_url) say("details_url", !!kept.details_url);
    if (activity.assets) say("assets.large_image", !!kept.assets?.large_image);
    if (activity.buttons) say("buttons", Array.isArray(kept.buttons) ? kept.buttons.length > 0 : !!kept.buttons);
    console.log(
      `\n[probe] HOLDING the presence for ${HOLD}s — look at your own Discord profile now.\n` +
        "        (The presence disappears the moment this exits: the pipe IS the presence.)",
    );
    setTimeout(() => {
      console.log("[probe] done — clearing the activity and closing.");
      sock.write(frame(OP.FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid }, nonce: String(Date.now()) }));
      setTimeout(() => process.exit(0), 300);
    }, HOLD * 1000);
  }
});

sock.on("error", (e) => {
  console.error(`[probe] socket error: ${e.message}`);
  process.exit(1);
});
sock.on("close", () => console.log("[probe] pipe closed"));

sock.write(frame(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
