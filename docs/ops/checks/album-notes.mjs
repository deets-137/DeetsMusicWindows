// Writes album-notes.json: Apple's album notes (features/album-notes.md §8) as a shots list on the
// running dev app. Edit this file, then run it to write the list:
//
//   node docs/ops/checks/album-notes.mjs
//   node scripts/shots.mjs --list docs/ops/checks/album-notes.json --noise 80
//
// Needs `npm run dev:app`, its window on screen, in Max, with the Library in slot d (in Midi in the
// right slot). Every setting a shot changes is put back after it (shots.mjs `devState`). One shot
// plays a song (a mention's press is the feature): the run says so.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const D = '[data-slot="d"] ';
// Library songs whose albums carry notes (probed 2026-10-17): a track-by-track note (Arlo Parks)
// and a note whose song names sit in curly quotes (Camila Cabello, Romance).
const HURT = { q: "Hurt", cid: "1535799403", title: "Hurt" };
const ROMANCE = { q: "My Oh My", cid: "1490344644", title: "My Oh My" };

const find = (s, slot = D) => ({
  eval: `(async () => {
    const s = '${slot}';
    for (let k = 0; k < 6 && document.querySelector(s + '.panel__back:not([hidden])')?.offsetParent; k++) { document.querySelector(s + '.panel__back').click(); await new Promise((r) => setTimeout(r, 700)); }
    const i = document.querySelector(s + 'input.search__input') || document.querySelector(s + 'input.lib-search__input');
    if (!i) throw new Error('no search field');
    i.value = ${JSON.stringify(s.q)}; i.dispatchEvent(new Event('input', { bubbles: true }));
    for (let k = 0; k < 50; k++) { if (document.querySelector(s + '[data-cid="${s.cid}"]')) return; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error('no row for ${s.title}');
  })()`,
});
const menuRow = (label) => ({ eval: `[...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()` });
const openAlbum = (s, slot = D) => [find(s, slot), { rightclick: `${slot}[data-cid="${s.cid}"]` }, { wait: 400 }, menuRow("Go to Album")];
const openSong = (s, slot = D) => [find(s, slot), { rightclick: `${slot}[data-cid="${s.cid}"]` }, { wait: 400 }, menuRow("Song Credits")];
const FRESH = [{ reload: true }, { wait: `${D}.panel__title` }, { wait: 2500 }];

/** The page's state: the card, the box, its About, the note view. */
const state = (slot = D) => `JSON.stringify((() => {
  const s = '${slot}';
  const box = document.querySelector(s + '[data-info-box]');
  const about = document.querySelector(s + '.artist-info__about');
  const view = document.querySelector('.present--notes');
  const host = view?.closest('.panel');
  return {
    card: document.querySelector(s + '.panel__title')?.textContent,
    box: !!box && !box.hasAttribute('data-info-pending'),
    heads: [...document.querySelectorAll(s + '.artist-info__sec .artist-info__h')].map((h) => h.textContent),
    about: about ? about.textContent.slice(0, 50) : null,
    aboutHint: about?.dataset.hint ?? about?.getAttribute('title') ?? null,
    opens: about?.hasAttribute('data-notes') ?? false,
    view: !!view,
    tagline: view?.querySelector('.present__title .search__label')?.textContent ?? null,
    short: view?.querySelector('.notes__short')?.textContent?.slice(0, 50) ?? null,
    songs: view ? view.querySelectorAll('.notes__song').length : 0,
    mentions: view ? view.querySelectorAll('.notes__mention:not(.notes__mention--elsewhere)').length : 0,
    from: view?.querySelector('.notes__from')?.textContent ?? null,
    topOver: view && host ? Math.round(view.getBoundingClientRect().top - host.getBoundingClientRect().top) : null,
    rawTags: view ? /<[a-z]/i.test(view.querySelector('.notes__body')?.textContent ?? '') : false,
    calls: window.__shotsInvoke?.calls?.album_notes ?? 0,
    errors: (window.__diag?.events?.() ?? []).filter((e) => /error|unhandled/i.test(e.tag)).length,
  };
})())`;
const probe = (name, expect, slot) => ({ probe: state(slot), name, expect });

const shots = [
  {
    id: "notes-lib-max",
    about: "A library album with a track-by-track note, in Max: the About shows Apple's short note and opens the note; the note has its songs as rows, the tagline, From Apple Music; Esc goes back into the cell.",
    steps: [
      { invoke: {} },
      ...openAlbum(HURT),
      { wait: 3500 },
      probe("box", { card: "Album", box: true, opens: true, about: "/rainbows/", aboutHint: "From Apple Music's notes on this album" }),
      { eval: `document.querySelector('${D}.artist-info-wrap')?.scrollIntoView({ block: 'center' })` },
      { snap: "box" },
      { click: `${D}[data-notes]`, frames: 30 },
      { wait: 2500 },
      probe("note open", { view: true, songs: { $not: 0 }, from: "From Apple Music", short: "/rainbows/", rawTags: false }),
      { snap: "note" },
      { key: "Escape" },
      { wait: 1500 },
      probe("closed", { view: false, card: "Album", box: true }),
    ],
  },
  {
    id: "notes-quoted-mentions",
    about: "M1 = A: Romance's note names its songs in curly quotes; those that are songs of the album are mentions.",
    steps: [
      ...openAlbum(ROMANCE),
      { wait: 3500 },
      { click: `${D}[data-notes]` },
      { wait: 2500 },
      probe("mentions", { view: true, mentions: { $not: 0 }, songs: 0 }),
      { eval: "document.querySelector('.notes__mention')?.scrollIntoView({ block: 'center' })" },
      { snap: "mentions" },
      { key: "Escape" },
      { wait: 1200 },
    ],
  },
  {
    id: "notes-play-mention",
    about: "A song heading plays its song with the album after it, and the note stays open (N3 = A). PLAYS A SONG.",
    steps: [
      ...openAlbum(HURT),
      { wait: 3500 },
      { click: `${D}[data-notes]` },
      { wait: 2500 },
      { eval: "[...document.querySelectorAll('.notes__song')].find((b) => /Hurt/.test(b.textContent))?.click()" },
      { wait: 4000 },
      {
        probe: "JSON.stringify({ view: !!document.querySelector('.present--notes'), np: document.querySelector('.np__title')?.textContent })",
        name: "playing",
        expect: { view: true, np: "/Hurt/" },
      },
      { key: "Escape" },
      { wait: 1200 },
    ],
  },
  {
    id: "notes-compass",
    about: "The Compass over the note takes its Esc first; a second Esc closes the note.",
    steps: [
      ...openAlbum(HURT),
      { wait: 3500 },
      { click: `${D}[data-notes]` },
      { wait: 2500 },
      { key: "Ctrl+Space" },
      { wait: 600 },
      { key: "Escape" },
      { wait: 600 },
      probe("compass closed", { view: true }),
      { key: "Escape" },
      { wait: 1500 },
      probe("note closed", { view: false, card: "Album" }),
    ],
  },
  {
    id: "notes-row-off-no-call",
    about: "Show album info off: no box, and Apple's notes are not asked.",
    settings: { showAlbumInfo: false },
    steps: [{ invoke: {} }, ...openAlbum(ROMANCE), { wait: 3000 }, probe("off", { card: "Album", box: false, calls: 0 })],
  },
  {
    id: "notes-lastfm-only",
    about: "Notes from › Last.fm only: no Apple note in the About and no call; the About, if any, is Last.fm's and opens nothing.",
    settings: { notesSource: "lastfm" },
    steps: [{ invoke: {} }, ...openAlbum(HURT), { wait: 3500 }, probe("lastfm only", { card: "Album", opens: false, calls: 0 })],
  },
  {
    id: "notes-fail",
    about: "Apple's notes fail: the box draws from Last.fm alone, nothing throws, and the next open asks again.",
    steps: [
      { invoke: { album_notes: { fail: true } } },
      ...openAlbum(ROMANCE),
      { wait: 3500 },
      probe("failed", { card: "Album", opens: false, calls: 1, errors: 0 }),
    ],
  },
  {
    id: "notes-song-page",
    about: "The song page: a track-by-track note's part about the song is its About (Apple, the song first).",
    steps: [
      ...openSong(HURT),
      { wait: 4000 },
      probe("song about", { card: "Song", box: true, aboutHint: "From Apple Music's notes on the album, about this song" }),
      { eval: `document.querySelector('${D}.artist-info-wrap')?.scrollIntoView({ block: 'center' })` },
      { snap: "song" },
    ],
  },
  {
    id: "notes-midi",
    about: "Midi: the note opens over the song list inside the card, under the hero; Esc closes it.",
    size: "midi",
    steps: [
      ...openAlbum(HURT, '[data-slot="right"] '),
      { wait: 3500 },
      { eval: `(() => { const w = document.querySelector('[data-slot="right"] .artist-info-wrap'); if (w && w.dataset.open !== '1') w.querySelector('[data-artist-info-toggle]')?.click(); })()` },
      { wait: 800 },
      { click: '[data-slot="right"] [data-notes]' },
      { wait: 2500 },
      probe("midi note", { view: true, topOver: { $not: 0 } }, '[data-slot="right"] '),
      { snap: "midi" },
      { key: "Escape" },
      { wait: 1200 },
      probe("midi closed", { view: false }, '[data-slot="right"] '),
    ],
  },
  {
    id: "notes-reduced-motion",
    about: "Reduced motion: the note shows and closes with no clip motion.",
    steps: [{ reducedMotion: true }, ...openAlbum(HURT), { wait: 3500 }, { click: `${D}[data-notes]`, frames: 20 }, { wait: 1200 }, probe("still", { view: true }), { key: "Escape" }, { wait: 800 }],
  },
];

const list = {
  about: "Apple's album notes on his LIVE dev app (features/album-notes.md §8). Made by album-notes.mjs; edit that, not this.",
  desk_test: "features/album-notes.md §8",
  made: "2026-10-17",
  pass: "Every shot ok: each probe's `expect` holds. Read the snaps of notes-lib-max (box, note), notes-quoted-mentions, notes-song-page and notes-midi.",
  run: "node docs/ops/checks/album-notes.mjs && node scripts/shots.mjs --list docs/ops/checks/album-notes.json --noise 80   (dev app running, on screen, Max, the Library in slot d, and in Midi in the right slot; ask other sessions first; one shot plays a song)",
  shots: shots.map((s) => {
    const fresh = s.size === "midi" ? FRESH.map((x) => (x.wait === `${D}.panel__title` ? { wait: '[data-slot="right"] .panel__title' } : x)) : FRESH;
    const steps = s.steps[0]?.reload ? s.steps : [...fresh, ...s.steps];
    return { covers: "features/album-notes.md", kind: "clip", source: "dev", seconds: 6, ...s, steps };
  }),
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "album-notes.json"), JSON.stringify(list, null, 2) + "\n");
console.log(`album-notes.json: ${shots.length} shots`);
