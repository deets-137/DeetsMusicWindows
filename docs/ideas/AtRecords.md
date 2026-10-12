---
status: idea
desk_test: none
sources: [src/look-ids.ts, src/skin.ts, src/look.ts, src/look-schedule.ts, src/styles/skin.css, src/styles.css, src/vinyl.ts, src/skin-settings.ts, src/rules-window.ts, src/rules-eval.ts, src/gpu.ts, src/layout.ts, src/sound.ts, src/ocean.ts, index.html, tray.html]
updated: 2026-10-12
---
# at-records — Max as a record player, an easter egg

> **An idea, opened 2026-10-12** from the owner's ask: "at exactly my widescreen's window size,
> turn the Max surface in Cyber into a full-on record player skinned app; build on Cyber or a
> hidden skin called at-records; just as an easter egg." He added: "can use three.js or another
> motion design / 3D kit." Nothing is decided and nothing is built. Every fork in §9 is his. Do
> not tell a user the app does this.
>
> **His calls, 2026-10-12 (evening):** a **sixth, hidden skin** (fork A1), and the egg opens
> when the Max window is at **the full size of his ultrawide monitor** (fork B: the size, read
> as the maximized window). **He designs the UI himself.** This doc holds the mechanics only; it
> does not say what the record player looks like. Do not write that picture for him.

## 0. Terms

- **Skin:** one attribute, `data-skin` on `<html>`. The token blocks in `skin.css` do the rest
  (UI-ARCHITECTURE.md). Five ids exist: `vanilla`, `press`, `ocean`, `glass`, `cyber`
  (`SkinName` in `look-ids.ts`).
- **Hidden skin:** a skin id with no button in any picker. `vanilla` is one today (index.html
  line 126: "Vanilla is hidden from the picker (2026-09-10) … a saved vanilla still applies").
- **Picker:** every place a skin can be chosen. There are two kinds: the hand lists (the title
  menu flyout in `index.html`, the tray flyout in `tray.html`, `controls.js` in DeetsSolutions)
  and the one shared list `SKIN_OPTIONS` in `look-schedule.ts`, which feeds the look schedule
  rows, the Rulez card, the agent's `settings` tool and Compass.
- **Max:** the surface with the stage column (Now Playing over the Queue, `.stage`) and the
  bento of two to four cards beside it (`.bento`, slots left · right · c · d; MAX-CARDS.md).
- **The disc:** the Press record player (VINYL.md, `vinyl.ts`): the cover cut into a record
  that turns at the song's angle. Three tokens gate it: `--vinyl-stage`, `--vinyl-strip`,
  `--vinyl-tray`, all 0 in the base and set to 1 only under `[data-skin="press"]`
  (skin.css lines 1119–1121).
- **Window facts:** `windowWidth` and `windowHeight`, two rule facts from `rules-window.ts`
  (one ResizeObserver, a 150 ms settle). `skin` is a rule key (`rulez-words.ts` line 256:
  "Use skin").
- **The graphics fact:** `graphics` = `accelerated` | `software` (`gpu.ts`,
  GRAPHICS-FALLBACK.md). A built-in rule turns the heavy effects off while it reads `software`.

## 1. The core facts, checked against the code

1. **A skin is CSS over the same DOM.** Every skin block sets tokens; three skins add one
   module for a moving layer (`storm.ts` for Cyber's bolts, `ocean.ts`, `wallpaper.ts`). No
   skin moves an element or adds a control. So at-records can dress the Max tree as a hi-fi,
   and it can add its own layer module. It cannot rearrange the cards. The cards keep their
   layout and their eight systems (SURFACES-AND-CARDS.md §5) without a change.
2. **The disc exists.** at-records sets `--vinyl-stage: 1` and the stage cover is a turning
   record at the song's angle, with the slide on a song change, the scratch on a scrub, and the
   telemetry. No new motion code for the platter.
3. **The trigger exists.** A built-in rule like `row:graphicsFallback` (`rules-eval.ts`) can
   read the two window facts and set the `skin` key. A rule lays its value over your own
   setting (`effective`), so your pick stays Cyber; leave the size and Cyber comes back. No
   setting, no row, nothing to reset. That is what "at exactly my window size" is in this
   code base.
4. **A hidden skin is a known shape.** `vanilla` shows how: the id is in the type and the
   stylesheet; it is absent from the flyouts and from `SKIN_OPTIONS`. A rule can still set it
   because the rule is built in, not made from the Rulez list.
5. **No 3D kit is in the bundle.** `package.json` has two runtime dependencies, both Tauri.
   No CDN is possible: the app must work offline and SECRETS-AND-CSP.md plans a strict policy.
   Any kit is an npm package in the bundle, and it should load as its own chunk only when the
   easter egg fires (`import()`), so every other user never downloads it.
6. **WebGL needs the graphics fact.** A WebGL canvas in WebView2 draws in the GPU process.
   When the process falls back to WARP the `software` rule must also stop at-records' 3D
   layer, the way it stops Glass frost. Frames ÷ ms are measured on `npm run dev:built`
   (CLAUDE.md › Graphics work).
7. **The tray panel stays Cyber.** `tray.html` paints the store's own `skin`, not the
   effective one. The egg is the main window only. That is correct for an easter egg.
8. **A skin change plays the look transition.** `look.ts` runs the appearance transition on
   a skin change (`Animate look changes`). The rule flipping the skin at the size edge plays
   the Cyber snap in and out. Fine, and it is already his setting.

## 2. The picture

> **His, 2026-10-12.** The owner designs the look of the record player himself: what the stage,
> the Queue, the bento slots, the canvas and the title bar become. This section is left for his
> design. The mechanics that any design can lean on are §1 and §5.

## 3. Fork A — on top of Cyber, or a sixth skin (DECIDED: A1, 2026-10-12)

| Option | What the code says |
|---|---|
| **A1. A sixth skin id `at-records`, hidden** | One new block in skin.css, like the five. The type grows by one word (`look-ids.ts`), `appearance.ts` gets its font pair, `tray.html` needs nothing. It is absent from the flyouts and from `SKIN_OPTIONS`, so no picker, no schedule, no Rulez list, no agent, no Compass. The vanilla precedent. **Recommended.** |
| A2. A mode on Cyber: `[data-skin="cyber"][data-at-records]` | Every Cyber token at-records changes needs a second rule under the compound selector; the bolts keep drawing behind the hi-fi unless each storm token is re-set. It doubles the Cyber block for no gain, and a second attribute is a fourth lever beside theme, skin and surface. |

A1 can still **inherit Cyber's values**: the at-records block starts as a copy of the Cyber
block (type, square corners, the nav snap) and changes only the hi-fi parts. The two then
drift apart, as every skin does. That is the price of a clean sixth skin.

## 4. Fork B — the trigger (DECIDED: the full monitor size, 2026-10-12)

| Option | What the code says |
|---|---|
| **B1. The window size, as a built-in rule** | `windowWidth = W` and `windowHeight = H` and surface Max and skin Cyber → `skin = at-records`. The precedent is `row:graphicsFallback`. Needs the two numbers (§9). **Recommended: it is his ask.** |
| B2. A word in Compass | "at records" as one command row in `compass.ts` (COMPASS.md §9). A latch for a demo, with no resize. |
| B3. Both | The size is the door; the word is the latch for showing someone. |

**"Exactly" is a fork of its own.** A Windows snap, a DPI change or a monitor change moves
the logical size by a few px. B1 can read the exact pair, or a band of ± 4 px, or "any Max
wider than N". The exact pair is the easter egg he asked for; the band is what survives a
monitor. The rule's `onHand` behavior is one more choice: a hand pick of another skin while
the egg is on turns it off until the next size change (the look schedule's rule), or holds
until the size changes (nothing to add).

**His call: the egg opens when Max fills his ultrawide monitor.** Two ways to read that, and
the code has neither yet:
- **The maximized state.** Tauri's `getCurrentWindow().isMaximized()` and its resize event.
  No module reads it today (grep: none). A new fact `windowMaximized` in `rules-window.ts`,
  on the same ResizeObserver seam. It holds on any monitor and any DPI. **Recommended.**
- **The size pair.** The two window facts against his monitor's logical work-area size. It
  breaks on a monitor or DPI change.
The Max default is 1100 × 950 (`sizeMax`); a maximized window ignores it.

## 5. Fork C — how the depth is drawn

| Option | What it gives | Cost | What the code says |
|---|---|---|---|
| **C1. CSS + the existing disc** | The disc turns (already); any flat element he designs, in tokens | 0 KB; one skin block, one small element | Every skin today is this. The disc's telemetry and the compositor animations come free. The meters need C2. |
| **C2. A 2D canvas in a worker** | Anything drawn each frame from the sound, or a texture drawn once | ~0 KB; one worker module | The precedent is `ocean-worker.ts` / `wallpaper-worker.ts`: a texture drawn once, needles drawn each frame while music plays, stopped on pause. The analysers exist in `sound.ts`. |
| C3. three.js (WebGL) | Lit geometry with depth, shadows, a camera | ~160 KB min+gz as a lazy chunk; a 3D model (a glTF turntable is 1–5 MB) or geometry built in code; a WebGL canvas behind the stage card | Runs in the GPU process: honest numbers only on `dev:built`; must stop under `graphics = software` (fact 6). The cover becomes a texture on a 3D disc, so the Press disc code is replaced for the stage, not reused, and the song-angle sync (VINYL.md §4) is written a second time. |
| C4. A motion library (GSAP, Motion One) | Easing and timeline helpers | 20–60 KB | Not needed: the app runs the Web Animations API with plain values (`vinyl.ts`, `pop.ts`); the skin motion tokens are the timeline. Ruled out. |

**Recommendation: C1 + C2 first, C3 as a second step.** C1 is the material every other skin is
made of and reuses the disc and its desk tests at no bundle cost. C3 is a lazy chunk for the
stage only. A 3D kit for the whole window (every card a textured box) is ruled out: the cards
must stay the cards, with text selectable and lists virtualized. Which parts he draws with
which is his, with his design.

If C3 happens: `three` from npm, tree-shaken (the renderer, one scene, one light, a cylinder,
the arm as a few boxes), loaded with `import()` when the rule fires, a `<canvas>` under the
stage card, `preserveDrawingBuffer: false`, `renderer.setAnimationLoop` only while music plays
and the window is visible (`document.hidden`), and torn down when the rule releases.

## 6. What the rest of the app does under the egg

- **Every card works.** The skin sets tokens; the cards' DOM, keys, menus, drags and memory
  are untouched. Hide cards, Max cards (4 · 2 columns · 2 rows · 1 card) all still apply; the
  stage column is always there in Max, so the turntable is always there.
- **The Press rows.** If at-records sets `--vinyl-stage: 1`, the Press rows *Record player*,
  *Spin speed* and *Show record plate* are Press-only in Settings (their hints say so). Fork:
  the egg reads those rows anyway, or fixes its own values.
- **The full player.** Clicking the gap opens Now Playing full (fullscreen-player.md). It
  works under the egg with nothing added; the disc scales with the cover box.
- **Album color.** The album-color facts and tokens follow the cover (ALBUM-COLOR.md) and are
  there for his design to use or not.
- **Reduced motion.** The disc already stands still under it; a canvas layer holds its last
  frame; C3 draws one still frame.
- **Shots.** The motion set (`docs/guide/motion.json`) gets a sixth skin only if he wants it in
  the strips; a hidden skin can stay out of the demo (DeetsSolutions' list is a hand list).

## 7. The build list, if he says go

1. `look-ids.ts`: `"at-records"` in `SkinName`. `appearance.ts`: its font pair for the
   preload. Nothing in the pickers, nothing in `SKIN_OPTIONS`.
2. `skin.css`: the `[data-skin="at-records"]` block, from the Cyber block; `--vinyl-stage: 1`;
   the storm off. `npm run tokens` in the same commit (TOKENS.md is generated).
3. Any new element his design needs in the stage or the cards, drawn only under at-records
   (`display: none` elsewhere); `vinyl.ts` can publish the song position as a custom property
   (one line in the rate loop) for anything that follows the song.
4. `rules-window.ts`: the `windowMaximized` fact. `rules-eval.ts`: the built-in rule (Max and
   Cyber and maximized → `skin = at-records`), and a `diag.log` line on arm and release
   (CLAUDE.md checklist 6).
5. `at-records.ts` (+ a worker if C2): the skin's layer module, started by the rule, stopped on
   release, off under `graphics = software`.
6. Docs: this doc moves to `docs/features/AT-RECORDS.md` with the as-built record; TOKENS.md
   regenerated; one line in ONBOARDING.md §2 only if a right-click appears (none planned);
   TOASTS.md untouched (no toast); SETTINGS.md untouched (no key).
7. `npx tsc --noEmit`, `npm run check`, then his desk test at the size.

Estimated size: one sitting for the mechanics (1, 4, 5) once his design exists; the skin block
(2, 3) is as long as the design; C3 is a sitting of its own.

## 8. What this is not

- Not a restyled Mini, and not Winamp's fixed layout (that is ClassicSkins.md).
- Not a Skinz slot: Skinz edits the 6 theme slots and, later, a few skin controls (SKINZ.md
  §4). at-records is a built-in skin like the five.
- Not shown in Hop in, the look schedule or the guide. An easter egg is found, not offered.

## 9. Forks

Decided 2026-10-12: **A1** a hidden sixth skin; **B** the trigger is the Max window at the full
size of his ultrawide. He designs the UI, so the look forks are his design, not a table here.

| # | Fork | Options | My recommendation |
|---|---|---|---|
| B′ | How "full size" is read | the maximized state · the size pair | **the maximized state** (§4) |
| B″ | A second latch | none · a Compass word for a demo | none unless he wants to show it to people |
| C | How the depth is drawn | C1 CSS + disc · C2 + canvas · C3 three.js for the stage | **C1 + C2**, C3 a second step (§5) |
| D | The Press rows under the egg | followed · fixed values | his design decides |
| F | A hand pick while the egg is on | turns it off until the next size change · ignored while the size holds | turns it off (the look schedule's rule) |
