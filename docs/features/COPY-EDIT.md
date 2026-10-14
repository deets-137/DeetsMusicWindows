---
status: built
desk_test: passed 2026-10-13
sources: [src/copy-edit.ts, scripts/copy-edit-plugin.mjs, vite.config.ts, src/main.ts]
updated: 2026-10-12
---
# DeetsMusic — Copy editor (dev only)

> **Status (2026-10-13): BUILT, desk test passed 2026-10-13 (§5).** His ask: type over the words of the
> Settings and Rulez cards in the dev app, the way the DeetsSolutions dev server lets him type
> over a page (`../DeetsSolutions/scripts/copy-edit.js`). His calls on 2026-10-12: every card
> (not only Settings and Rulez), Alt+click to edit a hover hint, the save holds the reload,
> labels + hints + pills + headers + the Rulez words (not toasts). The toggle sits in the title
> bar.

## 1. What it does

- **The pencil** sits at the left of the title bar icons (Web, Room, Sound, Sleep). It shows
  only on the dev server: `src/copy-edit.ts` is imported behind `import.meta.env.DEV`, and the
  server half (`scripts/copy-edit-plugin.mjs`) is a Vite plugin with `apply: "serve"`. The
  release bundle and the web demo carry none of it. Alt+E does the same as the pencil.
- **Edit mode on:** each piece of words on screen (every card, every open panel; not the title
  bar) is traced to where it is written in `src/**/*.ts`:
  - **solid outline:** found in one place. Click, type. Enter or a click away saves. Esc undoes.
  - **dashed outline:** a template with `${…}` parts. It shows `{n} songs`. Keep each `{…}`;
    a save without one is refused.
  - **dotted outline:** written in several places (`"Off"`, `"Home"`). Locked. Its hover hint
    names up to six places.
  - The hover hint of an outlined word names its file and line.
- **Alt+click** anything that has a hover hint: a small field opens under it with the hint's
  source text. Enter saves, Shift+Enter is a new line, Esc closes.
- **A save** writes the `.ts` file at once and holds Vite's reload for 3 s (his call). The new
  words are already on screen; the code takes them at the next reload, so the music keeps
  playing. The pencil's hover hint counts the saves.
- **While edit mode is on**, a press on outlined words stays with the words: it never plays a
  row, opens a menu, starts a drag or reaches the card's keys. A press anywhere else works as
  usual, so you can open another Settings section; its words are picked up as they appear.

## 2. Where a text can live

The plugin parses each file with the TypeScript compiler, so the offsets are exact.
- a plain string: `"Home"`, `'Off'`, `` `Hours` `` (not an import path, a property key or a type)
- a template with `${…}` parts. A loose template (`` `${n} song${s}` ``) matches a lot of
  text; the one with the most fixed letters wins, and a tie is locked.
- one text run between tags in a string or template that holds HTML: the `Library` in
  `` `<span>Library</span>${x}` ``. `&amp;` and the like read as `&`, and a save writes them back.

A second save in the same file finds its text again by its source, since the first save moved
the offsets.

### 2a. A Settings row's copies (his call, 2026-10-12)

A Settings row's words are written again, on purpose, in the files that name the row in its own
words: `agent-settings.ts` (the agent sets a setting by its label), `settings-repair.ts` (the
notice after a reset), `sound-panel.ts`, `quick-panel.ts`, `look-schedule.ts`, `rulez-words.ts`,
`rulez-card.ts`, `rulez-logs.ts`. When every copy of a word sits in `settings-card.ts` and these
files, it is ONE text: one save changes every copy, and the hover hint lists them all. Every copy
is found before any file is written; if one cannot be found, nothing is saved. A word that is
also used anywhere else (`"Off"`, `"Home"`, `"Album"`, the card names, the weekdays) stays locked.
Count on 2026-10-12: 235 of 296 Settings labels and pill words editable, all 142 hints.

## 3. Not offered

- `index.html`: the title bar's menu (Theme, Skin, Surface…) and its `title` hints.
- Words built from data: song, album and artist names.
- Toasts (his call), `aria-label`s, `placeholder`s.
- Words in a `.ts` file that the editor skips: `copy-edit.ts`, `perf.ts`, `frames.ts`, `marks.ts`.

## 4. The files

| File | Part |
|---|---|
| `src/copy-edit.ts` | the pencil, edit mode, the outlines, the event shield, the hint field |
| `scripts/copy-edit-plugin.mjs` | `/__copy/ping`, `/__copy/probe`, `/__copy/save`; the reload hold |
| `vite.config.ts` | adds the plugin |
| `src/main.ts` | imports the module behind `import.meta.env.DEV` |

## 5. Desk test (his)

On `npm run dev:app`, with a song playing:
1. The pencil shows in the title bar. Press it (or Alt+E). It turns the title color.
2. Open Settings. Labels and hints show outlines. Click a label with a solid outline, change a
   word, press Enter. The outline turns green. The music keeps playing. `git diff` shows the
   change in `settings-card.ts` and in each copy its hover hint listed (§2a).
3. Change a second label in the same section. It saves too.
4. Alt+click a row with a hover hint. Edit the hint in the field, press Enter. Hover the row:
   the new hint shows.
5. Open the Rulez card. Its words show outlines; edit one.
6. Click a dotted word: nothing happens, and its hover hint names the places.
7. Press the pencil again. The outlines go, and a click on a row plays it again.
8. Reload (Ctrl+R): the edits are in the app.
