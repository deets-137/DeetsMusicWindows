---
status: idea
desk_test: none
sources: [src/styles/skin.css, src/styles/themes.css, src/styles.css, src/look-ids.ts]
updated: 2026-10-21
---
# Mods — skins and themes a user downloads, and a page to pick them

> **An idea, opened 2026-10-19** in a talk with the owner ("can we chat theoretically about a
> mod system"). Nothing is decided and nothing is built. Every fork in §8 is his. Do not tell a
> user the app does this.

The Metal skin ([metal.md](../features/metal.md)) is the test case for this doc. Its token cleanup
(metal.md §4.4, the primitives) is the public API a mod would set, so mods come after it.

## 0. Terms

- **Mod:** one file a user downloads and installs. For now a mod is visual only: a theme, a
  skin, or both, with its pictures and fonts. No mod runs code (§6.1).
- **Primitive:** a skin token that many feature tokens read (metal.md §4.4). A mod sets
  primitives, never the ~680 feature tokens.
- **Theme** and **skin:** the same words as [SKINZ.md](../features/SKINZ.md).

## 1. The marketplace page (his idea, 2026-10-19)

> **Part:** idea · 2026-10-19

A page in the style of a marketplace, beside the onboarding, where a new user sets up the app
when it first loads. It goes with Hop in ([HOP-IN.md](../archive/HOP-IN.md), designed, not
built): the welcome screen and the Cruisin / Pro pick. Not designed. Points to settle when it
is:

- Where it sits: a step of Hop in, after the Cruisin / Pro pick, or a page Hop in links to.
- What it shows at first: the built-in skins and themes only, or mods from a gallery too
  (that needs the network on a first load).
- Whether the same page stays reachable later, from Settings or the Compass.
- He designs the page.

## 2. The file

A `.deetsmod` file, a ZIP. The name matches `.deetsbackup` (BACKUP.md). `.dm` is out: BYOND's
Dream Maker uses it, and Windows would show the wrong app.

- `manifest.json`: name, author, version, the `api` version it targets, what it holds.
- `theme.json`: values for the 12 main roles, light or dark.
- `skin.json`: values for the primitives.
- `assets/`: pictures (PNG, SVG, WebP) and fonts (WOFF2). All local.
- `preview.png`: for the install screen and the page in §1.

## 3. Three ways to install, one result

- **Double-click the file.** The signed sparse package (IDENTITY.md) can declare the file type.
- **Drop it in the `mods` folder** in the app's data folder.
- **Click a `deetsmusic://` link** on deets.solutions, or pick one on the page in §1.

Each way copies the file into `mods`, checks it (§6.2), and opens a live preview. A token
change is only a repaint, so the preview is the real app. Settings gets a list of installed
mods with Apply, Remove and Reset.

## 4. A theme and a skin are not the same kind of install

> **Part:** idea · 2026-10-19 · later (his note: "we'll worry about the new theme slots later")

- **A theme:** the Skinz decision (SKINZ.md §1, his call) is that there are always 6 slots,
  and a slot is edits on a built-in. The id is a contract: the pre-paints, the rules, the look
  schedule, the extension and DeetsSolutions all carry it (SKINZ.md §2). A downloaded theme
  fits that rule as edits on a slot you pick. A seventh theme with its own id breaks it.
- **A skin:** a skin id is the same kind of contract (metal.md §6.4 lists where it lives). A
  downloaded skin would be one "Mod" skin id that holds the active mod's values over the
  Vanilla base. The pre-paints, rules and extension learn one new id, once.

## 5. Making and showing mods

- **The Skinz card can export one.** If the Skinz card is built, it can write a `.deetsmod`
  from your edits. Then making a mod is a feature of the app, not a developer task.
- **Previews on the web.** The web demo runs the real UI. A gallery page on deets.solutions
  could show any mod in the demo before you download it.

## 6. Safety

### 6.1 Values only, no code and no CSS

A mod sets token values. It does not run script, and it does not ship CSS rules. CSS rules can
draw text with `content:` and hide elements with `display: none`. A "visual" mod could then
hide a sign-in notice or paint false words over it. A token value lands only in the one
property that reads it, so it cannot do that.

### 6.2 Each value is checked at install

- **The name:** only the primitives and the 12 roles. An unknown name is refused.
- **The value:** `CSS.supports(<property>, <value>)` for the property the token feeds. A
  layered value that does not parse silently becomes `initial`, which gives a transparent card.
- **`url()`:** only the mod's own files or a data URI. The webview's CSP blocks any remote
  URL, so a skin cannot load a tracking picture.
- **Paint goes in paint tokens only.** `--panel` stays a color: `color-mix()` reads it for the
  Now Playing chips.
- **Contrast:** the Skinz rule (warn, show the value, let you keep it) applies to a theme mod.

### 6.3 Fonts

`fonts.css` bundles each font today. A mod font is a `@font-face` the app writes from the
manifest, from the mod's own WOFF2 file. The app writes the rule; the mod gives only the file
and a family name.

### 6.4 Safe start

If the app fails to start twice after a mod changes, it turns the mod off and says so. Holding
Shift at launch starts with mods off. The graphics fallback (GRAPHICS-FALLBACK.md) is the
model.

### 6.5 Versions

The manifest's `api` version lets the app keep an alias table when a primitive is renamed.
Once mods exist, the primitives are a promise to mod authors. The feature tokens are not.

### 6.6 A heavy mod

A mod can be slow to draw. The install could take a short frames sample after the preview and
warn when the mod is heavy. On WARP, the graphics fallback turns its paint layers off.

## 7. Out of scope: widgets

The same talk covered widgets (new cards made by others), with DeetsRGB (`../DeetsRGB`) as the
example: the keyboard on the album's primary color, the mouse on the secondary. That is code,
so it is out of scope here. Three facts from the talk, kept as a record:

- A sandboxed widget cannot open a HID device. The hardware stays in DeetsRGB, which would
  subscribe to the colors over the paired loopback bridge (EXTENSION.md is the pairing model).
- **Every keyboard write is a flash write** (DeetsRGB's `docs/protocol.md`). A color per song
  wears the flash. The `0x08` live stream is not persisted, so one color on every LED needs
  no LED map: one flash write to enter a stream mode, then frames. A probe must show which
  mode takes the frames.
- The Razer Elite has `NOSTORE` (session only), and the Corsair M75 is already streamed.

## 8. Forks (all his)

- **F1, a mod's reach.** Tokens and hooks only (recommended: §6.1), or tokens plus scoped CSS.
  Scoped CSS reaches further, but each class rename breaks a mod.
- **F2, a downloaded theme** (later, §4). Edits on a slot you pick, or a seventh theme.
- **F3, distribution.** Files only, or a gallery on deets.solutions. Signed authors, or
  "unknown author" on all.
- **F4, the marketplace page** (§1). Its place in Hop in, and what it shows on a first load.
- **F5, who is held to the public layer** (§10). **Closed 2026-10-21: every skin (his call:
  "we made an effort to tokenize so shouldn't be too large in scope").** The measure and the plan
  are §10.1.

## 9. What tokens reach today: the Halloween test

> **Part:** idea · 2026-10-21 (his question: "imagine a fully decked out Halloween skin — can
> our tokens handle it, with users using only our tokens?")

Measured on main at 2c1ef97:

- **747 skin tokens** in `skin.css` and **63 theme roles** in `themes.css`.
- **64 CSS rules** in `styles.css` apply to one skin only (Metal 19, Ocean 7, Press 6,
  Glass 6, Cyber 3). A mod cannot write these (§6.1).
- **Five TS files** check the skin id (`metal.ts`, `ocean.ts`, `vinyl.ts`, `wallpaper.ts`,
  `settings-card.ts`). The sea, the record and the drum are drawn in code.
- **No shape primitives.** Metal's step 1 tried them and stopped (metal.md §6.4), so a mod
  that changes corners sets each radius token one by one.

| A Halloween skin wants | Tokens today? | Why |
|---|---|---|
| Orange, purple and black | Yes | 63 roles; edits on one of the 6 slots (§4). |
| A spooky font | Partly | 4 font tokens; nothing loads a mod's font yet (§6.3). |
| Jagged corners | Yes, but hard | No primitives; hundreds of radius tokens. |
| Cobweb cards, fog behind them | Partly | Metal's paint hooks (`--panel-blend`, `--control-paint`, `--app-canvas-color`) take an image; nothing loads a mod's own image yet. |
| Faster or slower motion | Yes | Timings are tokens. |
| Bats that fly, a candle flicker, a coffin-lid card swap | No | A new animation is keyframes or code. |
| A pumpkin Play button | No | Icons are inline SVG in 36 TS files; no icon token. |
| A custom cursor | No | 127 cursor rules, 0 cursor tokens. |
| A spider on the title bar | No | It needs `content:`, which §6.1 bans. |
| Sounds | No | The app has no UI sounds. |

Tokens cover about half of a fully decked-out skin.

## 10. The public layer: what makes a mod future-proof

> **Part:** idea · 2026-10-21

"Only use tokens that exist" is not enough, for two reasons:

1. **No small public layer.** A mod would set feature tokens. Rename one and the mod breaks.
2. **A new feature gets no mod style.** A card built next year with its own raw defaults shows
   Vanilla inside every older mod.

**The rule:**

- A mod sets only the **public layer**: the theme roles, the primitives, the hooks and the
  slots (§11). The public layer is versioned by the manifest's `api` (§6.5).
- **Every feature token in the base takes its default from a public token**
  (`var(--shape-control)`), never from a raw value. A new card then wears an old mod's look
  with no change to the mod.
- `docs:check` enforces it: a new base feature token with a raw value fails, the same way a
  scroller without `app-scroll` fails.
- A built-in skin may still set feature tokens directly (fork F5), so the built-in skins keep
  their deliberate differences.

### 10.1 Every skin on the public layer: the measure (2026-10-21)

Measured in `skin.css` on `happy-thirtytwo` (comments taken out):

- **697 base tokens** in `[data-skin]`: **198** already read another token, **499** hold a
  raw value. **543** of them no skin changes.
- **The six skins set 202 names:** 154 base tokens and 48 of their own (Metal 30, Glass 15,
  Ocean 3). Per skin: Glass 83, Metal 81, Press 72, Cyber 69, Ocean 52, Vanilla 4.
- **The skins vary shapes on purpose, but in families.** The 12 radius tokens the skins change
  move in about 5 groups (panel, popover, control, tile and art, pill). Glass rounds tiles and
  pills 12 px and row art 8 px; Cyber squares tiles and rounds pills 2 px.

**The plan:**

1. **The skins move onto the public layer, pixel for pixel.** Each family a skin changes gets
   primitives fine enough to hold every skin's values (radius: about 5, not 1). A skin's own
   effect (Ocean's sea, Press's record, Metal's drum, the aurora) stays a named **hook** in the
   public layer, so a mod can set it too. The public layer comes to about 63 roles and 100 to
   130 skin names, not the 40 to 60 hoped for in §10.
2. **The proof is pictures:** the shots runner in every skin and theme, before and after, with
   no pixel changed.
3. **The base rule** (docs:check) holds the kinds a mod can set: radius, time, easing, type,
   shadow, spacing (about 140 raw base values to alias). A size that belongs to one control or
   one drawing (182 px sizes: a sprite's 32 px, a knob's height) stays raw, marked as such.

**The Happy skin is the reference** ([happy.md](../features/happy.md)). It is built only on the
public layer and uses every part of it. A mod author reads it to see what a skin can do.

## 11. Slots: a mod gives a value or a file, the app draws it

> **Part:** idea · 2026-10-21

Each slot keeps the values-only rule (§6.1): the mod never ships a CSS rule or a script.

- **Image slots:** the mod's own PNG, WebP or SVG in the paint hooks: canvas, panel, control,
  title bar.
- **Ornament anchors:** fixed places (the title bar corners, the card corners, the cover frame)
  that each take an image, an offset and a size. A spider on the title bar, with no `content:`.
- **An icon set:** SVGs with fixed names (play, pause, next, …), cleaned at install (no
  script, no remote `href`). The 36 files must first get their icons from one module.
- **Cursor slots:** one token per cursor kind (default, pointer, grab, text).
- **Motion presets:** the mod picks from named shapes the app ships (fade, slide, drum, flip)
  and particle presets (drift, fall, flicker) with its own image. Bats are "drift" with a bat
  picture. A mod never writes keyframes.
- **Fonts:** the loader in §6.3.
- **Sounds** (if the app gets UI sounds): named events with the mod's own short files.
