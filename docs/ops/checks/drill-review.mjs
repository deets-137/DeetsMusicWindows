// The drilldown motion review (CARD-GROW.md §14–§15, §22): Go to Album and Go to Artist on
// the running dev app, in his Max layout (History, Settings, Home, Playlists). Writes
// drill-review.json beside this file; run that with
//   node scripts/shots.mjs --list docs/ops/checks/drill-review.json
// Every shot starts and ends with History in the left slot and no grow, and checks it. It plays
// nothing. The cold shot reloads the page (stop the music first). The skins and his
// "Grow on album or artist" row are set per shot by the runner and put back after it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "./sweep-helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const L = '[data-slot="left"] ';
const SKINS = ["vanilla", "press", "ocean", "glass", "cyber", "metal"];

/** Back until History is in the left slot again, then no grow (a run that stopped midway). */
const reset = {
  eval: `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 5 && __drill.state().layout.left !== 'history'; i++) {
      const b = document.querySelector('${L}.panel__back:not([hidden])');
      if (!b) break;
      b.click();
      await sleep(1100);
    }
    if (__grow.state()) { __grow.collapse('review'); await sleep(700); }
    document.querySelectorAll('.ctx-menu').forEach(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  })()`,
};
/** The menu's Go to Album on History's second row, pressed with the pointer. */
const goToAlbum = (frames = 100) => [
  { rightclick: `${L}li.qrow[data-idx="1"]` },
  { wait: 350 },
  { eval: "[...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === 'Go to Album').dataset.shot = 'goalbum'" },
  { click: '[data-shot="goalbum"]', frames, region: ".bento" },
];
const back = (frames = 100, name = "back") => ({ click: `${L}.panel__back`, frames, region: ".bento", name });
const artistLink = (frames = 100) => ({ click: `${L}.lib-hero__sub--link`, frames, region: ".bento" });
const where = (expect, name) => ({
  probe: `JSON.stringify({ left: __drill.state().layout.left, head: document.querySelector('${L}.panel__title')?.textContent, grown: __grow.state()?.mode ?? null })`,
  expect,
  name,
});
/** Nothing left over: History back, no grow, no copy, no class of a motion. */
const clean = {
  probe: `JSON.stringify({ layout: __drill.state().layout, grown: __grow.state(), chain: (__drill.state().chains.left ?? []).length, ghosts: document.querySelectorAll('.drill-swap__ghost').length, classes: document.querySelectorAll('.is-drill-swap,.is-grow-rebuild,.is-covering,.is-uncovering,.is-covered').length })`,
  // His Max layout, every slot: a Go to from the stage's Queue summons Search into the least
  // recently used slot, and only the left slot was checked (2026-10-21, Playlists replaced).
  expect: { layout: { left: "history", right: "settings", c: "home", d: "playlists" }, grown: null, chain: 0, ghosts: 0, classes: 0 },
  name: "clean",
};
/** The monitor over the bento's parts, then every kind of hit it saw (smooth-monitor.js). */
const arm = (ms) => watch([`${L}.coll-pane`, `${L}.lib-hero`, `${L}.lib-hero__art`, ".drill-swap__ghost", `${L}.qrow`], ms);
const report = (name) => [
  { wait: 400 },
  {
    probe: "JSON.stringify((({ flash, snap, jitter, teleport, rowjump, frames }) => ({ flash, snap, jitter, teleport, rowjump, frames }))(window.__mon))",
    name: `motion: ${name}`,
  },
];

const shot = (id, about, steps, extra = {}) => ({
  id,
  about,
  covers: "cards/CARD-GROW.md",
  kind: "clip",
  source: "dev",
  size: "max",
  seconds: extra.seconds ?? 6,
  // His Max look on 2026-10-21 (Ocean, four cards), set for the shot and put back after it, so a
  // run does not depend on what another session left on the dev app.
  settings: { skin: "ocean", maxCards: "4", ...(extra.settings ?? {}) },
  ...(extra.prepare ? { prepare: extra.prepare } : {}),
  steps: [reset, { wait: 500 }, ...steps, reset, { wait: 300 }, clean],
});

const shots = [
  // ── his look, his row (Grow on album or artist: Full) ──
  shot("rule-album", "His look: Go to Album from History; Search takes the slot and Fill is the one motion. Back: the slide back, then the collapse.", [
    ...arm(5000),
    ...goToAlbum(),
    { wait: 1800 },
    where({ left: "search", head: "Album", grown: "full" }, "in"),
    back(130),
    { wait: 1600 },
    where({ left: "history", grown: null }, "out"),
    ...report("rule-album"),
  ]),
  shot("rule-album-artist", "His look: Go to Album, then the album's artist inside the filled Search card, Back to the album, Back to History.", [
    ...goToAlbum(0),
    { wait: 1800 },
    ...arm(6000),
    artistLink(),
    { wait: 1600 },
    where({ left: "search", head: "Artist", grown: "full" }, "artist"),
    back(100, "back to album"),
    { wait: 1200 },
    where({ left: "search", head: "Album" }, "album again"),
    back(130, "back to history"),
    { wait: 1600 },
    ...report("rule-album-artist"),
  ], { seconds: 9 }),
  shot("rule-album-cold", "His look, cold: the page reloaded with an empty HTTP cache (the session caches gone), then Go to Album and Back.", [
    ...arm(5000),
    ...goToAlbum(),
    { wait: 2500 },
    where({ left: "search", grown: "full" }, "in"),
    back(130),
    { wait: 1600 },
    ...report("rule-album-cold"),
  ], { prepare: [{ clearCache: true }, { reload: true }, { wait: 8000 }], seconds: 8 }),
  shot("rule-rapid-back", "His look: Back 150 ms after Go to Album, while the Fill still opens.", [
    ...arm(4000),
    ...goToAlbum(0),
    { wait: 150 },
    back(140),
    { wait: 1800 },
    ...report("rule-rapid-back"),
  ]),
  shot("rule-again", "His look: Go to Album, Back, and Go to Album again 250 ms after the Back.", [
    ...goToAlbum(0),
    { wait: 1800 },
    ...arm(5000),
    back(0),
    { wait: 250 },
    ...goToAlbum(140),
    { wait: 1800 },
    where({ left: "search", grown: "full" }, "in again"),
    ...report("rule-again"),
  ]),
  shot("rule-reduced", "His look with reduced motion: no slide and no grow motion; each change at once.", [
    { reducedMotion: true },
    ...goToAlbum(40),
    { wait: 1500 },
    where({ left: "search", grown: "full" }, "in"),
    back(40),
    { wait: 1200 },
  ]),
  // ── the row off: the drill swap's own slide, every skin ──
  ...SKINS.map((skin) =>
    shot(`swap-${skin}`, `${skin}, Grow on album or artist Off: Go to Album slides Search in over History; Back slides History back.`, [
      ...arm(4500),
      ...goToAlbum(),
      { wait: 1600 },
      where({ left: "search", head: "Album", grown: null }, "in"),
      back(),
      { wait: 1300 },
      ...report(`swap-${skin}`),
    ], { settings: { skin, drillGrow: "off" } }),
  ),
  ...SKINS.map((skin) =>
    shot(`pane-${skin}`, `${skin}, row Off: inside Search, the album's artist (the card's own pane slide) and Back.`, [
      ...goToAlbum(0),
      { wait: 1600 },
      ...arm(4000),
      artistLink(),
      { wait: 1500 },
      where({ head: "Artist" }, "artist"),
      back(100, "back to album"),
      { wait: 1200 },
      ...report(`pane-${skin}`),
    ], { settings: { skin, drillGrow: "off" }, seconds: 7 }),
  ),
  shot("swap-rapid", "Row Off: Back 120 ms into the slide (the slide turns back from where it is), then Go to Album again once History has landed.", [
    ...arm(4500),
    ...goToAlbum(0),
    { wait: 120 },
    back(120, "back mid-slide"),
    { wait: 60 },
    {
      // One copy: the first slide's copy went when the Back's slide began.
      probe: "JSON.stringify({ ghosts: document.querySelectorAll('.drill-swap__ghost').length, left: __drill.state().layout.left })",
      expect: { ghosts: 1, left: "history" },
      name: "mid",
    },
    // A row still sliding can sit over the stage's Queue: the runner's press would land there.
    { wait: 600 },
    ...goToAlbum(140),
    { wait: 1500 },
    where({ left: "search", grown: null }, "in"),
    ...report("swap-rapid"),
  ], { settings: { drillGrow: "off" } }),
];

// ── Midi, his layout (Settings left, Library right): the Library's own Go to (in the card), with
// his row's wide grow over Settings, and Back. ──
const R = '[data-slot="right"] ';
const midiReset = {
  eval: `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 4; i++) {
      const b = document.querySelector('${R}.panel__back:not([hidden])');
      if (!b || b.offsetParent === null) break;
      b.click();
      await sleep(1100);
    }
    if (__grow.state()) { __grow.collapse('review'); await sleep(700); }
  })()`,
};
shots.push({
  id: "midi-library",
  about: "Midi, his look and row: in the Library, right-click a song › Go to Album (the Library opens it in place and grows wide over Settings), then Back.",
  covers: "cards/CARD-GROW.md",
  kind: "clip",
  source: "dev",
  size: "midi",
  seconds: 6,
  settings: { skin: "ocean" },
  steps: [
    midiReset,
    { wait: 500 },
    watch([`${R}.coll-pane`, `${R}.lib-hero`, `${R}.lib-row`], 5000)[0],
    watch([], 5000)[1],
    { rightclick: `${R}.lib-row[data-idx="1"]` },
    { wait: 350 },
    { eval: "[...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === 'Go to Album').dataset.shot = 'goalbum'" },
    { click: '[data-shot="goalbum"]', frames: 100, region: ".bento" },
    { wait: 1800 },
    { probe: `JSON.stringify({ right: __drill.state().layout.right, head: document.querySelector('${R}.panel__title')?.textContent, grown: __grow.state()?.slot ?? null })`, expect: { right: "library", grown: "right" }, name: "in" },
    { click: `${R}.panel__back`, frames: 130, region: ".bento" },
    { wait: 1600 },
    ...report("midi-library"),
    midiReset,
    { wait: 300 },
    {
      probe: `JSON.stringify({ layout: __drill.state().layout, grown: __grow.state(), depth: document.querySelectorAll('${R}.coll-pane').length, classes: document.querySelectorAll('.is-grow-rebuild,.is-covering,.is-uncovering,.is-covered').length })`,
      expect: { layout: { right: "library" }, grown: null, depth: 1, classes: 0 },
      name: "clean",
    },
  ],
});

const list = {
  about: "The drilldown motion on the running dev app, Max, his layout: Go to Album from History (the drill swap), the album's artist inside Search (the card's own pane slide), and Back, with his Grow on album or artist row (Full) and with it Off in every skin; cold, rapid, again, reduced motion. The motion monitor watches each one.",
  desk_test: "cards/CARD-GROW.md §22",
  made: "2026-10-21",
  pass: "Each probe meets its expect; every shot ends clean (History back, no grow, no copy, no motion class). The monitor's report shows no flash, snap, teleport or row jump that is not designed. No gap over ~50 ms in the page's frames mid-motion. Read the strips by time (frames-bytime.py).",
  run: "node docs/ops/checks/drill-review.mjs && node scripts/shots.mjs --list docs/ops/checks/drill-review.json   (needs npm run dev:app, his Max layout; plays nothing; the cold shot reloads the page)",
  shots,
};
writeFileSync(join(here, "drill-review.json"), JSON.stringify(list, null, 1) + "\n");
console.log(`drill-review.json: ${shots.length} shots`);
