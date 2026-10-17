// Writes song-box-edges.json: the song facts box's edge cases and races (LISTENERS.md §8.11,
// DESK-TESTS.md §6), as a shots list on the running dev app. The steps repeat, so they are made
// here; edit this file, then run it to write the list:
//
//   node docs/ops/checks/song-box-edges.mjs
//   node scripts/shots.mjs --list docs/ops/checks/song-box-edges.json --noise 80
//
// Needs `npm run dev:app`, its window on screen, in Max, with the Library or the Search card in
// slot d (either), and in Midi in the right slot. Every setting a shot changes is put back after
// it (shots.mjs `devState`).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const D = '[data-slot="d"] ';
// Songs in his library with Last.fm pages: a song wiki (A), no song wiki but an album wiki (B).
// A was Bohemian Rhapsody until 2026-10-17: a "seen" song, not in the library, so the Library
// card never found it (only the Search card did).
const A = { q: "Kill Bill", cid: "1682342495", title: "Kill Bill" };
const B = { q: "Vivid Light", cid: "1825903913", title: "Vivid Light" };

/** Back to the card's top level, then its search set to `q` (by script: never a click on a
 *  field, DESK-TESTS.md §6.2), until the song's row is there. Library or Search. */
const find = (s) => ({
  eval: `(async () => {
    const s = '${D}';
    const top = () => ['Library', 'Search'].includes(document.querySelector(s + '.panel__title')?.textContent);
    for (let k = 0; k < 6 && !top(); k++) { document.querySelector(s + '.panel__back')?.click(); await new Promise((r) => setTimeout(r, 700)); }
    const i = document.querySelector(s + 'input.search__input') || document.querySelector(s + 'input.lib-search__input');
    if (!i) throw new Error('no search field in slot d');
    i.value = ${JSON.stringify(s.q)}; i.dispatchEvent(new Event('input', { bubbles: true }));
    for (let k = 0; k < 50; k++) { if (document.querySelector(s + '[data-cid="${s.cid}"]')) return; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error('no row for ${s.q}');
  })()`,
});
/** The song's Song Credits, through its row's right-click menu. */
const credits = (s, extra = {}) => [
  { rightclick: `${D}[data-cid="${s.cid}"]` },
  { wait: 400 },
  { eval: "[...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === 'Song Credits').click()", ...extra },
];
const open = (s, extra) => [find(s), ...credits(s, extra)];
const back = { eval: `document.querySelector('${D}.panel__back')?.click()` };
/** Midi has two card slots, and his Library sits in the right one (read 2026-10-17): a Midi
 *  shot's steps aim there instead of Max's slot d. */
const inMidi = (s, steps) =>
  s.size === "midi" ? JSON.parse(JSON.stringify(steps).replaceAll(JSON.stringify(D).slice(1, -1), JSON.stringify('[data-slot="right"] ').slice(1, -1))) : steps;
/** A reload, so the page's memory of Last.fm answers is empty. */
const FRESH = [{ reload: true }, { wait: `${D}.panel__title` }, { wait: 2500 }];

/** One probe of the page's state: the card, the box, its sections, the About, the view. */
const STATE = `JSON.stringify((() => {
  const s = '${D}';
  const box = document.querySelector(s + '[data-info-box="song"]');
  const about = document.querySelector(s + '.artist-info__about');
  return {
    card: document.querySelector(s + '.panel__title')?.textContent,
    hero: document.querySelector(s + '.lib-hero__title, ' + s + '.lib-hero h2, ' + s + '.lib-hero [class*="title"]')?.textContent?.trim(),
    box: !!box && !box.hasAttribute('data-info-pending'),
    boxTitle: box?.dataset.title ?? null,
    heads: [...document.querySelectorAll(s + '.artist-info__sec .artist-info__h')].map((h) => h.textContent),
    about: about ? about.textContent.slice(0, 40) : null,
    aboutHint: about?.dataset.hint ?? null,
    present: !!document.querySelector('.present'),
    presentName: document.querySelector('.present__name')?.textContent ?? null,
    calls: window.__shotsInvoke?.calls?.lastfm_listeners ?? 0,
    albumCalls: window.__shotsInvoke?.calls?.lastfm_album_info ?? 0,
    counts: document.querySelector(s + '.artist-info__counts')?.textContent ?? null,
    errors: (window.__diag?.events?.() ?? []).filter((e) => /error|unhandled/i.test(e.tag)).length,
  };
})())`;
const probe = (name, expect) => ({ probe: STATE, name, expect });

const shots = [
  {
    id: "edge-leave-early",
    about: "Race: Last.fm answers 2.5 s late; the user leaves the song page first. The late answer must not draw on the list, and nothing throws.",
    steps: [
      { invoke: { lastfm_listeners: { delay: 2500 }, lastfm_album_info: { delay: 2500 } } },
      ...open(A),
      { wait: 400 },
      back,
      { wait: 3500, frames: 20 },
      probe("left early", { card: "/^(Library|Search)$/", box: false, present: false }),
    ],
  },
  {
    id: "edge-a-then-b",
    about: "Race: song A's answer is late; the user goes back and opens song B. B's page shows B's box, never A's.",
    steps: [
      { invoke: { lastfm_listeners: { delay: 2500 } } },
      ...open(A),
      { wait: 300 },
      back,
      { wait: 600 },
      ...open(B),
      { wait: 4500 },
      { snap: "b" },
      probe("B's box", { card: "Song", box: true, boxTitle: B.title }),
    ],
  },
  {
    id: "edge-off-no-call",
    about: "The row off: no box and no lastfm_listeners call from the song page.",
    settings: { showSongInfo: false },
    steps: [
      { invoke: {} },
      ...open(B),
      { wait: 2500 },
      probe("off", { card: "Song", box: false, calls: 0 }),
    ],
  },
  {
    id: "edge-on-while-open",
    about: "The row turned on while a song page is open (Settings, Compass or the agent). The box should come.",
    settings: { showSongInfo: false },
    steps: [
      ...open(A),
      { wait: 1500 },
      { eval: "window.__store.set('showSongInfo', true)" },
      { wait: 2500 },
      probe("on while open", { card: "Song", box: true }),
    ],
  },
  {
    id: "edge-fail-then-retry",
    about: "Last.fm fails: no box, no error toast, the page works. Back and open again: the box comes (a failure is not kept).",
    steps: [
      { invoke: { lastfm_listeners: { fail: true } } },
      ...open(B),
      { wait: 2000 },
      probe("failed", { card: "Song", box: false }),
      { invoke: "reset" },
      back,
      { wait: 800 },
      ...open(B),
      { wait: 3000 },
      probe("retried", { card: "Song", box: true }),
    ],
  },
  {
    id: "edge-present-row-off",
    about: "Presentation mode open, then the row goes off (Settings, the agent). The view should close, not freeze.",
    steps: [
      ...open(A),
      { wait: 3000 },
      { click: `${D}[data-present]` },
      { wait: 1500 },
      probe("presenting", { present: true, presentName: `/${A.title}/` }),
      { eval: "window.__store.set('showSongInfo', false)" },
      { wait: 1500 },
      { snap: "after-off" },
      probe("after off", { present: false }),
      { eval: "window.__store.set('showSongInfo', true)" },
      { key: "Escape" },
    ],
  },
  {
    id: "edge-present-compass",
    about: "Presentation mode open, then Ctrl+Space and Esc: the Compass closes and the view stays; a second Esc closes the view and keeps the song page.",
    steps: [
      ...open(A),
      { wait: 3000 },
      { click: `${D}[data-present]` },
      { wait: 1500 },
      { key: "Ctrl+Space" },
      { wait: 600 },
      { key: "Escape" },
      { wait: 600 },
      probe("compass closed", { present: true }),
      { key: "Escape" },
      { wait: 1500 },
      probe("view closed", { present: false, card: "Song", box: true }),
    ],
  },
  {
    id: "edge-grown-skins",
    about: "The box on a grown card (beside the cover) in every skin: seen, and nothing overflows the box.",
    looks: [{ theme: "moonlight", skin: "*" }],
    steps: [
      ...open(A),
      { wait: 3000 },
      { eval: "window.__grow.grow('d', 'full', 'shots')" },
      { wait: 1500 },
      { eval: `document.querySelector('${D}.artist-info-wrap')?.scrollIntoView({ block: 'center' })` },
      { wait: 400 },
      { snap: "grown" },
      {
        probe: `JSON.stringify((() => { const w = document.querySelector('${D}.artist-info-wrap'); const b = w?.querySelector('.artist-info'); const tags = [...(w?.querySelectorAll('.artist-info__tag') ?? [])]; return { box: !!b, fits: !!b && b.scrollWidth <= b.clientWidth + 1, tagsFit: tags.every((t) => t.getBoundingClientRect().right <= b.getBoundingClientRect().right + 1), beside: !!w && w.getBoundingClientRect().left > document.querySelector('${D}.lib-hero__main')?.getBoundingClientRect().left + 40 }; })())`,
        name: "grown box",
        expect: { box: true, fits: true, tagsFit: true, beside: true },
      },
      { eval: "window.__grow.collapse('shots')" },
      { wait: 800 },
    ],
  },
  {
    id: "edge-midi-fold",
    about: "Midi: the SONG INFO line folds and opens the box; the choice is kept.",
    size: "midi",
    steps: [
      ...open(A),
      { wait: 3000 },
      { eval: `document.querySelector('${D}.artist-info-wrap')?.scrollIntoView({ block: 'center' })` },
      { snap: "midi" },
      { probe: `document.querySelector('${D}.artist-info-wrap')?.dataset.open`, name: "open before" },
      { click: `${D}[data-artist-info-toggle]` },
      { wait: 700 },
      { probe: `JSON.stringify({ open: document.querySelector('${D}.artist-info-wrap')?.dataset.open })`, name: "after one press" },
      { click: `${D}[data-artist-info-toggle]` },
      { wait: 700 },
      { snap: "midi-again" },
      { probe: `JSON.stringify({ open: document.querySelector('${D}.artist-info-wrap')?.dataset.open })`, name: "after two presses" },
    ],
  },
  {
    id: "edge-notes-lastfm-only",
    about: "Notes from › Last.fm only: the song's own wiki (B has none: the album's, headed About the album).",
    settings: { notesSource: "lastfm" },
    steps: [
      ...open(B),
      { wait: 3500 },
      probe("lastfm only", { card: "Song", box: true, heads: { $has: "About the album" }, aboutHint: "/album's wiki on Last\\.fm/" }),
    ],
  },
  {
    id: "edge-notes-apple-only",
    about: "Notes from › Apple only: no About today (Apple's notes are not built); the rest of the box stays.",
    settings: { notesSource: "apple" },
    steps: [
      ...open(A),
      { wait: 3000 },
      probe("apple only", { card: "Song", box: true, about: null, heads: { $has: "Listening Stats" } }),
    ],
  },
  // Data edges: the answer is patched in the page (shots.mjs `invoke` › `patch`), no database
  // write. A reload first, so the page's memory asks again.
  {
    id: "edge-readmore-only",
    about: "The song's wiki is only Last.fm's 'Read more' link (a stub page): it is not a note; the album's wiki (or nothing) shows, never an empty About.",
    steps: [
      { reload: true },
      { wait: `${D}.panel__title` },
      { wait: 2500 },
      { invoke: { lastfm_listeners: { patch: { wiki: '<a href="https://www.last.fm/music/x">Read more on Last.fm</a>' } } } },
      ...open(A),
      { wait: 3500 },
      probe("stub wiki", { card: "Song", box: true, heads: { $not: "About" }, about: { $not: "" } }),
    ],
  },
  {
    id: "edge-off-no-album-call",
    about: "The song row off, Show album info on: the song page asks Last.fm for nothing, the album included.",
    settings: { showSongInfo: false, showAlbumInfo: true, notesSource: "both" },
    steps: [
      { reload: true },
      { wait: `${D}.panel__title` },
      { wait: 2500 },
      { invoke: {} },
      ...open(B),
      { wait: 2500 },
      probe("no calls", { card: "Song", box: false, calls: 0, albumCalls: 0 }),
    ],
  },
  {
    id: "edge-big-counts",
    about: "Counts at the edge of a unit: 999,999 reads 1M (not 1000K); 0 plays still draws.",
    steps: [
      { reload: true },
      { wait: `${D}.panel__title` },
      { wait: 2500 },
      { invoke: { lastfm_listeners: { patch: { listeners: 999999, playcount: 999950 } } } },
      ...open(A),
      { wait: 3000 },
      probe("units", { card: "Song", box: true, counts: { $not: "/1000K/" } }),
    ],
  },
  {
    id: "edge-long-tags-midi",
    about: "Long and noisy tags in Midi: the chips stay inside the box.",
    size: "midi",
    steps: [
      { reload: true },
      { wait: `${D}.panel__title` },
      { wait: 2500 },
      { invoke: { lastfm_listeners: { patch: { tags: ["WSUM 91.7 FM Madison", "songs that make me feel like the main character in a coming of age film", "rock", "Queen", "70s"] } } } },
      ...open(A),
      { wait: 3000 },
      { eval: `document.querySelector('${D}.artist-info-wrap')?.scrollIntoView({ block: 'center' })` },
      { wait: 400 },
      { snap: "tags" },
      {
        probe: `JSON.stringify((() => { const b = document.querySelector('${D}.artist-info'); const r = b?.getBoundingClientRect(); return { box: !!b, tagsFit: [...(b?.querySelectorAll('.artist-info__tag') ?? [])].every((t) => t.getBoundingClientRect().right <= r.right + 1) }; })())`,
        name: "tags fit",
        expect: { box: true, tagsFit: true },
      },
    ],
  },
  {
    id: "edge-reduced-motion",
    about: "Reduced motion: the box's place is held from the first paint, nothing slides; a song Last.fm does not know lets the place go.",
    steps: [
      { reducedMotion: true },
      ...open(B, { frames: 30 }),
      { wait: 3000 },
      { snap: "still" },
      probe("still", { card: "Song", box: true }),
    ],
  },
];

const list = {
  about: "The song facts box's edge cases and races on his LIVE dev app (LISTENERS.md §8.11). Made by song-box-edges.mjs; edit that, not this.",
  desk_test: "features/LISTENERS.md §8.11",
  made: "2026-10-17",
  pass: "Every shot ok: each probe's `expect` holds (the runner fails a shot on a mismatch and names it). Read the snaps of edge-grown-skins (5 skins), edge-midi-fold and edge-a-then-b.",
  run: "node docs/ops/checks/song-box-edges.mjs && node scripts/shots.mjs --list docs/ops/checks/song-box-edges.json --noise 80   (dev app running, on screen, Max, the Library or Search in slot d, and in Midi in the right slot; ask other sessions first)",
  // Every shot starts on a fresh page (2026-10-17): the page keeps each song's Last.fm answer
  // for the session, so a song an earlier shot opened draws with no call, and a delay, a
  // failure or a patch never reaches it.
  shots: shots.map((s) => ({
    covers: "features/LISTENERS.md",
    kind: "clip",
    source: "dev",
    seconds: 6,
    ...s,
    steps: inMidi(s, s.steps[0]?.reload ? s.steps : [...FRESH, ...s.steps]),
  })),
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "song-box-edges.json"), JSON.stringify(list, null, 2) + "\n");
console.log(`song-box-edges.json: ${shots.length} shots`);
