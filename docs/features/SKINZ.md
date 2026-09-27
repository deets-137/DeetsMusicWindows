---
status: designed
desk_test: none
sources: [src/styles/themes.css, src/styles/skin.css, src/look-ids.ts, src/theme.ts, src/skin.ts, src/look.ts, src/album-color.ts, src/ocean.ts, src/look-schedule.ts, src/compass.ts, src/settings-store.ts, index.html, tray.html]
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

**The first build is theme only (his call, 2026-09-27).** It edits the 12 roles of the 6 slots.
The skin controls (§4) are parked for a later build. §11 has the review decisions of the same
day.

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

**Menu edge and Card edge keep their alpha (§11).** `--border` and `--panel-border` are
`rgba()` values in every theme (Lilac: 16 % and 30 %). For these two roles you pick the hue
only: the picker shows the hue strip and the square, with no alpha. Skinz paints
`color-mix(in srgb, <your hex> <the slot's built-in alpha>, transparent)`, so an edge still
reads as an edge.

**Album color still sits above the theme.** With album-colored text on, the Now Playing card
uses the album's colors, as today (ALBUM-COLOR.md).

## 4. The skin: the controls

> **Part:** parked · 2026-09-27

**Not in the first build (his call, 2026-09-27).** When the skin build starts, it leaves out the
Card fill row, so Glass's Tint (locked by `GLASS_LOCKED` with Fancy Glass off) and Ocean's Card
opacity stay as they are. The other points to settle then are in §11.2.

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
- **Card fill is out (his call, 2026-09-27).** Glass's Tint and Ocean's Card opacity already
  set the fill, and Tint is locked at 65 with Fancy Glass off. The row stays in the table
  above as a record only.
- **A scale reads the skin's own value**, so it is written as `calc(<skin value> * <scale>)`.
  skin.css gets one base token per scaled group (for example `--fs-scale: 1`), and the sizes
  become `calc(… * var(--fs-scale))`. This is a skin.css change, so `npm run tokens` runs in the
  same commit.

## 5. Where the edits are stored and how they are painted

> **Part:** designed · 2026-09-27

**One store key** in `settings-store.ts` for the first build (theme only):

```ts
themeEdits: Partial<Record<ThemeName, { name?: string; scheme?: "light" | "dark"; roles: Partial<Record<RoleName, string>> }>>
```

The skin build adds `skinEdits: Partial<Record<SkinName, SkinEditValues>>` later (§4).

- The default is `{}`: no edits, so every install looks the same as today.
- **It is not a `RuleKey`.** A rule sets `theme` only (§1).
- A role value is a 6-digit hex color. The store refuses any other string, because the value
  goes into a style sheet. Menu edge and Card edge store a hex too; their alpha comes from the
  built-in slot at paint time (§3).

**One style element paints all the edits.** `src/look-edits.ts` writes a `<style
id="look-edits">` with one block per edited slot:

```css
:root[data-theme="lilac"] { color-scheme: dark; --canvas: #f3eefc; --title: #2a1c4a; … }
```

- `:root[data-theme=…]` (0,2,0) wins over the plain `[data-theme=…]` blocks in themes.css
  (0,1,0) by specificity, not by source order. The order of the style tags in dev and in the
  bundle does not matter. This holds because themes.css has no compound theme selector. A
  compound one added later (for example `[data-theme=…][data-skin=…]`) ties with the edit
  block and falls back to source order. **The skin build** must check this again: skin.css has
  compound blocks such as `[data-skin="glass"][data-glass-fancy="on"]` (0,2,0) and
  `:root[data-skin="ocean"][data-ocean-edges="sand"]` (0,3,0). It writes its blocks as
  `:root:root[data-skin=…]`, or adds a check that no compound block sets an edited token.
- **The "look edits changed" event.** Each rewrite sends one event. Code that reads a role in
  JS listens for it next to its `data-theme` observer, because an edit to the theme in use does
  not change the attribute:
  - `album-color.ts` (the NP text guard, [album-color.ts:180](../../src/album-color.ts)).
  - `ocean.ts` (the glow from the deep, [ocean.ts:376](../../src/ocean.ts)).
  - The tray (below).
  - The theme names (§6).
  - `mosaic.ts` reads `--surface-hover` when it makes a cover. An old cover keeps the old
    color. That is acceptable: a cover is made once.
- **A theme switch needs no extra code.** The browser picks the block for the new
  `data-theme`, inside the existing appearance transition.
- An edit rewrites the element once. The card shows the change on the next frame.

**The pre-paints.** `index.html` and `tray.html` already read `deets.settings` to set
`data-theme` and `data-skin`. They also write the same `<style id="look-edits">` from
`themeEdits` before the first paint, so no frame shows the built-in colors. The
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

**Two sections, Theme and Skin**, as movable rows (MOVABLE-ROWS.md). The first build has the
Theme section only. The Skin section joins in the skin build (§4).

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
- **Skin (parked, §4):** the controls of §4 for the skin in use, with a Reset in the section
  menu.

**The contrast math moves to a pure file.** album-color.ts keeps `luminance` and `contrast` as
private functions. They move to `src/color-math.ts`, album-color.ts imports them, and
`tests/color-math.test.ts` covers them.

**The theme name.** A renamed slot shows your name everywhere a theme name shows. Rules store
the id, so a rename never breaks a rule. The names are written in three places today (checked
2026-09-27). Every other surface reads one of them:

| Where the name is written | Who reads it |
|---|---|
| `THEME_OPTIONS` in `look-schedule.ts` | The look schedule's day and night menus in Settings, the look schedule status line, the Rulez card and its words (`rulez-logs.ts`), the agent specs (`agent-settings.ts`, `agent-rules.ts`) |
| The theme flyout buttons in `index.html` (text and hover hint) | `theme.ts`, `main.ts`, and Compass (it reads the button text) |
| `extension/options/options.html` | The extension only. It keeps the built-in names (§5). |

The quick panel shows no theme name. So the change is:
- `THEME_OPTIONS` becomes a function that puts the slot's `name` over the built-in label.
- `look-edits.ts` rewrites the flyout button text from that function at start and on "look
  edits changed" (§5). Compass follows the flyout with no change of its own.
- **The flyout hints describe the colors** ("Light. Purple and mint"). An edited slot gets a
  plain hint in their place ("Your edit of Lilac. Dark."), because the built-in words no longer
  match the colors.

## 7. The build checklist (CLAUDE.md › Working style)

- **Motion:** the slot tiles and role rows enter with `enterRows`. A menu is the context-menu
  primitive.
- **Tokens:** the card's own geometry is `--skinz-*` alias tokens in skin.css. It names its
  control families: slot tiles are **icon squares**, role rows are **menu rows**, the swatch is
  a **field**.
- **Hints:** every `title` goes into the ONBOARDING.md ledger. The slot tile and the role row
  are new row shapes in its SHAPES table.
- **Toasts:** Reset has an undo toast (a row in TOASTS.md §5).
- **Settings keys:** `themeEdits` (and `skinEdits` in the skin build) gets a spec in `agent-settings.ts` (the Ask
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

The first build (theme only):

1. `color-math.ts` and its test; album-color.ts imports it.
2. The `themeEdits` key, the validation, the agent spec.
3. `look-edits.ts`: the style element, the edge alpha mix (§3), the "look edits changed" event,
   and its listeners in album-color.ts and ocean.ts. No skin.css change, so no
   `npm run tokens`.
4. The pre-paints in `index.html` and `tray.html`, and the tray repaint.
5. The Skinz card, with its own color picker (a hue strip, a square, a hex field; hue and
   square only for Menu edge and Card edge).
6. The theme name: `THEME_OPTIONS` as a function, and the flyout text and hints (§6).
7. The docs: this doc's as-built section, SETTINGS-INVENTORY, ONBOARDING, TOASTS, AGENT.

The skin build, later: `skinEdits`, the scale tokens in skin.css with `npm run tokens`, the
selector check of §5, and the Skin section of the card.

## 10. Desk test

> **Part:** designed · 2026-09-27. Written at build time.

## 11. The review (2026-09-27)

A check of this doc against the code, on the day it was written.

### 11.1 His calls

| Question | Choice |
|---|---|
| What the first build covers | **Theme only.** The skin controls (§4) are parked. |
| Glass Tint and Ocean Card opacity against a Card fill row | **Leave out Fancy Glass and the card fill.** The skin build has no Card fill row (§4). |
| Menu edge and Card edge are `rgba()` | **You pick the hue.** The built-in alpha of the slot stays (§3). |
| Code that reads a role in JS does not see an edit to the theme in use | **One "look edits changed" event** (§5). |
| Where the theme names are written | Three places (§6). `THEME_OPTIONS` becomes a function; the flyout is rewritten from it. |

**Decided inside his calls (Claude, 2026-09-27), for him to see:**
- The edge paint is `color-mix(in srgb, <hex> <built-in alpha>, transparent)`, and the alpha is
  per slot.
- An edited slot's flyout hint becomes "Your edit of <built-in name>. Light | Dark." in place of
  the color words.
- The card has one section (Theme) until the skin build.

### 11.2 Open points

Not decided. Bring each one to him before the step that needs it.

For the first build:
- **Accent contrast.** The contrast line covers only text. `--go`, `--stop` and `--pause` carry
  the `--traffic-glyph` marks, and a picked row fills with `--title`. An accent near the glyph
  color hides the traffic-light marks, and no warning shows.
- **Undo for one role.** Only Reset has an undo toast. A role's reset dot goes back to the
  built-in value, not to the value before your last change.
- **The agent's write.** A write to `themeEdits` is the whole map, so an agent can replace
  edits it did not read. A route that changes one role of one slot is safer.

For the skin build:
- **Motion speed scales 2 of about 28 duration tokens** (`--dur-fast`, `--dur-med`). The others
  (`--swap-dur`, `--nav-dur`, `--grow-dur` …) stay the same, so 200 % looks like a broken
  control. Put all of them on the scale, or give the row a narrower name.
- **Text size misses the local size tokens.** About 150 font sizes use the three `--fs-*`
  tokens. About 15 local `--*-fs` tokens (the sleep dial, the room code, the Sound axis) do not
  scale. `var(--fs-body)` is used twice, and no `--fs-body` token exists.
- **Spacing:** 239 uses of `--space-*`, about 80 literal paddings, gaps and margins.
- **Test the extremes in Mini.** 125 % text with 150 % spacing in the 480 px Mini is where rows
  will cut off.
- **The selector check** of §5.
