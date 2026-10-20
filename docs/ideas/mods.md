---
status: idea
desk_test: none
sources: [src/styles/skin.css, src/styles/themes.css, src/look-ids.ts]
updated: 2026-10-19
---
# Mods — skins and themes a user downloads, and a page to pick them

> **An idea, opened 2026-10-19** in a talk with the owner ("can we chat theoretically about a
> mod system"). Nothing is decided and nothing is built. Every fork in §8 is his. Do not tell a
> user the app does this.

The Metal skin ([metal.md](metal.md)) is the test case for this doc. Its token cleanup
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
when it first loads. It goes with Hop in ([HOP-IN.md](../features/HOP-IN.md), designed, not
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
