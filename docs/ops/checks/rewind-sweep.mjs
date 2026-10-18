// Writes rewind-sweep.json: the Rewind card's quality sweep (QUALITY-SWEEP.md, DEETS-REWIND.md
// § Sweep), as a shots list on the running dev app. The steps repeat, so they are made here; edit
// this file, then run it to write the list:
//
//   node docs/ops/checks/rewind-sweep.mjs
//   node scripts/shots.mjs --list docs/ops/checks/rewind-sweep.json --noise 80
//
// Needs `npm run dev:app`, its window on screen. The list puts the Rewind card in Max's slot c and
// in Midi's right slot, and its last shot puts back the cards, the Rewind choices and the surface
// it found (kept in localStorage `shots:rewind-sweep` between shots, since a shot reloads).
// Every guard is "dev-only" (QUALITY-SWEEP.md C8): it reads his real play log.
//
// Two kinds of shot. A GUARD passes today and must keep passing. A FAULT shot (id `fault-…`)
// fails today on purpose: it is the fault's test, and it passes when the fix lands.
// Shots marked PLAYS play music on his speakers.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INV, SLEEP as sleep, save, restore, cardIn, menuPick, PLAY, key, ctrlClick, watch as watchParts, motionReport as report } from "./sweep-helpers.mjs";

const C = '[data-slot="c"] ';
const DAY = 86_400_000;
const RUN = "shots:rewind-sweep";

/** Keep what the run changes (slot c's card, the Rewind choices, Midi's layout), once. */
const SAVE = save(RUN, ["c"], ["deets.rewind", "deets.layout.midi"]);
/** Rewind in a slot. */
const rewindIn = (slotName) => cardIn(slotName, "rewind", ".rewind");
/** One of the two dropdowns at the top of the card set to `label`, as a user picks it. */
const choose = (kind, label, slotName = "c") => menuPick(`[data-slot="${slotName}"] [data-pick="${kind}"]`, label);
/** The card's own parts for the motion monitor: the rows, the dropdowns, the top row, the art. */
const REWIND_PARTS = [".rewind__pills > *", ".rewind__board > *", ".qcard__list > li", ".qnow", ".qnow__art", ".qrow__art", "#rewind-sotd"];
const watch = (ms) => watchParts(REWIND_PARTS, ms);

const OPEN = [{ reload: true }, { wait: `${C}.panel__title` }, { wait: 2000 }, SAVE, rewindIn("c")];

/** The ranked list's state: the dropdowns, the rows, the picks, a menu, the loading hold. */
const STATE = `JSON.stringify((() => {
  const s = '${C}';
  const titles = [...document.querySelectorAll(s + '.qnow__title, ' + s + '.qrow__title')].map((t) => t.textContent);
  return {
    stat: document.querySelector(s + '[data-pick="stat"] .lib-pill__label')?.textContent,
    window: document.querySelector(s + '[data-pick="window"] .lib-pill__label')?.textContent,
    rows: titles.length,
    unknown: titles.filter((t) => /^Unknown/.test(t)).length,
    picked: document.querySelectorAll(s + '[data-picked]').length,
    menu: !!document.querySelector('.ctx-menu'),
    held: !!document.querySelector(s + '[data-reveal-hold]'),
    empty: document.querySelector(s + '.qcard__empty')?.textContent ?? null,
  };
})())`;
const probe = (name, expect) => ({ probe: STATE, name, expect });

/** In-page: the play log since `since` grouped by song, and fmtListen's words for a total. */
const LOG = `
  const since = (ms) => ${INV}('play_events_since', { sinceTs: Date.now() - ms });
  const fmt = (ms) => { const m = Math.round(ms / 60000); if (m < 1) return '<1 min'; if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return r ? h + ' hr ' + r + ' min' : h + ' hr'; };
`;

const shots = [
  {
    id: "guard-escape-keeps-picks",
    about: "Two rows picked, the picked set's right-click menu open, Escape: the menu closes and the picks stay (the menu takes Escape first, in the capture phase).",
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      ctrlClick(`${C}.qrow[data-idx="1"]`),
      ctrlClick(`${C}.qrow[data-idx="2"]`),
      { wait: 300 },
      { rightclick: `${C}.qrow[data-idx="1"]` },
      { wait: 400 },
      probe("menu open", { menu: true, picked: 2 }),
      key("Escape"),
      { wait: 300 },
      probe("after Escape", { menu: false, picked: 2 }),
      key("Escape"),
      { wait: 300 },
      probe("second Escape drops the picks", { picked: 0 }),
    ],
  },
  {
    id: "guard-fast-choices",
    about: "The first dropdown changed three times fast (Albums, Artists, Songs, 30 ms apart): the list settles on Songs, with rows, and is not left on hold.",
    steps: [
      ...OPEN,
      choose("window", "Past Year"),
      {
        eval: `(async () => {
          const sleep = ${sleep};
          for (const label of ['Albums', 'Artists', 'Songs']) {
            document.querySelector('${C}[data-pick="stat"]').click();
            await sleep(30);
            [...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === label)?.click();
            await sleep(30);
          }
        })()`,
        frames: 40,
        region: '[data-slot="c"]',
      },
      { wait: 3000 },
      probe("settled", { stat: "Songs", held: false, empty: null }),
      {
        probe: `JSON.stringify({ rows: document.querySelectorAll('${C}.qnow, ${C}.qrow').length > 1 })`,
        name: "has rows",
        expect: { rows: true },
      },
    ],
  },
  {
    id: "guard-boot-no-unknown",
    about: "Albums, Past Year, then a reload: the first list drawn has no more 'Unknown Album' rows than the settled one (no rows drawn before the song store has loaded).",
    steps: [
      ...OPEN,
      choose("stat", "Albums"),
      choose("window", "Past Year"),
      { reload: true },
      {
        probe: `(async () => {
          const sleep = ${sleep};
          const read = () => [...document.querySelectorAll('${C}.qnow__title, ${C}.qrow__title')].map((t) => t.textContent);
          let first = null;
          for (let k = 0; k < 300 && !first; k++) { const t = read(); if (t.length) first = t; else await sleep(30); }
          await sleep(4000);
          const last = read();
          const unk = (a) => (a ?? []).filter((t) => /^Unknown/.test(t)).length;
          return JSON.stringify({ drawn: !!first, flash: unk(first) > unk(last), firstUnknown: unk(first), lastUnknown: unk(last) });
        })()`,
        name: "first draw",
        expect: { drawn: true, flash: false },
      },
    ],
  },
  {
    id: "guard-midi-fits",
    about: "Midi, the Rewind card in the right slot: the dropdowns and Make playlist stay inside the card.",
    size: "midi",
    steps: [
      { reload: true },
      { wait: '[data-slot="right"] .panel__title' },
      { wait: 2000 },
      SAVE,
      rewindIn("right"),
      { wait: 1500 },
      { snap: "midi" },
      {
        probe: `JSON.stringify((() => {
          const s = '[data-slot="right"] ';
          const card = document.querySelector(s + '.rewind')?.getBoundingClientRect();
          const parts = [...document.querySelectorAll(s + '.rewind__pills > *')].map((e) => e.getBoundingClientRect());
          return { card: !!card, fits: !!card && parts.every((r) => r.right <= card.right + 1 && r.left >= card.left - 1) };
        })())`,
        name: "fits",
        expect: { card: true, fits: true },
      },
    ],
  },
  {
    id: "guard-year-read",
    about: "Reading a year of the play log (what Past Year asks for on each song change) stays quick: the median of three reads under 150 ms.",
    steps: [
      ...OPEN,
      {
        probe: `(async () => {
          ${LOG}
          const t = [];
          let n = 0;
          for (let k = 0; k < 3; k++) { const a = performance.now(); n = (await since(365 * ${DAY})).length; t.push(performance.now() - a); }
          t.sort((x, y) => x - y);
          return JSON.stringify({ rows: n, medianMs: Math.round(t[1]), fast: t[1] < 150 });
        })()`,
        name: "year read",
        expect: { fast: true },
      },
    ],
  },
  {
    id: "fault-unknown-playlist",
    about: "FAULT F1 (fails today): Playlists, Past Year. A play keeps its playlist's ID; a playlist deleted or remade (the weekly Replay) leaves its plays as 'Unknown Playlist'. Passes when no row reads Unknown.",
    steps: [
      ...OPEN,
      choose("stat", "Playlists"),
      choose("window", "Past Year"),
      { snap: "playlists" },
      probe("no unknown playlist", { stat: "Playlists", unknown: 0 }),
    ],
  },
  {
    id: "fault-minutes-after-skip",
    about: "FAULT F2 (fails today), PLAYS about 80 s: a song not played today is played for 70 s, then skipped, with the list on Past Day. 3 s later its row must read '1 min'. Today the list reads the log before the finished song's minutes are written, and shows '<1 min' until the next song change.",
    kind: "shot",
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      {
        eval: `(async () => {
          ${LOG}
          const today = new Set((await since(${DAY})).map((e) => e.trackId));
          const rows = [...document.querySelectorAll('${C}.qrow[data-k]')].filter((r) => !today.has(r.dataset.k));
          if (rows.length < 2) throw new Error('fewer than two songs not played today');
          window.__rwSweep = { a: rows[0].dataset.k, b: rows[1].dataset.k };
          for (const r of rows.slice(0, 2)) r.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        })()`,
      },
      { wait: 300 },
      { eval: `document.querySelector('${C}.qrow[data-k="' + window.__rwSweep.a + '"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))` },
      { wait: 400 },
      PLAY,
      { wait: 5000 },
      choose("window", "Past Day"),
      { wait: 70000 },
      { eval: "window.__music.skipToNextItem()" },
      { wait: 3000 },
      {
        probe: `(async () => {
          ${LOG}
          const a = window.__rwSweep.a;
          const ms = (await since(${DAY})).filter((e) => e.trackId === a).reduce((s, e) => s + (e.msListened ?? 0), 0);
          const row = document.querySelector('${C}.qrow[data-k="' + a + '"]') ?? document.querySelector('${C}.qnow');
          const shown = row?.querySelector('.rewind__meta')?.textContent ?? null;
          return JSON.stringify({ logged: fmt(ms), shown, match: !!shown && shown.startsWith(fmt(ms) + ' ') });
        })()`,
        name: "the finished song's minutes",
        expect: { logged: "1 min", match: true },
      },
      { eval: "window.__music.pause()" },
    ],
  },
  {
    id: "fault-same-song-again",
    about: "FAULT F3 (fails today), PLAYS about 12 s: a song is played, then played again from a new list (it and the next row, picked, Play Now). That is two listens, so two plays in the log. Today the second start is dropped as a repeat of the first.",
    kind: "shot",
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      { eval: "window.__rwSweep = { t0: Date.now(), a: document.querySelector('" + C + ".qrow[data-idx=\"1\"]').dataset.k }" },
      { rightclick: `${C}.qrow[data-idx="1"]` },
      { wait: 400 },
      PLAY,
      { wait: 5000 },
      { eval: `(() => { for (const i of [1, 2]) { const r = [...document.querySelectorAll('${C}.qrow[data-k]')].find((x) => x.dataset.k === window.__rwSweep.a); const rows = [...document.querySelectorAll('${C}.qrow[data-k]')]; const at = rows.indexOf(r); rows[at + i - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); } })()` },
      { wait: 300 },
      { eval: `document.querySelector('${C}.qrow[data-k="' + window.__rwSweep.a + '"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))` },
      { wait: 400 },
      PLAY,
      { wait: 5000 },
      {
        probe: `(async () => {
          const ev = await ${INV}('play_events_since', { sinceTs: window.__rwSweep.t0 });
          return JSON.stringify({ plays: ev.filter((e) => e.trackId === window.__rwSweep.a).length });
        })()`,
        name: "two plays",
        expect: { plays: 2 },
      },
      { eval: "window.__music.pause()" },
    ],
  },
  {
    id: "fault-slow-playlist-menu",
    about: "FAULT F8 (fails today): Playlists, a right-click while the playlists read is slow (2 s), then Songs from the first dropdown at once. No menu may open afterwards for a row that is gone.",
    steps: [
      ...OPEN,
      choose("stat", "Playlists"),
      choose("window", "Past Year"),
      { invoke: { playlists_cached: { delay: 2000 } } },
      { rightclick: `${C}.qnow` },
      { wait: 200 },
      choose("stat", "Songs"),
      { wait: 2500 },
      probe("no late menu", { stat: "Songs", menu: false }),
      key("Escape"),
    ],
  },
  {
    id: "fault-make-half-fails",
    about: "FAULT F7 (fails today): Make playlist while adding the songs fails. No half-made 'Replay —' playlist may stay. The shot deletes any it finds, so it leaves nothing behind.",
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Week"),
      // The local playlists before the click: only one that is new after it was made here.
      { eval: `(async () => { window.__rwSweep = { before: (await ${INV}('playlists_cached')).map((p) => p.libraryId) }; })()` },
      { invoke: { playlist_add_tracks: { fail: true } } },
      { click: `${C}.rewind__make` },
      { wait: 2500 },
      {
        probe: `(async () => {
          const all = await ${INV}('playlists_cached');
          const made = all
            .filter((p) => /^local:/.test(p.libraryId ?? '') && !window.__rwSweep.before.includes(p.libraryId))
            .map((p) => Number(p.libraryId.slice(6)));
          window.__rwSweep.made = made;
          return JSON.stringify({ leftBehind: made.length, button: document.querySelector('${C}.rewind__make').textContent });
        })()`,
        name: "nothing left behind",
        expect: { leftBehind: 0 },
      },
      { invoke: "reset" },
      { eval: `(async () => { for (const id of window.__rwSweep.made ?? []) await ${INV}('playlist_delete', { id }); })()` },
    ],
  },
  // ── The visual pass (QUALITY-SWEEP.md § the visual pass) ──
  // The motion monitor (smooth-monitor.js) watches the card's own parts on every frame; a hit is
  // a flash, a snap or a jitter (README.md §2a). Each step that moves something also keeps its
  // frames, so a pop (a frame that jumps) is counted and can be looked at.
  {
    id: "visual-choices",
    about: "VISUAL: the motion monitor over every choice the card offers: the first dropdown through each view, the time span, the SOTD button and back, two rows picked, the menu open and closed. Expect no flash, snap or jitter.",
    seconds: 4,
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      { wait: 800 },
      ...watch(30000),
      { ...choose("stat", "Albums"), frames: 40, region: '[data-slot="c"]' },
      { ...choose("stat", "Artists"), frames: 40, region: '[data-slot="c"]' },
      { ...choose("stat", "Playlists"), frames: 40, region: '[data-slot="c"]' },
      { ...choose("stat", "Songs"), frames: 40, region: '[data-slot="c"]' },
      { ...choose("window", "Past Month"), frames: 40, region: '[data-slot="c"]' },
      { ...choose("window", "Past Year"), frames: 40, region: '[data-slot="c"]' },
      { eval: `(async () => { const b = document.querySelector('${C}#rewind-sotd'); if (b && !b.hidden) { b.click(); await new Promise((r) => setTimeout(r, 1500)); b.click(); await new Promise((r) => setTimeout(r, 1500)); } })()`, frames: 60, region: '[data-slot="c"]' },
      { ...ctrlClick(`${C}.qrow[data-idx="1"]`), frames: 20, region: '[data-slot="c"]' },
      { ...ctrlClick(`${C}.qrow[data-idx="2"]`), frames: 20, region: '[data-slot="c"]' },
      { wait: 300 },
      { rightclick: `${C}.qrow[data-idx="1"]`, frames: 30 },
      { wait: 600 },
      { ...key("Escape"), frames: 30 },
      { wait: 300 },
      { ...key("Escape"), frames: 20, region: '[data-slot="c"]' },
      ...report("choices"),
    ],
  },
  {
    id: "visual-song-change",
    about: "VISUAL, PLAYS about 15 s: the list redraws at a song change (Songs, Past Day). Two skips under the motion monitor. Expect no flash, snap or jitter on the rows.",
    kind: "clip",
    seconds: 4,
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      { rightclick: `${C}.qrow[data-idx="3"]` },
      { wait: 400 },
      PLAY,
      { wait: 4000 },
      choose("window", "Past Day"),
      { wait: 1000 },
      ...watch(14000),
      { eval: "window.__music.skipToNextItem()", frames: 60, region: '[data-slot="c"]' },
      { wait: 4000 },
      { eval: "window.__music.skipToNextItem()", frames: 60, region: '[data-slot="c"]' },
      { wait: 4000 },
      ...report("song change"),
      { eval: "window.__music.pause()" },
    ],
  },
  {
    id: "visual-read",
    about: "VISUAL: the readability check on the card (Songs, then the SOTD list) in every theme and skin. Every text box scored against the pixels behind it (WCAG AA, README.md §2b).",
    kind: "shot",
    looks: [{ theme: "*", skin: "*" }],
    steps: [
      ...OPEN,
      choose("stat", "Songs"),
      choose("window", "Past Year"),
      { wait: 1200 },
      { read: "rewind-songs" },
      { eval: `(async () => { const b = document.querySelector('${C}#rewind-sotd'); if (b && !b.hidden) { b.click(); await new Promise((r) => setTimeout(r, 1800)); } })()` },
      { read: "rewind-picks" },
      { eval: `(async () => { const b = document.querySelector('${C}#rewind-sotd'); if (b?.getAttribute('aria-pressed') === 'true') b.click(); })()` },
    ],
  },
  restore(RUN, `${C}.panel__title`),
];

const list = {
  about: "The Rewind card's quality sweep on his LIVE dev app (QUALITY-SWEEP.md; DEETS-REWIND.md § Sweep): guards that pass today and fault shots that fail today until their fix lands. Made by rewind-sweep.mjs; edit that, not this.",
  desk_test: "features/DEETS-REWIND.md § Sweep",
  made: "2026-10-18",
  pass: "Every guard-… shot ok. Each fault-… shot fails today with its EXPECT FAIL line, and passes once its fix lands. Read the snaps of guard-midi-fits and fault-unknown-playlist. The run plays music twice (about 80 s and 12 s).",
  run: "node docs/ops/checks/rewind-sweep.mjs && node scripts/shots.mjs --list docs/ops/checks/rewind-sweep.json --noise 80   (dev app running and on screen; it plays music; ask other sessions first)",
  shots: shots.map((s) => ({
    covers: "features/DEETS-REWIND.md",
    kind: "clip",
    source: "dev",
    seconds: 8,
    size: "max",
    ...s,
  })),
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "rewind-sweep.json"), JSON.stringify(list, null, 2) + "\n");
console.log(`rewind-sweep.json: ${shots.length} shots`);
