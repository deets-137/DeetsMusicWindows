// Writes the launch tour's rules and steps into docs/guide/launch-tour.json from
// launch-tour-songs.json (guide/SHOTS.md §5k). Run it after any song change:
//   node docs/guide/launch-tour-rules.cjs
//
// The looks are STATE rules (while the song's album is one of a look's albums: its skin, and its
// layout), so they lay an overlay and never write his own settings. A song with `player` gets a
// moment rule on its start. The engine fires ONE moment rule per event (pickMoment): two moment
// rules on one event lose one (take 5, 2026-10-21), so keep one per song.
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "launch-tour.json");
const j = JSON.parse(fs.readFileSync(f, "utf8"));
const songs = JSON.parse(fs.readFileSync(path.join(__dirname, "launch-tour-songs.json"), "utf8")).songs.filter((s) => s.id);
const s = j.shots[0];
const src = { user: true };

// One state rule per look: two songs of one look (Metal's) share it, so the skin holds across
// the press between them and the cover change runs in that skin.
const looks = [];
for (const song of songs) {
  let l = looks.find((x) => x.look === song.look);
  if (!l) looks.push((l = { look: song.look, albums: [], maxCards: song.maxCards }));
  l.albums.push(song.album);
}
const rules = looks.map((l) => ({
  id: `tour-${l.look}`, kind: "state", source: src, on: true, name: `Launch tour: ${l.look}`,
  while: { fact: "album", is: l.albums.length === 1 ? l.albums[0] : l.albums },
  set: [{ target: { key: "skin" }, value: l.look }, ...(l.maxCards ? [{ target: { key: "maxCards" }, value: l.maxCards }] : [])],
  onHand: "next",
}));
for (const song of songs.filter((x) => x.player)) {
  rules.push({ id: `tour-player-${song.look}`, kind: "moment", source: src, on: true, name: `Launch tour: player ${song.player}`, when: "song.play", card: "*", if: { fact: "album", is: song.album }, do: { player: song.player } });
}
s.settings = { ...s.settings, rules: { v: 1, rules } };

const NEXT = '[data-slot="np"] .np__btn:not(.np__btn--play):last-of-type';
const title = "document.querySelector('[data-slot=\"np\"] .np__title')?.textContent";
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// How long each song stays on screen after its Next: long enough for its look's change and its
// own feature (the full player's open, the zoetrope).
// Review 1 (2026-10-21): about 2.5 s with nothing moving reads as dead air, so each hold is the
// look change plus about a second of its feature.
const HOLD = { ocean: 2200, glass: 2600, metal: 3000, cyber: 2200, press: 2000 };
// His call (2026-10-21): no Midi; the clip is Max from the first frame. Deets says each song's
// caption (his words) once its look has landed: the cut removes the look change's dark hold and
// 0.6 s more (launch-tour.mjs), so the bubble comes ~1.4 s after the press.
const SAY_AT = 1400, SAY_MS = 1700;
const tour = JSON.parse(fs.readFileSync(path.join(__dirname, "launch-tour-songs.json"), "utf8"));
const say = (text, ms = SAY_MS) => (text ? [{ say: text, ms }] : []);
const steps = [{ wait: 400 }, { click: '[data-slot="np"] #np-playpause' }, { wait: 500 }, ...say(songs[0].caption), { wait: HOLD.press }];
songs.slice(1).forEach((song) => {
  const hold = HOLD[song.look] ?? 3200;
  steps.push({ click: NEXT }, { wait: SAY_AT }, ...say(song.caption), { wait: Math.max(300, hold - SAY_AT) });
  steps.push({ probe: title, expect: `/^${esc(song.title)}/`, name: song.title });
});
steps.push(
  { key: "Escape" },
  { wait: 1500 },
  { rightclick: '[data-slot="np"] .np__meta', region: '[data-slot="np"]' }, // the cut zooms on the menu
  { wait: 500 },
  { eval: "[...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim().startsWith('Start a Web')).dataset.shot = 'web'" },
  { click: '[data-shot="web"]' },
  { wait: 1200 },
  ...say(tour.web?.caption, 2200),
  { wait: 7800 },
  ...say(tour.end?.caption, 2400),
  ...(tour.end?.caption ? [{ wait: 2400 }] : []),
  { eval: "(async () => { const m = window.MusicKit && MusicKit.getInstance(); if (m && m.isPlaying) await m.pause(); })()" },
);
s.steps = steps;
s.size = "max";
// The guide (review 1): 3× so they read at GIF size; a faster walk; after a press they step to
// the quietest spot, off the cover, the title and the Queue's playing row.
s.guide = { scale: 3, travel: 500, restAfter: 600 };
const total = Math.ceil(steps.reduce((t, x) => t + (x.wait ?? 0) + (x.click || x.rightclick ? 1000 : 0), 0) / 1000) + 3;
s.seconds = total;
s.strip = { fps: 2, seconds: total, cols: 10, width: 320, from: 0 };
fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
console.log(`${songs.length} songs, ${rules.length} rules, ${steps.length} steps, ${total} s`);
