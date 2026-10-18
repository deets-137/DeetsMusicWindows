// The shared steps of a quality-sweep shots list (QUALITY-SWEEP.md §3, "Script the guards").
// A sweep list (`<feature>-sweep.mjs`) imports these instead of writing its own, so a mistake
// found once is fixed for every sweep. Each one is a shots.mjs step (SHOTS.md §5i) or makes one.
//
// What each helper learned the hard way (the Rewind sweep, 2026-10-18):
// - `key`: a key goes to the page (`document.body`), never to `document`. Card key handlers read
//   the target's `closest`, which a document has not, so the press threw and did nothing.
// - `PLAY`: a song's "Play Now" can be only a glyph in the menu's quick column, with no row. Look
//   for the glyph first, then a row that starts "Play Now" or "Play 2 songs".
// - `save` / `restore`: a shot reloads the page, so what the run changes is kept in
//   localStorage between shots, and the list's last shot puts it back.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The page's own Tauri bridge, for READS in a probe (the play log, the playlists). Never a write
 *  except to undo what the shot itself made. */
export const INV = "window.__TAURI_INTERNALS__.invoke";
/** An in-page sleep, for a step's own async code. */
export const SLEEP = "(ms) => new Promise((r) => setTimeout(r, ms))";
export const slot = (name) => `[data-slot="${name}"] `;

/** Keep, once per run, what the run will change: the card in each named slot and the named
 *  localStorage keys. `key` names the run (`shots:<feature>-sweep`). */
export const save = (key, slots, localKeys) => ({
  eval: `(() => {
    if (localStorage.getItem(${JSON.stringify(key)})) return;
    const card = (s) => document.querySelector('[data-slot="' + s + '"]')?.dataset.mounted ?? null;
    localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({
      slots: Object.fromEntries(${JSON.stringify(slots)}.map((s) => [s, card(s)])),
      local: Object.fromEntries(${JSON.stringify(localKeys)}.map((k) => [k, localStorage.getItem(k)])),
    }));
  })()`,
});

/** The list's last shot: the localStorage keys back, then the card in each saved slot that is on
 *  this surface. `wait` is a selector that shows the page is up. */
export const restore = (key, wait) => ({
  id: "restore",
  about: "Puts back what the run changed: the saved slots' cards and the saved localStorage keys.",
  steps: [
    { reload: true },
    { wait },
    { wait: 1500 },
    {
      eval: `(async () => {
        const sleep = ${SLEEP};
        const kept = JSON.parse(localStorage.getItem(${JSON.stringify(key)}) ?? 'null');
        if (!kept) return;
        for (const [k, v] of Object.entries(kept.local)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
        for (const [s, id] of Object.entries(kept.slots)) {
          const host = document.querySelector('[data-slot="' + s + '"]');
          if (!id || !host || host.dataset.mounted === id) continue;
          host.querySelector('.panel__title')?.click();
          await sleep(400);
          host.querySelector('.flyout__item[data-card-id="' + id + '"]')?.click();
          await sleep(800);
        }
        localStorage.removeItem(${JSON.stringify(key)});
      })()`,
    },
  ],
});

/** The card `id` in `slotName`, picked from the slot title's card menu as a user picks it, unless
 *  it is there already. `ready` is a selector inside the card that shows it has mounted. */
export const cardIn = (slotName, id, ready) => ({
  eval: `(async () => {
    const s = '${slot(slotName)}';
    const sleep = ${SLEEP};
    if (document.querySelector(s + ${JSON.stringify(ready)})) return;
    document.querySelector(s + '.panel__title').click();
    await sleep(400);
    const b = document.querySelector(s + '.flyout__item[data-card-id="${id}"]');
    if (!b) throw new Error('no ${id} in the card menu of slot ${slotName}');
    b.click();
    for (let k = 0; k < 40 && !document.querySelector(s + ${JSON.stringify(ready)}); k++) await sleep(100);
  })()`,
});

/** Press `trigger` (a dropdown, a pill), then the menu row that reads `label`, then wait `settle`
 *  ms for the card to redraw. */
export const menuPick = (trigger, label, settle = 1500) => ({
  eval: `(async () => {
    const sleep = ${SLEEP};
    document.querySelector(${JSON.stringify(trigger)}).click();
    await sleep(250);
    const it = [...document.querySelectorAll('.ctx-menu__item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!it) throw new Error('no menu item ${label}');
    it.click();
    await sleep(${settle});
  })()`,
});

/** The open menu's play: the quick column's play glyph, else a "Play Now" / "Play 2 songs" row. */
export const PLAY = {
  eval: `(() => {
    const q = document.querySelector('.ctx-menu__quick-btn[data-quick="play"]');
    const it = q ?? [...document.querySelectorAll('.ctx-menu__item')].find((b) => /^Play (Now|\\d)/.test(b.textContent.trim()));
    if (!it) throw new Error('no play in the menu: ' + [...document.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent.trim()).join(' | '));
    it.click();
  })()`,
};

/** A key as the user presses it, on the page (see the note at the top). */
export const key = (k) => ({ eval: `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))` });

/** Ctrl+click an element (a row pick, as the user makes one). */
export const ctrlClick = (sel) => ({
  eval: `document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`,
});

/** Right-click an element found by script (when the CDP `rightclick` step cannot name it). */
export const contextAt = (selExpr) => ({
  eval: `(${selExpr}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))`,
});

/** The visual pass (QUALITY-SWEEP.md §3a): the motion monitor armed for `ms` over the default
 *  parts plus the feature's own `parts`, then (`motionReport`) its findings with the assertion
 *  of no flash, no snap and no jitter. Arm it AFTER the shot's last reload: a reload ends it. */
const MONITOR = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "smooth-monitor.js"), "utf8").trim();
export const watch = (parts, ms) => [
  { eval: `window.__monExtra = ${JSON.stringify(parts)}; window.__monMs = ${ms}` },
  { probe: MONITOR },
];
export const motionReport = (name) => [
  { wait: 600 },
  { probe: "JSON.stringify(window.__mon)", name: `motion: ${name}`, expect: { flash: [], snap: [], jitter: [] } },
];

/** Every theme in every skin, for a readability shot (`"looks"`). Read it with sweep-read.mjs. */
export const ALL_LOOKS = [{ theme: "*", skin: "*" }];
