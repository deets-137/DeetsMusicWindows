---
status: designed
desk_test: none
sources: [src/styles/themes.css, src/styles/skin.css, src/look-ids.ts, src/theme.ts, src/skin.ts, src/look.ts, src/album-color.ts, src/settings-store.ts, index.html, tray.html]
updated: 2026-09-27
---
# DeetsMusic — Skinz, your own theme and skin

**Skinz is the card where you change the colors of a theme and a few controls of a skin.**
It is a Max-only card, the second one after [Rulez](RULEZ.md). The token tiers it edits are
[UI-ARCHITECTURE.md](../architecture/UI-ARCHITECTURE.md); every token is in
[TOKENS.md](../architecture/TOKENS.md). The rule key it uses is
[RULES.md](../architecture/RULES.md) §7a.
Designed 2026-09-27. Build it after the Rulez desk test is closed (one load-bearing feature in
flight).

## 0. Terms

- **Role:** a theme color token, for example `--canvas` or `--text` (themes.css).
- **Skin token:** a shape, type, space or motion token (skin.css).
- **Slot:** one of the 6 themes in the theme list. The 6 slots are the 6 built-in themes.
- **Edit:** a value you set on a slot or a skin. An edit sits on top of the built-in value.
  A token with no edit keeps the built-in value.
- **Reset:** remove all the edits of one slot or one skin.

## 1. His forks (2026-09-27)

| Fork | Choice |
|---|---|
| What a slot is | **Edits on a built-in theme.** There are always 6 slots. You can edit, rename and reset each one. The id (`lilac` … `black-red`) never changes. |
| The colors you can change | **The 12 main roles** (§3). The derived colors follow them. |
| The skin | **A short list of controls that work in every skin** (§4). |
| What a rule can set | **The slot only** ("at night, use Moonlight"). No rule sets a single role. |
| Unreadable text | **Warn and show the contrast value. You can keep your color.** |
| Surfaces (Mini / Midi / Max) | **Nothing.** Surface tokens are layout sizes. |
| The card | **Skinz**, Max only. The module is `src/skinz-card.ts`, the card id is `skinz`. |

## 2. Why edits on a built-in, and not new themes

- **The id is a contract.** The pre-paints (`index.html`, `tray.html`), the rules store, the look
  schedule, the extension (`appearance_publish`) and DeetsSolutions all carry the theme id.
  An edit keeps the id, so none of them change.
- **Rules work with no new engine code.** `theme` is already a `RuleKey` (RULES.md §7a). A
  rule that picks a slot picks your edited slot.
- **A role we add later still has a value.** It comes from the built-in theme under your edits.
  A fully custom theme would have no value for it.
- **Reset is one step.** It clears the slot's edit list.

## 3. The theme: the 12 roles

> **Part:** designed · 2026-09-27

You can edit these roles on each slot. The names in the card are the words in the second column.

| Role | Card word |
|---|---|
| `--canvas` | Background |
| `--title` | Headings |
| `--text` | Text |
| `--subtext` | Dim text |
| `--surface` | Menus |
| `--surface-hover` | Menu hover |
| `--border` | Menu edge |
| `--panel-border` | Card edge |
| `--go` | Accent 1 (maximize) |
| `--stop` | Accent 2 (close) |
| `--pause` | Accent 3 (minimize) |
| `--ink-2` | Second plate (Press) |

**The derived colors follow the roles.** The `:root` block in themes.css already derives
`--picked`, the EQ plot, the grow bar, the rail ink and the album fallbacks from these roles.
You never edit them.

**Three per-theme roles are not in the list, and follow an edit.** `--scrollbar`,
`--scrollbar-hover` and `--traffic-glyph` are literal values in each theme block today. When a
slot has an edit to `--title`, Skinz also writes:
- `--scrollbar: color-mix(in srgb, var(--title) 26%, transparent)`
- `--scrollbar-hover: color-mix(in srgb, var(--title) 44%, transparent)`

`--traffic-glyph` follows the slot's Light / Dark switch (§8).

**Album color still sits above the theme.** With album-colored text on, the Now Playing card
uses the album's colors, as today (ALBUM-COLOR.md).

## 4. The skin: the controls

> **Part:** designed · 2026-09-27

Each skin (Press, Ocean, Glass, Cyber) has its own edits, in the same way as a slot. A control
changes the skin's own value, so Press can keep square corners while Glass gets round ones.

| Control | Tokens it writes | Kind |
|---|---|---|
| Corners | `--panel-radius`, `--radius-panel`, `--radius-control` | A slider in px. The control radius is the panel radius × the skin's own ratio (0 when the skin's is 0). |
| Heading font | `--font-title` | A list of the fonts in fonts.css, plus "the skin's own". |
| Text font | `--font-body` | The same list. |
| Text size | `--fs-title`, `--fs-text`, `--fs-subtext` | A scale, 85 % to 125 %, applied to the skin's own sizes. |
| Spacing | `--space-1` … `--space-5` | A scale, 75 % to 150 %, applied to the skin's own steps. |
| Motion speed | `--dur-fast`, `--dur-med` | A scale, 50 % to 200 %. The OS reduced-motion preference still wins. |
| Card fill | `--panel` | A strength, 0 % to 100 %, mixed toward transparent. |

- **No network font.** The font list is only the fonts that fonts.css bundles.
- **Glass already has Tint and Frost** (skin rows, `glassTint`). In Glass, the Card fill row is
  the existing Tint row, with the same key. It is not a second control.
- **A scale reads the skin's own value**, so it is written as `calc(<skin value> * <scale>)`.
  skin.css gets one base token per scaled group (for example `--fs-scale: 1`), and the sizes
  become `calc(… * var(--fs-scale))`. This is a skin.css change, so `npm run tokens` runs in the
  same commit.

## 5. Where the edits are stored and how they are painted

> **Part:** designed · 2026-09-27

**Two store keys** in `settings-store.ts`:

```ts
themeEdits: Partial<Record<ThemeName, { name?: string; scheme?: "light" | "dark"; roles: Partial<Record<RoleName, string>> }>>
skinEdits:  Partial<Record<SkinName, SkinEditValues>>
```

- Defaults are `{}`: no edits, so every install looks the same as today.
- **They are not `RuleKey`s.** A rule sets `theme` and `skin` only (§1).
- A role value is a hex color. The store refuses any other string, because the value goes into
  a style sheet.

**One style element paints all the edits.** `src/look-edits.ts` writes a `<style
id="look-edits">` with one block per edited slot and skin:

```css
:root[data-theme="lilac"] { --canvas: #f3eefc; --title: #2a1c4a; … }
:root[data-skin="press"]  { --panel-radius: 6px; --fs-scale: 1.1; … }
```

- `:root[data-theme=…]` wins over the `[data-theme=…]` blocks in themes.css by specificity, not
  by source order. The order of the style tags in dev and in the bundle does not matter.
- **A theme switch needs no extra code.** The browser picks the block for the new
  `data-theme`, inside the existing appearance transition.
- An edit rewrites the element once. The card shows the change on the next frame.

**The pre-paints.** `index.html` and `tray.html` already read `deets.settings` to set
`data-theme` and `data-skin`. They also write the same `<style id="look-edits">` from
`themeEdits` and `skinEdits` before the first paint, so no frame shows the built-in colors. The
CSS text is made by one small pure function that is also inlined in the two pre-paints, with a
comment that names the three copies (the same rule as the RETIRED maps in look-ids.ts).

**The tray panel** repaints when the edits change: `publishAppearance` (np-bus) also sends a
"look edits changed" message, and tray.ts rewrites its own style element.

**The extension and DeetsSolutions** keep the built-in colors in this version. They only get
the id.

## 6. The Skinz card

> **Part:** designed · 2026-09-27

It follows Rulez (RULEZ.md §1.1): it is in the card picker only in Max. Opening it grows it to
Fill. An **X** in place of Back closes it and returns the card it replaced. Leaving Max puts the
replaced card back, and card memory brings Skinz back in Max.

**Two sections, Theme and Skin**, as movable rows (MOVABLE-ROWS.md).

- **Theme:** a row of 6 slot tiles. Each tile shows the slot's canvas, title and accent. The
  tile of the theme in use is marked. Click a tile to edit that slot. Editing a slot that is
  not in use shows it in the card as a preview panel, and does not change the app's theme.
  - The slot's Light / Dark switch (§8), a panel chip at the top of the slot.
  - One row per role (§3): the card word, a swatch, the hex value, and a reset dot when the
    role has an edit.
  - **The contrast line** under Text, Dim text and Headings: the WCAG ratio against Background
    and Menus, for example "4.8 : 1". Under 4.5 : 1 (3 : 1 for Headings) it shows a warning
    in the slot's `--stop` color. It never blocks the value.
  - The slot's menu (glyph and right-click): Rename · Use this theme · Reset · Copy from… (the
    built-in values of another slot).
- **Skin:** the controls of §4 for the skin in use, with a Reset in the section menu.

**The contrast math moves to a pure file.** album-color.ts keeps `luminance` and `contrast` as
private functions. They move to `src/color-math.ts`, album-color.ts imports them, and
`tests/color-math.test.ts` covers them.

**The theme name.** A renamed slot shows your name everywhere a theme name shows: the menu's
theme flyout, the quick panel, Compass, the look schedule, the Rulez words, and the Settings
rows. Rules store the id, so a rename never breaks a rule.

## 7. The build checklist (CLAUDE.md › Working style)

- **Motion:** the slot tiles and role rows enter with `enterRows`. A menu is the context-menu
  primitive.
- **Tokens:** the card's own geometry is `--skinz-*` alias tokens in skin.css. It names its
  control families: slot tiles are **icon squares**, role rows are **menu rows**, the swatch is
  a **field**.
- **Hints:** every `title` goes into the ONBOARDING.md ledger. The slot tile and the role row
  are new row shapes in its SHAPES table.
- **Toasts:** Reset has an undo toast (a row in TOASTS.md §5).
- **Settings keys:** `themeEdits` and `skinEdits` get a spec in `agent-settings.ts` (the Ask
  gate, as other look changes) and a line in AGENT.md.
- **New badge:** a `NEW_MARKS` line for the Skinz card.
- **Log lines:** `diag.log` each edit, rename and reset (`skinz:edit`, `skinz:reset`).
- **Scrollbars:** the card's list gets `app-scroll`.
- **Telemetry:** the preview panel sets `dataset.frames`.
- **Compass:** the card is automatic. Each slot name answers as a place ("edit Lilac").
- **Rules:** nothing new; rules pick the slot through `theme`.

## 8. The second forks (his calls, 2026-09-27)

| Fork | Choice |
|---|---|
| Light or dark per slot | **A Light / Dark switch on each slot.** It sets the slot's `color-scheme`, which drives the `light-dark()` roles (the New badge, the Apple Music mark, the rule chip dots) and `--traffic-glyph`. The switch starts at the built-in slot's scheme. |
| The color picker | **Our own picker in the card:** a hue strip, a square and a hex field, in the skin's control families. Not `<input type="color">` (it opens the Windows color dialog, which does not follow the skin). |
| Skinz outside Max | **Do what Rulez does.** `maxOnly: true` on the card def (cards.ts), so layout.ts gives it the same picker filter, the open at Fill, the X, and card memory. Compass lists it the same way it lists Rulez. |
| Share a slot as a file | **Not in this build.** Sharing and export are one design for rules and looks together, done later. |

The switch adds one field to a slot's edit: `scheme?: "light" | "dark"` in `themeEdits` (§5).
With no value, the slot keeps the built-in scheme. The painted block carries
`color-scheme: light | dark`, and `--traffic-glyph` takes the built-in value of a slot with the
same scheme.

## 9. Build order

1. `color-math.ts` and its test; album-color.ts imports it.
2. The store keys, the validation, the agent spec.
3. `look-edits.ts`, the scale tokens in skin.css, `npm run tokens`.
4. The pre-paints in `index.html` and `tray.html`, and the tray repaint.
5. The Skinz card, with its own color picker (a hue strip, a square, a hex field).
6. The theme name in the flyout, the quick panel, Compass, the look schedule and Rulez.
7. The docs: this doc's as-built section, SETTINGS-INVENTORY, ONBOARDING, TOASTS, AGENT.

## 10. Desk test

> **Part:** designed · 2026-09-27. Written at build time.
