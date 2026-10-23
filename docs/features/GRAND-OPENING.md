---
status: project
desk_test: passed 2026-10-23
sources: [src/onboarding.ts, src/boot-cover.ts, src/onboarding-welcome.ts, src/onboarding-looks.ts, src/onboarding-fashion.ts, src/onboarding-preview.ts, src/onboarding-nitpicks.ts, src/onboarding-letter.ts, src/ocean.ts, src/metal.ts, src/vinyl.ts, src/album-color.ts, src/styles/onboarding.css, src/main.ts, src/compass.ts, src/styles/skin.css, src/pet.ts, index.html]
updated: 2026-10-23
---
# Grand opening — the startup screen

> **A project, opened 2026-10-22 on the branch `grand-opening`.** The owner narrates and designs
> the screen piece by piece. Every fork is his. Built: the frame (§1), the nav bar and Settings (§2), page 1 (§3), pages 2 and 3 and the motion (§4), the welcome on page 1 (§5), Midi stacking and the Happy skin (§6), page 2's layout picks (§7), page 3's title (§8).

Terms: the **card** is the one large panel that covers every other card. The **launch cover**
is the color the window shows until the cards rise (boot-cover.ts). The **walk** is the
first-run walk with Deets and Happy (walk.ts, ONBOARDING.md §4).

## 1. The frame

> **Part:** built · 2026-10-22

- One `.panel` over the whole bento, on the bento's own edges inside `.app-body`. It wears each
  skin's card material. The title bar stays above it and works.
- An × in the top right corner (the card header's icon square, as on Rulez). A click or Escape
  closes the card.
- It opens after the launch cover on a brand-new install (`isFreshInstall()` in
  settings-store.ts), until it is closed once. The answer is saved as `openingPending`: the
  first page to load the store at launch writes it, and the tray panel can be that page. Before
  2026-10-23 the main window read only its own launch's answer, so when the tray page loaded
  first the card stayed shut and the walk ran alone. The trigger the owner will describe later
  replaces or joins this one.
- The walk waits until the card closes.
- `__onboarding.open()` in DevTools opens it at any time. `npm run dev:fresh` is a stranger.
- Log lines: `onboarding:open`, `onboarding:close`.

What Claude decided inside his ask, to review: no motion on open or close yet (his call); the
walk waits for it. Since 2026-10-23 a stranger who quits with the card open sees it again on the
next launch (the saved `openingPending`, the same rule as the walk's step); before, they did not.

**Desk test:** `__onboarding.open()` in DevTools on each surface and skin. The card covers the
cards and not the title bar; the × sits top right; the × and Escape close it.

## 2. The nav bar and the Settings page

> **Part:** built · 2026-10-22

- The Compass (Ctrl+Space) has a row **Onboarding** (also "welcome", "start screen") that opens
  the card.
- A nav bar on the left, 10 % of the card's width, with a line on its right edge. It holds one
  square button: the title bar's cog. Its hint: "Shows all of Settings".
- The area to the right (the **pane**) holds the whole Settings card: its header, its search
  and every section. The card opens on it, and the cog shows as pressed.
- The pane is the Settings card itself (`settingsCard.mount`), so a change there is the same
  change as in a Settings slot. It is torn down when the card closes.
- Escape in the Settings search field clears the field first; it does not close the card.

What Claude decided inside his ask, to review: the cog is as wide as the bar (a square that
grows with the window); the pressed cog uses the picked fill of the quick panel's icons; the
pane keeps a strip clear on its right so the Settings search button is never under the ×.

§3 changed the width (5 %), the cog's place (the foot of the bar) and the page the card opens on.

**Desk test:** Ctrl+Space › Onboarding opens the card in Midi and Max. Click the cog: it is pressed and
Settings fills the pane; a toggle there changes the same setting as the Settings card; its
search finds a row; Escape in the search field does not close the card.

## 3. Page 1 and the narrower bar

> **Part:** built · 2026-10-22

- The nav bar is half as wide: 5 % of the card. Its buttons shrink with it.
- The cog moved to the foot of the bar.
- The first button at the top of the bar is a "1" (in the card title's type) until the owner
  draws its icon. Its hint: "Shows page 1". It opens page 1, which is blank for now.
- The card opens on page 1, with the "1" pressed.

What Claude decided inside his ask, to review: the card opens on page 1 (the first button), not
on Settings.

**Desk test:** open the card: the "1" is pressed and the pane is blank; the cog sits at the
foot of the bar; the cog shows Settings and the "1" brings the blank page back.

## 4. Pages 2 and 3, and the motion

> **Part:** built · 2026-10-22

- Two more buttons under the "1": a "2" and a "3", the same way (hints "Shows page 2", "Shows
  page 3"). Both pages are blank for now. The order from the top is 1, 2, 3, then the cog at
  the foot.
- **The mark glides.** The pressed look (the picked fill and the title-colored edge) is one box,
  the **mark**, under the buttons. A press moves the mark along the bar to the button pressed,
  over `--nav-dur` on `--nav-ease` (the in-card nav motion). The open and a window resize place
  it with no glide.
- **The page slides the same way.** A button lower in the bar brings its page up from below,
  and the old page leaves upward; a button higher up does the reverse. Same duration and ease
  as the mark, so they move together. A skin whose card pages fade (`--nav-off-opacity: 0`:
  Ocean, Glass, Cyber) fades them on the way too. The two positions are the skin tokens
  `--ob-page-above` / `--ob-page-below`.
- A press mid-slide: the page still coming in leaves from where it is; a page still leaving
  goes at once. Reduced motion: no glide, no slide.
- `[perf] frames onboarding-page` times each slide.

What Claude decided inside his ask, to review: the buttons in the bar lost their own fill (the
border stays) so the mark shows through them the whole way; with the fill kept, the mark would
hide under each button it passes. The page slide is a straight slide in every skin: a skin's
own drill shape (Ocean's sink, Cyber's skew) is not carried, because those are drawn for a
sideways move.

**Desk test:** open the card. Press 3: the mark glides down from 1 to 3 and page 3 comes up from
below. Press the cog: the mark crosses the empty part of the bar and Settings comes up. Press 1:
everything moves up. Press 1, 3, 1 fast: no gap, no stuck page. Resize the window: the mark
stays on the pressed button. Settings › Motion › Reduce motion: the moves are instant.

## 5. Page 1: the welcome

> **Part:** built · 2026-10-22 · `src/onboarding-welcome.ts`

His words, as he gave them:

- Title **Hi**; under it: *Welcome to DeetsMusic, let's get you set up and get the music bumpin*.
- Three columns under the title, split by vertical lines:
  1. **Apple Music** — the Apple Music button from the DeetsMusic menu › Account, then: *Music in
     DeetsMusic is streamed straight through Apple Music. Your library, playlists, and radios
     carry over while your plays in DeetsMusic go to Apple towards your annual Replays.*
  2. **Last.FM** — the Last.fm button from the same menu, then: *Last.FM is one of the OGs of
     replays and recommendations. Log in to scrobble (ie log your plays) if you want a more
     granular ability to look back on listening habits. Last.FM is also great at showing related
     artists and putting you onto the next hit.*
  3. (still being worked out, his note) — the Discord toggle, the MCP setup, the AirPlay
     speakers.

How it is built:

- **The account buttons are live copies.** Each one copies the title menu's own block (the
  button, its ✓ / ✗ sigil, the status line under it) and copies it again on every change. A
  click on the copy clicks the original, so main.ts and lastfm.ts stay the only code that signs
  in. A link in the status line (the local sign-in fallback, the Last.fm profile name) clicks
  the original link.
- **Column 3 is Settings' own rows** (`mountSettingsParts`, as the quick panel draws them):
  *Share activity on Discord* under the heading **Discord**, and *Set up the DeetsMusic MCP*
  with its list of AI apps under the heading **AI apps**. Both groups start open; a fold here
  is kept apart from the quick panel's.
- **AirPlay speakers:** the speakers the app knows (the last scan, the last one used), one row
  each; a click plays on that speaker, as the Play on panel and the Compass do. The
  **Look for speakers** button scans the local network. The page never scans on its own.
- "Hi" is the card title's face at `--ob-hi-size` (2.4 × the card title). The welcome line is
  body type at the card title's size, in the subtext color. The column bodies are subtext.

What Claude decided inside his ask, to review: the third column has no title of its own (its
groups are headed **Discord**, **AI apps** and **AirPlay speakers**); the Discord row is *Share
activity on Discord* (the Rich Presence switch); a speaker row plays on that speaker at once;
no scan until the button is pressed (a scan can raise the Windows network prompt on a fresh
PC); the "Hi" size.

**Desk test:** open the card on page 1 in Max and Midi. The Apple Music copy shows the same
state as the title menu's; sign out from the copy, and the title menu's button changes too.
Connect Last.fm from the copy; the browser opens; the status line follows. Turn *Share
activity on Discord* on here; Settings › Sharing shows it on. Press Connect for an AI app.
Press Look for speakers: the button says "Looking for speakers…", then the speakers list.

## 6. Midi stacking, the Last.FM aside, and the Happy skin

> **Part:** built · 2026-10-22

- **Midi (and Mini):** page 1's three columns stack, Apple Music on top, then Last.FM, then the
  rest, split by horizontal lines in place of the vertical ones.
- **Last.FM** has a second paragraph, his words: *(I created a Last.FM account developing this
  after seeing all the subreddit requests and... woah. Highly recommend, its quite cool if you
  aren't on Last.FM yet)*
- **The title bar's menus over the card (a fix).** A scene skin (Happy) makes the title bar a
  z 3 layer; the card was z 3 too and later in the page, so it covered the DeetsMusic menu. The
  card is z 2 now (last in `.app-body`, so still over the cards and the scene's front layer).
- **Only the canvas behind the card.** `--ob-cards-behind` (skin token, `visible`) is
  `hidden` in Happy: while the card is open the cards and the clouds on their edges are hidden,
  so the see-through card shows the sky and grass, as Glass shows its glow.
- **Deets and Happy in front, on the right.** The floor the pair stand on is its own layer now
  (`.scene--actors`, index.html), over the card while it is open (`data-onboarding` on the
  root). When the card opens they run across the grass to the bottom-right corner (Deets in his
  walk, `--friend-walk`, at a run's pace; Happy in his run, with the ball if he has it); when it
  closes they run back. No fetch while they are on the right. Happy away at a cover comes back
  to whichever side they are on. The page under them gets end padding, as a card does.

What Claude decided inside his ask, to review: Mini stacks too (you named Midi; three columns
do not fit Mini either); the clouds that sit on the cards' edges hide with the cards; Deets
uses his first-run walk strip for the run (copied into the skin's folder, and `npm run
happy:art` keeps it there); the pair are placed at once under reduced motion.

**Desk test:** Happy skin, Max. Open the DeetsMusic menu with the card open: the menu is over
the card. Open the card: the cards behind go, the sky shows; Deets and Happy run right and stand
in front of the card. Close it: they run back left. Open and close fast: they turn and go back,
never two of each. Midi: page 1's columns stack with lines between them.

## 7. Page 2: the layout

> **Part:** built · 2026-10-22 · `src/onboarding-looks.ts`; the place API in `layout.ts`
> (SURFACES-AND-CARDS.md § A card in a chosen place)

His words: title **Layout-Maxxing Time** (Looks-Maxxing until round 3); under it: *Pick out how you'd like DeetsMusic to be
laid out for ya*. The same three columns as page 1 (stacked in Midi and Mini).

1. **Size: the three surfaces.** Mini, Midi and Max, each drawn as a small window at the shape
   of its open size (Settings › Window), with a box where each card goes: Now Playing (with its
   cover) and the cards; Max adds the Queue under Now Playing. Max's drawing follows the layout
   picked in column 2. A pick runs the title menu's Surface pick step for step: `applySurface`
   (Mini opens on its cards) and `tray_pin_main` (a tray-popped window stays). The agent's
   `settings set surface` runs the same two calls. The pressed pick is the surface on screen.
2. **Layout** (his name, 2026-10-22) follows the size picked in column 1. Max: 4 cards,
   2 columns, 2 rows, 1 card, drawn at Max's shape; a pick sets `maxCards` with `setSetting`,
   as Settings › Window › Layout for Max and `settings set maxCards` do. Mini and Midi have one
   layout each (1 card, 2 cards), shown pressed, with no choice. Each card box carries its
   place's number (1 = top left).
3. **Cards**, three columns:
   - the card's name and its line (Settings › Cards' own words);
   - **Show**: its On / Off switch, in a column of its own on a band of the hover fill. Off takes
     the card out of the card picker (`hiddenCards`); the last three stay on (the lock's hint
     says so). The same setter and the same three-card check as `settings set hiddenCards.<card>`;
   - **Start with** (his calls, 2026-10-22): the place the card opens in, in the size and the
     layout picked above, so the count follows columns 1 and 2 (Mini 1, Midi 2, Max 4 / 2 / 1).
     The pill shows the number or "—"; a click opens a menu of the places (Place 1 … Place N,
     each with the card there now under it, a tick on this card's place). A pick moves the card
     to that row and the cards from there down move a place down (round 3; round 1 swapped the
     two). A card that is Off, or Rulez outside Max, cannot be picked (its hint says why). The
     list calls `setStartCards` (layout.ts): on screen the layout's own `setAll`, off screen that
     layout's stored map. There was no CLI route for a place to reuse: `deetsmusic go` summons
     into the least-recently-touched slot.

The drawings' boxes take a share of the skin's card corner (`--ob-thumb-radius`), so Press draws
square boxes and Happy round ones; `--ob-thumb-h` sets their height.

**Round 2 (his test, 2026-10-22):**

- **Only 3 of Max's 4 numbers showed (a fix).** A place can hold Settings (and the Queue in Midi
  and Mini), but the list had only the nine cards Settings › Cards lists, so the number of the
  place holding Settings had no row. The list now ends with **Queue** ("What plays next") and
  **Settings** ("Every setting, and the Tips"). Their Show switch is On and does not change
  ("Always in the card picker"). In Max the Queue's Start with is greyed: Max keeps the Queue
  beside Now Playing.
- **The covers sit where each surface puts them.** Midi: Now Playing is one row across the
  window, about a quarter of its height, the square cover on the left as tall as the card, the
  text beside it. Mini: Now Playing is a little under half the window (its buttons stack), the
  cover at its small size in the top-left corner. Max: the stage is a column of its own, a third
  of the width: Now Playing as tall as its square cover (which fills the card's width) and the
  text under it, the Queue under that; the cards share the other two thirds, their rows apart
  from the stage's. Each Now Playing box draws two short text lines.
- **The title's word follows the size:** Maxxing, Midiing, Miniing. A size change fades the old
  word out and the new one in (1.5 × `--nav-dur`, half each); reduced motion changes it at once.

**Round 3 (his asks, 2026-10-22):**

- **No Queue row in Max:** Max always shows the Queue beside Now Playing, so the row says nothing.
- **The list runs in place order, top down.** The cards in places 1..N are the top N rows, in
  place order; the rest follow in Settings › Cards' order (then Queue, Settings). A dashed line
  under row N marks the end of the opening set. The defaults already ran top down (his calls of
  2026-09-18 and 2026-10-11): Home in a 1-card layout; Home and Library in 2; Home, Library,
  Playlists and Search in 4.
- **A move shifts the rest down.** Start with › Place k moves the card to row k; the cards from
  row k down move a row (and a place) down, and the card pushed past N leaves the set. Example,
  Max 4 cards: Search to Place 1 gives Search, Home, Library, Playlists.
- **Drag a row** by its name (the row-drag primitive, `measure` on; the insertion line shows the
  drop). A drop in the top N gives the places to the first N cards that can hold one, in the
  new order. The switches and the Start with pill keep their clicks. A card that cannot hold a
  place (Off, Rulez outside Max) does not drag.
- **The rows slide** to their new places after any change (a move, a drag, a switch, a size):
  each row starts where it was and moves over `--nav-dur` on `--nav-ease`. Reduced motion: no
  slide.
- **Title:** Layout-Maxxing Time (Layout-Midiing, Layout-Miniing).

What Claude decided in round 3, to review: the dashed line under the opening set; the rows below
the set keep Settings › Cards' order (their order is not stored, so a card dragged within them
goes back to its own row); a set change in the layout on screen remounts only the slots that
change, with the swap motion's rise-in.

His calls (2026-10-22): the count of places follows the size and the layout; numbered places,
with the numbers in the Layout drawings; Rewind stays Off on a new install (the switches show the
real setting).

What Claude decided inside his ask, to review: the titles **Size** and **Cards**, and the column
headings **Show** and **Start with** (Start with is his word); a surface pick resizes the window
at once, with the card still open; the place menu has no "—" row (every place must hold a card,
so a card leaves a place only when another takes it); Mini's and Midi's one layout read "1 card"
and "2 cards".

**Desk test:** open page 2 in Max. Press Midi: the window becomes Midi and Midi is pressed; the
columns stack. Press Max. Press 2 rows: Max's drawing in column 1 and the cards behind the card
change to two rows. Turn History Off: History leaves the card picker; turn cards Off until
three are left: the last three do not turn off. Press, Happy, Metal: the drawings' corners follow
the skin. Start with, in Max 4 cards: give Search Place 1: the rows slide to Search, Home,
Library, Playlists, and the cards behind follow. Drag Radio's name to the top: Radio takes place 1
and Playlists leaves the set. No Queue row in Max; a Queue row in Midi. Pick 1 card, then Midi: the
Start with counts become 1 and then 2, and the Layout column shows one pressed drawing. Turn a card
in a place Off: another card fills that place and its pill reads "—". Rulez in Midi: the pill is
greyed with the hint "Max only".

**Round 4 (his test, 2026-10-22): 1 card opened with Library, not Home.** Two causes, read from
the dev log. (1) A Layout pick on this page ran Max's "keep the Settings card" rule
(MAX-CARDS.md §9, fork 3): the Settings card in a slot behind this page counted as on screen, so Max
kept it in the new layout's last place, which in 1 card is place 1 (`keepSettings: true` on
every pick). The rule is for a pick made IN the Settings card; while this page is open it no
longer runs (layout.ts). (2) Each Max layout keeps its own cards (his call, 2026-10-11), and the
1-card layout had been given Library from this page earlier. His call: **one order on this
page** — a Size or Layout picked here opens with the top rows of the list as it stands (4 cards
Home, Library, Playlists, Search → 1 card gives Home; → Midi gives Home, Library). It is written
to the new layout before the switch, so the layout mounts with them. Everywhere else (Settings,
the card pickers) each layout still keeps its own cards.

## 8. Page 3: Fashion

> **Part:** built (columns 1 and 2) · 2026-10-22 · `src/onboarding-fashion.ts`

His words: title **Fashion**; under it: *What's your music listening vibe?* Three columns, as
pages 1 and 2:

1. **Skin:** one tile per skin in the title menu's Skin list (Press, Ocean, Glass, Cyber, Metal,
   Happy; Vanilla is not offered there).
2. **Theme:** one tile per theme in the title menu's Theme list.
3. **The preview** — the app with the player at full size. Not built: to be discussed with him
   (a bigger piece). The column is there, empty.

Each tile is drawn **in its own look**: it carries `data-skin` and `data-theme`, and the skin and
theme blocks are attribute selectors, so the small card in it takes that look's real fill, edge,
corners, shadow and title face ("Aa"), on that skin's canvas. A skin tile wears the theme on
screen; a theme tile wears the skin on screen, so each reads as "this one, with mine". The
title menu's own items do the same. Names and hints come from the title menu's buttons. A pick
is `pickLook` (look.ts), the title menu's own call: your value, through the look's crossfade.
The pressed tiles follow the look on screen (a rule's or the look schedule's included).

What Claude decided inside his ask, to review: "Fashion" stays the title and his new line is the
subtitle; the column titles **Skin** and **Theme**; the tile's drawing (canvas, card, cover, "Aa",
a line); the tile size (`--ob-look-w` / `--ob-look-h`). Not carried in a tile: a skin's moving
layers (Happy's sky and grass, Ocean's swell, Cyber's lightning), which live on the page, not on
a card.

**Desk test:** open page 3. The tiles look like their skins (Press square with its print shadow,
Happy round and soft, Metal brushed). Press Glass: the app crossfades to Glass and the theme tiles
redraw in Glass. Press Moonlight: the skin tiles redraw in Moonlight. The look schedule on: the
pressed tiles follow it.

### 8a. Only the canvas behind the card, in every skin (round 5, 2026-10-22)

> **Part:** built · 2026-10-22

His test: fast theme picks on page 3 in Ocean and Cyber sometimes brought the album cover up over
the card. The cause: a theme fade (a View Transition, appearance.ts) names the record
(`.vinyl__spin`; in Metal the cover box and the song's words) so it keeps turning through the
fade, and a named element is drawn above the whole page — over this card too. Two changes:

- `--ob-cards-behind` is `hidden` in every skin (was Happy only): the card sits on the canvas
  alone, as Glass and Happy showed it. A skin or a mod may set `visible`.
- While the card is open, a theme fade names nothing (styles.css, beside the theme-fade rules).

**Desk test:** Ocean, then Cyber, then Metal: on page 3 click theme tiles as fast as you can for
ten seconds. The cover never shows over the card; no card shows behind it.

### 8b. The preview (column 3)

His ask (2026-10-22): a copy of just the player card, in a smaller box, with "Time Bomb" by The
Chainsmokers playing, showing what each skin does best: Press's turning record, Ocean's waves in
the album's neon purple, Glass's cover on the canvas, Metal's cover flow.

- **A. A preview build in an iframe (Claude's pick).** The web demo's method (WEB-DEMO.md §9):
  the real `index.html` and `src/`, with the demo's shim for Tauri and its fake MusicKit, built
  once more as a "preview" bundle that ships inside the app, opened at Mini's Player view (Now
  Playing alone, with the page's moving layers), scaled into the column. The page sends the
  skin and theme by `postMessage`; the preview forces the showcase settings (Press record on,
  Glass canvas = cover, Metal peek on). It is the real code, so every skin's motion is there.
  Costs: a second copy of the app runs while page 3 shows (memory, GPU), so it starts on page
  3 and stops when the page leaves; its storage must not share the app's `deets.*` keys (same
  origin); the CSP needs `frame-src` for it; the bundle grows by the demo's size.
- **B. A second Now Playing card in the page.** It reads the live player, so it would show the
  user's song, and vinyl.ts, metal.ts and the album light are single instances keyed on the
  page; the moving layers live on `.app-body`, not on the card. Much plumbing, risk to the real
  card.
- **C. Recorded clips.** The shots runner records a loop per look from the demo; the column
  plays the one for the current pick. Light and exact, but one clip per skin × theme (36), a
  larger bundle, and they go stale when a skin changes.

Forks for him: the approach; whether the preview changes songs every few seconds (Metal's cover
flow and Happy's push only show on a change); whether it shows the showcase settings or the
user's own.

**His pick (2026-10-22): D, a fake player.** Now Playing's own markup and classes in a box, no
second app, no live player: Coffee (Chioma) ← **Time Bomb** (The Chainsmokers) → serena joy
(Olivia Rodrigo). ⏮ / ⏭ step it, and it also steps by itself every few seconds while untouched.
The three covers come from one catalog look-up (his call: not saved links; the terms read is
the API path), cached. Happy pushes the preview's cover in the Happy skin.

What the real code gives the preview, and what it needs (read 2026-10-22):

- **The look:** free. A pick on page 3 applies for real, so the preview's skin and theme are
  the page's; the card's material, type and colors are the real ones.
- **The cover change:** free. `mountVinyl(box)` is made per box (the tray mounts a second), and
  it reads `--cover-swap` and its tokens from the box. The caller passes `back`, so the shared
  turn guess is not used.
- **The stage layout:** one line in styles.css — the preview panel joins the stage rule's
  `:is([data-slot="np"], .np-still)` — and a wrapper with `data-surface="max"`. The Metal peek
  rules are compound on the root (`[data-hook-material="metal"][data-metal-peek]:is([data-surface=…])`),
  so the wrapper mirrors those two attributes too.
- **Happy:** free. pet.ts pushes any `.np__art` with `--cover-swap: pet` inside a `.panel`; the
  card is one.
- **Metal's side covers:** a change. `peekSync()` fills every `.np__art` on the page from the real
  queue (`getHistory` / `getUpcoming`) and waits until the box takes the real song's id; its
  timers and `seenSong` are single. The per-box part becomes `syncBox(box, source)`: the queue's
  boxes keep today's source, and the preview passes its own (its previous and next covers and
  its song id). The real path must not change, so Metal's stress cases (DESK-TESTS.md §6.6) run
  again after it.
- **The Press record:** vinyl.ts turns it when the user's `pressVinyl` is `spin`, which is the
  default since his call of 2026-10-11. VINYL.md §10 still said "Off" (stale, corrected
  2026-10-22). So a new user's preview turns the record with no change; the preview follows the
  user's own settings (his call, 2026-10-22: this page is for people who have never opened
  Settings, so the defaults are what they see).
- **One code path (his call, 2026-10-22):** the preview uses metal.ts's own drum, not a copy, and
  only two callers ever reach the per-box path: the real Now Playing card (the queue) and this
  preview. Nothing else may enter it.
- **Ocean's waves, Glass's canvas cover:** these are layers of the page, behind the card, and
  they follow the real song. The preview draws its own small versions in the box from the
  preview song's palette (`lookupPalette`).
- **Apple calls:** the first open: one catalog read for the three songs, and a palette read per
  cover on a cache miss (each cached a month). None after.

**As built (2026-10-22)** · `src/onboarding-preview.ts`, `src/onboarding-fashion.ts` column 3
("Preview"):

- The box (`.onboarding__stagebox`, `data-surface="max"`) copies the root's look attributes
  (`data-skin`, `data-theme`, `data-hook-*`, `data-metal-*`, `data-press-*`, `data-glass-*`,
  `data-ocean-*`, `data-happy-*`, `data-fancy-*`, `data-cyber-*`, `data-bg-motion`) and follows
  them while open. In it, a `.panel.onboarding__np` holds Now Playing's own `TEMPLATE`
  (now-playing-card.ts, exported) with its ids renamed (`np-` → `obnp-`), so the real card's
  ids and masks stay unique. styles.css adds `.onboarding__np` to the stage rule.
- Its songs: Coffee · **Time Bomb** · serena joy (`SONGS`, his words; catalog ids 1564322068,
  1637995424, 6803283192, found 2026-10-22 with `deetsmusic search`). Starts on Time Bomb,
  playing. ⏮ / ⏭ step (wrapping); ▶ pauses; untouched for 7 s it steps to the next song by itself
  (not under reduced motion); the clock is a 1 s timer and the scrubber follows it. The rest of the
  card's controls are inert; the volume row and the left cluster (shuffle, repeat, search) are
  hidden (his ask, 2026-10-22), so Previous, Play and Next sit centered alone.
- The covers: `catalog_songs` (new Rust command, apple.rs: one `GET …/songs?ids=`, the songs go
  into the enrichment cache, so their palettes cost nothing more), kept a month under
  `deets.onboarding.preview`. **Signed out too (2026-10-23, his ask):** Apple's catalog needs only
  the developer token (the app's own, from the mint at launch), so the call drops the user token
  and its storefront look-up and reads the catalog of the page's locale region (`region`), then
  `us` once if that country has no storefront. Offline or no developer token: the words with the
  ♪ cover; the next open tries again.
  The demo answers `[]`; the rooms web port lists it as null on purpose.
- The record: `mountVinyl(art, glyph, { ownTurns: true })`. Metal's drum: `ownPeek` (metal.md §6.9).
  The album light: `watchAlbumColor(box, source)` — the function now takes a cover source; the
  player stays the default and only the player loads the next song early. Happy pushes the cover
  (pet.ts, unchanged).
- The page layers, drawn small in the box from the preview's own palette and cover, selected on
  the skin hooks (mods.md §10). **Ocean (round 3, his call): the real sea**, not a stand-in — the
  box holds the page sea's markup and ocean.ts paints it through `ownSea` (OCEAN.md §8): the same
  worker, bands, crests and neon (Album light 80), the glow from the deep in the preview cover's
  color, the card at the sunken cards' opacity (`--ocean-card-opacity`, 80). No heave, no ripples
  (they answer the real music and gestures). Round 2's CSS sea (with the cover under the water,
  a misreading of his ask) is gone. The others are stand-ins: the canvas cover (`--hook-wallpaper`,
  Glass) — the cover blurred by `--wallpaper-blur`; the scene (`--hook-scene`, Happy) — the day sky
  and the grass. Every other skin shows its own canvas. Reduced motion, *Animate backgrounds* off
  and a hidden window hold the swell.
- `--ob-preview-w` (260px) is the card's widest.

What Claude decided inside his calls, to review: the column title **Preview**; Time Bomb as the
first ID of the two Apple lists; 7 s for the auto-step; the step wraps (after serena joy comes
Coffee); the stand-in layers' drawing; Happy's sky is the day's whatever the hour.

**Desk test:** open page 3 signed in. The three covers load (one `catalog_songs` line in the log).
Press: the record turns; ⏭: the record swaps. Metal: the side covers show Coffee and serena joy; ⏮ /
⏭ turn the drum both ways; play a song in the real player meanwhile: its side covers stay its own.
Ocean: the swell is purple. Glass: Time Bomb's cover behind the card. Happy: Happy runs to the
preview cover and pushes it. Leave it untouched: it steps every 7 s. Reduced motion: no auto-step.
Then Metal's own stress cases (metal.md §6.7) on the real player.

## 9. Next, Let's Boogie, and the warm-up (2026-10-22)

> **Part:** built · 2026-10-22

- **The foot of each page** (his ask): at the bottom left, under the page (the pages slide in
  `.onboarding__pages`; the foot stays). *Next* on pages 1 to 3 shows the next page (the same
  slide as the nav bar); *Let's Boogie* on page 4 is the end button (page 3 until 2026-10-23). None on Settings. It wears
  the picked look (the nav mark's fill and title edge). Hints: "Shows the next page" · "Closes
  this page and opens DeetsMusic".
- **Let's Boogie** runs `revealApp` (boot-cover.ts): the launch's own cover fades in over the
  page (`data-boot="veil"`, `--cover-in-dur`), the card closes under it (the cards behind come
  back, Deets and Happy run home, the walk starts on a fresh install), the panels go to their
  rise start (`wait`), and the cover lifts with the cards rising in their stagger (`lift`), each
  skin's own entrance. *Animate look changes* off or reduced motion: it closes at once. The ×
  and Escape still close it plainly.
- **The warm-up** (his ask: ready the app while the user reads on). A sign-in that completes
  while the card is open (page 1's Apple Music button) runs `warmUp` (onboarding.ts): the
  playlists mirror sync (`applePlaylistsSync` → `notifyPlaylistsChanged`). **Since 2026-10-23
  every sign-in does this, from here or the title menu** (DATA-ARCHITECTURE.md §5d: the
  playlists and Radio answer `deets:signed-in` themselves), so `warmUp` only logs. The rest starts by
  itself on every sign-in: the library sync (track-store.ts `signInSync`), and the cards mounted
  behind the page rebuild as it lands (Home asks Apple for its shelves then). On threads (his
  question): every one of these is Rust work on its async pool, off the UI thread; the page only
  awaits answers, so a Web Worker would add nothing.
- **The preview's glow at the top** (his ask): its sea's Album light is 100 whatever the
  setting (`ownSea` sets `--ocean-light: 100` on its box and paints the neon at that level).

What Claude decided inside his asks, to review: the foot's look (the picked fill); Let's Boogie
replays the launch's reveal rather than a new motion; only the playlists sync is added to the
warm-up (the library and Home already start on a sign-in).

**Desk test:** a fresh install (`npm run dev:fresh`): sign in on page 1; the log shows
`onboarding:warm` and the library sync; Next to page 2, Next to page 3; Let's Boogie: the cover
fades in, the cards rise as at launch, the walk starts. With reduced motion: it closes at once.
Ocean on page 3: the preview's crests at full neon.

## 10. Page 4: Nitpicks (2026-10-23)

> **Part:** built · 2026-10-23

- His title and subtitle: **Nitpicks** · "Smaller settings, rules, and such to fine-tune
  DeetsMusic for ya". `src/onboarding-nitpicks.ts`, the same header as pages 2 and 3; a 4 on its
  nav button, between 3 and the cog. Page 3's foot is *Next* now; *Let's Boogie* moved here, then to page 5 the same day (§11).
- Three columns, as on page 1 (his ask). The rows are the Settings card's own
  (`mountSettingsParts`; each part has its own fold prefix `ob4-N`, so two parts from one section
  fold apart; every group open the first time):
  1. **Rules and schedules** (rules and the rows next to them): the whole Look schedule section
     (its day and night looks start as your own look, LOOK-SCHEDULE.md §1; *Offset
     Sunset/Sunrise* and *Manual pick lasts*, his names 2026-10-23); Playlists › the four web
     defaults (Web reach, Web size, Web prefers songs, Web genre chips filter) as *Playlist Web
     Defaults* (his name); Motion › If graphics fail (a built-in rule) as *Graphics*.
  2. **The app:** Updates › Get updates; About › Send usage counts as *Usage counts* (on by
     default, his call; the hint is his promise: anonymous, nothing about you or your Apple ID);
     Window › Start with Windows and Close to tray as *Startup*.
  3. **Worth a look** (his picks 2, 3, 4, 5 and 6 from Claude's list, WORKLOG 2026-10-23): Motion
     › Fancy scrubber; Sleep › Sleep every day; Playback › Skip on stations, Leave out of webs,
     Skip in queues as *Suggest Less*; Song of the Day; Playback › Show play counts from Last.FM
     and Notes from as *Song facts*.
- **Page 4 is the usage counts' telling** (USAGE-COUNTS.md §2 rule 10): its mount runs
  `markUsageTold`, and then the reports may be planned. **Since later the same day (his call):**
  closing the opening by any path runs it too (`closeOnboarding`), so a user who skips page 4
  sends with the switch on (USAGE-COUNTS.md §1, call 1).
- **Not in the web demo** (his call, 2026-10-23): the demo's shim writes `openingPending: false`
  before the app loads, and the store keeps a value already there, so a visitor gets the tour
  and not the opening (WEB-DEMO.md §16). `initOnboarding` reads the saved `openingPending`, not
  `isFreshInstall`, for that reason. The Compass's Onboarding row still opens it there.

What Claude decided inside his ask, **reviewed by him and kept (2026-10-23)**: the column titles
(*Rules and schedules*, *The app*, *Worth a look*) and the group labels (*Graphics*, *Usage
counts*, *Startup*, *Suggest Less*, *Song facts*); If graphics fail as the third rule-adjacent
row; the page counts as the telling once it is shown, not once a row is pressed. Deets's
`point_up.png` (ONBOARDING.md §4.0) was kept the same day.

**Desk test:** Next from page 3 slides page 4 in; its button says *Next*. Each row on page 4
changes the same value as its Settings row (open Settings from the nav bar's cog and compare).
The log shows `usage:told {"why":"grand opening page 4"}` once; a second open does not log it
again. Hover *Send usage counts*: the new hint.

## 11. Page 5: You're Ready (2026-10-23)

> **Part:** built · 2026-10-23

- His title and subtitle: **You're Ready** · "A Final Message". The body is his letter, word for
  word (`src/onboarding-letter.ts`), but for three changes he agreed to: the typo "connectiosn";
  his employer's name out ("a massive software company in a highly complex field like
  healthcare"); and the record-company line softened, to keep it light ("gave us a peek behind
  the curtain at how their algorithms and lists get made"). Later the same day: paragraph 2 is
  his rewrite, ending in a joke in `<s>` (struck through on purpose: "smth smth Marvel Rivals…");
  and a new paragraph after the Bandcamp line names the walls he hit (no remove from library, no
  playlist edits on Apple Music, no crossfade, no producer credits, no song matching for a
  Spotify friend; FAVORITES.md, PLAYLISTS.md, DESIGN.md, CREDITS.md, ideas/SpotifyRooms.md).
  Signed "Thanks, Deets".
- One column at a reading measure (`--ob-letter-measure`, an alias of the album notes'
  `--notes-measure`, 68ch), the body face at text size in the text color; the signature in the
  title face and color. The page scrolls as one when the window is short.
- A 5 on its nav button, between 4 and the cog. Page 4's foot is *Next*; *Let's Boogie* is here.

What Claude decided inside his ask, to review: the letter's type (text size and color, not the
smaller grey of page 1's paragraphs); the signature in the title face.

**Desk test:** Next from page 4 slides page 5 in; the nav bar shows five numbers and the cog;
the letter reads in one column and scrolls in Midi and Mini; *Let's Boogie* runs the reveal (§9).
