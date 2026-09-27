---
status: built
desk_test: open
sources: [src/rulez-card.ts, src/rulez-words.ts, src/rules-app.ts, src/rules-playback.ts, src/rules.ts, src/rules-eval.ts, src/card-grow.ts, src/layout.ts, src/sound.ts, src/player.ts]
updated: 2026-09-27
---
# DeetsMusic — Rulez, the rules builder

**Rulez is the card where you make your own rules.** The engine that runs them is
[RULES.md](../architecture/RULES.md): the rule shape (§4), the facts (§5), the registry (§6), the
overlay (§7), a hand change (§8), the guards (§11) and the recipe for a feature that uses rules
(§19). This doc is the card: his forks (§1), the build record (§2), the next steps (§3–§4),
your own files in a rule (§5) and the sentence row (§6).
Designed and built 2026-09-27 on branch `rules-rulez`; §1–§2 were RULES.md §20–§21 until the
split the same day.

## 1. The design — his forks

> **Part:** designed · 2026-09-27 (his forks, this sitting). The build record is §2.

Rulez is a card where you make your own rules. It is the first card that shows only in Max.

### 1.1 His calls (2026-09-27)

| Fork | Choice |
|---|---|
| The columns | **Name · Desc · When · In · If · Do.** The When cell opens with **When…** or **While…**. A While row leaves In blank, its If cell holds the While condition, and its Do offers only "set" targets. |
| Built-in rules | Shown **locked** below your rules, each naming the Settings row that makes it. Only the ones that exist now. |
| The If cell | Chips joined by **and** / **or**, with parentheses, **any depth**: `(Genre is Jazz and Time is after 8:00 PM) or Genre is Rap`. |
| Max only | In the picker only in Max. Leaving Max puts the replaced card back; Rulez comes back in Max (card memory). |
| Open and close | Opening Rulez **grows it to Fill**. An **X** in place of Back closes it and returns the card it replaced. |
| The name | The card and the module are **Rulez** (`src/rulez-card.ts`). |
| Row extras | A small menu glyph on each row, and the same items on right-click. |
| Scope | The larger event set, no Rooms or Friends. *Play a playlist* and *Play a station* are in. |
| Sound | Your Sound settings, song loudness, and a **live bass / mid / treble balance** as facts. The balance runs only while a rule reads it, smoothed over 3 s, with a margin, checked at most every 2 s. Do adds *Set a band* and *Set the preamp*. True dynamic EQ (per-band compression in the DSP) is a separate idea, not a rule. |
| Cascades | Allowed, with the guards in §1.5. |
| Words | Active voice, as in §1.3. |

### 1.2 The row

A row reads as a sentence: **When** *the next song plays* · **In** *any card* · **If** *Genre is
Rap* · **Do** *Skip ahead*. Name and Desc are two new optional fields on a stored rule (`name`,
`desc`). The store is still `{ v: 1, rules: [] }`, so nothing migrates.

- **+** (top right, as on Playlists) opens a name field. Enter adds a row with that name, a
  When cell that asks for its event, and no Do yet. A row with no Do is **a draft**: it is
  saved, shown dimmed, and never runs (`on: false` until it is complete).
- Each cell is a button. It opens a menu of sections (Playback ›, Time ›, …) built on the
  context-menu primitive (`openContextMenuUnder`), so it is the **menu row** family.
- A value that needs input (a time, a number, a genre name) opens a field in the same menu.
  A genre, artist or album field suggests from your library as you type (no Apple call).
- **Order:** the first matching rule wins, so rows move: drag by the row, or *Move up* /
  *Move down* in the row menu.
- **The row menu** (glyph and right-click): Turn on / off · When I change it (While rows: the
  `onHand` choice) · Duplicate · Move up · Move down · Delete.
- **A locked row** (a built-in rule) has no cell buttons. Its menu has one item: *Open in
  Settings*, which opens that row (`requestSetting`).

### 1.3 The words

**When (a moment)**
- *Playback:* The next song plays · A song ends · The music pauses · The music resumes · You
  skip ahead · You go back · The queue runs out · A station plays
- *Time:* The clock reaches __
- *Window:* The app opens · The surface changes · You hide the app in the tray · You bring the
  app back · You open a card
- *Library:* You open an album · You open an artist · You open a Diary entry · You make a
  playlist · You press the cog
- *Sound:* The output changes

**While / If (a condition chip):** a fact, then *is · is not · is above · is below*.
- *Playback:* Genre · Artist · Album · Year · Explicit · The music is playing · Shuffle ·
  Repeat · Volume · Source (library, playlist, station, album)
- *Time:* Time · Day · Daylight
- *Sound:* Output · EQ preset · Each EQ band · Song loudness · Song bass · Song mids · Song treble
- *Window:* Surface · Card

**Do**
- *Playback:* Play · Pause · Skip ahead · Go back · Turn shuffle on / off · Set repeat to __ ·
  Set the volume to __ · Play a playlist · Play a station
- *Sound:* Use EQ preset __ · Set a band to __ dB · Set the preamp to __
- *Look:* Use theme __ · Use skin __
- *Window:* Grow this card · Open a card · Keep on top
- *Sharing:* Pause sharing
- *Sleep:* Start the sleep timer

**Look for more.** Before the build ends, search the code for more places a rule could
start from, most of all button presses: every gesture already writes a `ui:act` line
(LOGGING.md §The click trail). *You open a card* (the picker, a summon, the Compass) is the
first one, in this build.

### 1.4 Moment Do versus While Do

- In a **While** row, a "set" item is a state target: the value holds while the condition
  holds and goes back after (theme, skin, EQ preset, sharing, Keep on top, a band, the
  preamp, the volume).
- In a **When** row, the same item is a one-time change that writes **your** value, as a press
  would. Nothing goes back.
- The volume, a band and the preamp are **properties** (RULES.md §7b) in a While row: the engine lays
  the value and gives the old one back when the rule ends. A hand change of the volume while
  the rule holds wins: the rule stands aside until its condition ends and starts again.

### 1.5 Guards (cascades)

| Risk | Guard |
|---|---|
| Two While rules on one target | The first in the list wins, as today. |
| Two moment rules that fight (one pauses, one plays on pause) | A rule that fires **5 times in 10 s** turns off for the session. A notice names it. |
| A long chain | A chain stops after **8** rules in a row. A log line says so. |
| An Apple call | An `apple` action (*Play a playlist*, *Play a station*) **never runs from an event another rule caused**, at most **once per 30 s per rule**, never while `apple_calls.rs` backs off, and only when its playlist or station still exists. |
| Memory | No list per fire: a ring of the last 5 fire times per rule. The log is the diag ring. One timer for every fact. |
| A deep condition | Any depth for you; the validator stops at 16 levels (a hand-edited store cannot hang the check). |

**What "caused by a rule" means.** An event is rule-caused when it is emitted while an action
runs, or within 3 s after one (a skip's next song comes back async). The window is on the safe
side: it can call a hand press rule-caused, and the only effect then is that an Apple action
waits.

**Other Apple traffic a rule can make (his question, 2026-09-27).** Besides a playlist or a
station:
- *Skip ahead*, *Go back* and *Play* make MusicKit load a song (its licence and stream). This
  is normal playback traffic, not our API calls; the 5-in-10-s guard caps a runaway skip.
- *Open a card* mounts a card. Home, Search, Radio and the artist view read from the cache in
  `apple.rs` first; a cold card can make its usual first calls, once.
- Nothing else in the lists calls Apple: grows, looks, EQ, sharing, sleep and the volume are
  local.

### 1.6 The card

- `rulez-card.ts`, card id `rulez`, title **Rulez**. `poolFor()` offers it only in the Max
  composition, so a stored Midi layout never holds it.
- Opening it (the picker) grows it to Fill. The header has an **X** at the left where a drilled
  card has Back; it collapses the grow and puts back the card the slot had.
- The table: a header row, then your rules, then a divider and the locked rules. It scrolls
  (`app-scroll`). New rows enter with `enterRows`.
- A rule that is off, a draft, or turned off by the guard is dimmed, with a hover hint that
  says why.
- The agent's rules verb and the text form still wait (RULES.md §14; now §3, route 2).

### 1.7 Cancel events: a rule that stops the app (his call, 2026-09-27: both)

His question: with Playlists grown, can a rule keep it open when he presses the Queue card?
Two ways, both built:

- **A cancel event.** *You press outside a grown card* (`grow.outside`) is emitted by the
  outside-press listener in card-grow.ts **before** it collapses the grow. In = the card you
  pressed (`queue`); the fact **Grown card** (`grown`) names the card that is grown. The only Do
  it offers is **Keep the grown card open** (`{ keep: true }`); `cancelled(event, ctx)` in
  rules.ts tells the site, and the site does not collapse. Your press still reaches the Queue.
  A later "about to" moment can reuse the same kind: an event, `cancelled`, and Keep.
  Example: When *You press outside a grown card* · In *Queue* · If *Grown card is Playlists* ·
  Do *Keep the grown card open*.
- **A rule key.** *Collapse on outside click* (`cardGrowOutside`) is a `RuleKey`: a While row
  can hold it Off (*While Grown card is Playlists → Collapse on outside click: Off*). Its three
  readers in card-grow.ts read `effective`; the Settings row, the agent spec and Reset read your
  value.

## 2. As built (branch `rules-rulez`, 2026-09-27, commit `4c9808c`)

> **Part:** built · 2026-09-27 · desk test open

Where this section and §1 differ, this section is the code.

**Files.** `src/rulez-card.ts` (the card) · `src/rulez-words.ts` (the words, pure;
`tests/rulez-words.test.ts`) · `src/rules-playback.ts` (the playback words) · `src/rules-app.ts`
(the window words and the actions that write your value) · `src/rules-eval.ts` (the new names, the
leaf tests, any depth, drafts, the clock, the guard counters) · `src/rules.ts` (`userRules`,
`saveUserRules`, `allRules`, `ruleIdle`, `known`, `cancelled`, `ruleReads`, `setAppleGate`, the
cascade guards, the clock timer, the `time` / `day` / `card` facts, `keep`) · `src/sound.ts` (the
Sound facts, `tone.*` properties, the balance watch) · `src/sound-loudness.ts` (`loudness`) ·
`src/player.ts` (`onTransport`, `nowPlayingMeta`) · `src/card-grow.ts` (`grow.outside`, `grown`,
`fillCard`) · `src/layout.ts` (Max-only pool, Fill on open, the X, `card.open`) · `src/cards.ts`
(`maxOnly`, `onClose`) · `src/apple-health.ts` (`appleBackingOff`).

**Decided inside his choices (for his review).**
- The leaf test "is not" is stored as `isNot`: a leaf named `not` would read as the `not` group.
- Text compares without case; a song's genres are a list, and a leaf holds when any genre does.
  The genre list leaves out Apple's catch-all "Music".
- A When row's "set" words write **your** value, as a press does: *Use theme*, *Use skin*, *Use
  EQ preset* (through `pickLook` / `selectPreset`, so a rule-set theme is a hand pick to the look
  schedule). Band and preamp words are While only (a one-time tone change has no "go back").
- *Pause sharing* in a When row pauses for one hour (the Settings row's own length); in a While
  row it holds the three sharing switches Off.
- *Start the sleep timer* asks for minutes (`sleepIn`).
- *Grow this card* offers To Fill / Taller / Wider (the engine's `full` / `vertical` /
  `horizontal`).
- The rule's tone is three bands after yours: a low shelf at 120 Hz, a peak at 1 kHz (Q 0.7), a
  high shelf at 6 kHz, each held to ±12 dB. It runs with the EQ off too.
- The song balance: energy per octave in 20–250 Hz, 250 Hz–4 kHz and 4–16 kHz, each against the
  mean of the three (0 = pink, even per octave). Read every 500 ms, smoothed with a 3 s time
  constant, published in 0.5 dB steps only after a 1 dB move, at most every 2 s.
- EQ bass / mids / treble = the highest gain among your EQ's on bands in that zone (0 with the
  EQ off).
- *Song loudness* is registered only where the `loudness` table is read (Adaptive sound, behind
  its DevTools flag), so it shows greyed out otherwise.
- The fire cap applies to **your** rules only: pressing the cog five times must not turn the cog
  off.
- A miss on a frequent event (a song, a press, a surface change) writes no log line; a match
  always does.
- The pause event waits 400 ms: a skip passes through "not playing". *The queue runs out* is a
  pause at the end of the last song; it also sends *A song ends* first.
- *You skip ahead* / *You go back* come from a press (the Now Playing card, the Compass, a media
  key, the agent), not from a song ending.
- *You bring the app back* / *You hide the app in the tray* read the window's visibility; a
  minimize is neither.
- *The app opens* fires after the launch cover (`deets:boot-done`).
- The X's way back is kept per slot in `deets.layout.replaced`, so a restart keeps it. If that
  card is on screen already, the X brings the first card that is not.
- Rulez fills when you pick it and when you come back to Max; at launch it shows at its slot's
  size.
- A new row goes to the top of your list (a new rule is usually the one you want to win).
- The If cell's joiner (and / or) is one per group: pressing it switches the whole group. *Put in
  parentheses* makes a group that joins the other way, so `(A or B)` sits inside `… and …`.
- The words greyed out in a menu are the ones no module has registered (Song loudness without
  Adaptive sound).

**Desk test.** Max. (1) Pick Rulez from a card title: it takes the slot and grows to Fill; the
X collapses it and the card it replaced comes back. (2) Midi: Rulez is not in the picker; back
to Max: it is there and fills. (3) + › "Night jazz": a dimmed draft row at the top. (4) When ›
Playback › The next song plays; If + › Playback › Genre › Is "Jazz"; + › Time › Time › Is after
8:00 PM; Do › Sound … a draft stays dimmed until When and Do are set, then it runs. (5) Put a
chip in parentheses, switch its joiner to or, remove the group. (6) His case: When › Window ›
You press outside a grown card · In › Queue · If › Window › Grown card › Is › Playlists · Do ›
Keep the grown card open. Grow Playlists, press a Queue row: the grow stays, the press works.
(7) A While rule: While Output is … → Set the bass to -3 dB: `__sound.status().shelves.bands`
shows the low shelf. (8) The cascade cap: When The next song plays → Skip ahead, no If: after
5 skips in 10 s the rule turns off and a notice names it. (9) Locked rows: every built-in rule
shows below, names its row; the row menu opens that Settings row. `deetsmusic diag --flush --tag
rule` shows each fire.

## 3. Next — the ten routes and the Logs view

> **Part:** project · 2026-09-27 · his call: build all of them

Confirmed by the owner on 2026-09-27 after a review of the engine. Two sessions build them in
parallel on `rules-rulez`, each committing only its own paths. Each route gets its own step, its
own desk test and its own subsection here when built. Every fork inside a route that he has not
decided goes to him first. Owner: **A** = the Rulez card session, **B** = the engine-review
session.

| # | Route | Owner | What it is |
|---|---|---|---|
| L | **Rules \| Logs** toggle | A | Two view chips in the card head, the Library's Full \| Lib family; Rules is the default. Logs shows the `rule` diag lines as words (raw on a toggle), the live facts, the overlay and holds, and each rule's fire ring. |
| 1 | Last ran + Try | A | A *Last ran* cell from the fire ring; *Try* in the row menu runs `pickMoment` with the live facts and says "would run" or why not, without running the action. |
| 2 | The agent as the parser | B | `rules list / add / remove / on / off` on the bridge, one MCP tool, the CLI verb; a rule validated with `validate()` against `known()`. Agent-made rules carry `by: "agent"`. Gate: the existing agent-settings gate (§6.6). This is the §1.6 "text form", for an agent the user set up; the card itself carries no AI box (his call, §6.1). |
| 3 | Recipes | A | Shipped rule sets (`source: { recipe }`) with one switch each, shown locked under a Recipes divider; Duplicate makes an editable copy. The first sets are his fork. |
| 4 | Import and export | A | A rule or all rules as a JSON file (validated on load; broken ones named and skipped), Copy / Paste as text in the row menu. |
| 5 | Facts that cost nothing | A | The song's ♥, Diary score and play count; queue length; minutes since the app opened; minutes idle; battery and charging; a metered network. No Apple call. Rooms and Friends stay out (his call, §1.1). |
| 6 | Actions the app already does | A | Show a note (a toast), Add the song to a playlist, Mark Suggest Less, Open the Diary for this song, Pause scrobbling, Hide to the tray. Add to playlist and ♥ are Apple writes: `cost: "apple"`, the §1.5 gate, and his cost call first. |
| 7 | Cancel events as a veto | A | More `cancelled()` seams on the §1.7 shape: *The queue runs out → Keep* (no play-on), *The surface changes → Keep* (hold a grow). The list is his fork. |
| 8 | FUTURE-SETTINGS as rules | B | Walk [FUTURE-SETTINGS.md](../FUTURE-SETTINGS.md): each hard-coded "when" behavior that should be a built-in rule or a recipe rather than a row. A list for him, no code. |
| 9 | The shadow gap | A | A user rule above a built-in one wins silently. The Settings row's chip hint names the user rule ("Your rule 'Night jazz' in Rulez sets this"); the locked Rulez row says which rule above beat it. |
| 10 | Two safety notes | A | A When-row "set" item (theme, skin, EQ preset) hints that it writes your pick for good (§1.4). The song balance facts stay the only polled facts; a new fact needs a seam or a `next` time. |

**Not a route.** A fact or action that calls Apple on a timer: it breaks the cost model
(RULES.md §6) and the stewardship rule.

**Asked the same day, designed the same day:** rules that use the user's own files (§5) and
the row revamp for beginners (§6). His calls on 2026-09-27 in the engine-review session.

## 4. His calls for session A's routes (2026-09-27)

> **Part:** designed · 2026-09-27

| Route | His call |
|---|---|
| 1 | *Last ran* shows **in the Logs view only**; the Rules view does not change. *Try* stays in the row menu. |
| 3 | All four recipes ship — **Night listening**, **Focus**, **Headphones**, **Party** — **included but off**, so a user who finds them has a starting point. |
| 6 | Rules **may** make Apple writes (♥, add to an Apple Music playlist), **capped by a number of calls per 30 s** across all rules. |
| 7 | All three cancel events: **Station return**, **Collapse on Back**, **Weekly Replay**. |

**Found before the build.** Suggest Less is not built ([SUGGEST-LESS.md](SUGGEST-LESS.md) is
"designed"), so route 6's *Mark Suggest Less* waits for it.

## 5. Your own files in a rule (owner B)

> **Part:** designed · 2026-09-27 · his call: all of the recommendations below

His ask: "if the genre is Jazz, change the Glass canvas to a picture of mine", and "if the song
is explicit, play ping.mp3". What the code has today: the Glass picture is **one** file,
`wallpaper.jpg` in the app data folder, stamped by the `glassPicture` setting and served at
`http://wallpaper.localhost/<stamp>` (COVER-WALLPAPER.md §8, `wallpaper.rs`). The app plays no
sound effect anywhere; `sound.ts` owns the one AudioContext. So a picture rule needs named
pictures first, and a sound rule needs a small player on the existing graph.

### 5.1 The files store

- **One module, both kinds.** `src-tauri/src/user_files.rs` (+ `src/user-files.ts`): a file the
  user chooses is **copied** into app data under `files/<id>.<ext>` with a record `{ id, kind:
  "picture" | "sound", name, ext, bytes, added }` in `files.json`. The original is never read
  again. A rule names the **id**, never a path: a moved or deleted original cannot break a rule,
  and no Tauri fs scope has to reach the user's folders.
- **Choosing.** The same `<input type="file">` path the playlist cover and the wallpaper use
  (`setCoverFromFile`), and a drop on the row. A picture is resized to the wallpaper's limit and
  saved as JPEG, as today. A sound is kept as chosen (mp3, wav, ogg, m4a, flac: what WebView2
  decodes), **capped at 5 s of audio and 2 MB**; a longer file is refused with the wallpaper's
  "too large" toast wording (TOASTS.md §5 gets one row per kind).
- **Served** at `http://files.localhost/<id>` by the wallpaper's protocol handler shape.
- **Names.** The file's own name without its extension, editable in place (the playlist rename
  idiom). A name is what a rule's Do shows.
- **Reset** does not delete files (as with the wallpaper). Delete is a row action in Settings
  with the playlist's confirm. A rule whose file is gone is idle with `ruleIdle` saying so.
- **The agent cannot choose or delete files** (as today for the picture). It may name an
  existing id in a rule it adds (route 2).
- **Migration.** The existing `wallpaper.jpg` becomes the first picture record ("My picture")
  at first load, so a chosen picture survives the change. `glassPicture` (the stamp) is replaced
  by `glassPictureId: string` (`""` = none); the pre-paint and `wallpaper.ts` read the id.

### 5.2 Pictures — Settings and the Do

- **Settings › Glass › Picture** (the Canvas pill's Picture value) becomes a short list of named
  pictures with a check on the one in use, a Choose button, and rename / delete on right-click.
  The list is the **menu row** family; the Choose button is the row's existing action button.
- **The Do:** *Look › Use picture __* in a **While** row (a picture holds while its condition
  holds and goes back after). It lays two values as one set: `glassCanvas = "picture"` and
  `glassPictureId = <id>`. Both become `RuleKey`s (RULES.md §7): `wallpaper.ts` reads
  `effective`; the Settings rows, the agent spec and Reset read your value. The chip shows on
  the Canvas pill and on the picture list while a rule holds them.
- **The Do's menu** lists your pictures by name, then **Choose a picture…** as its last item,
  which opens the file input and picks the new picture for the rule when it is saved. So a rule
  can be made without a trip to Settings (his call: both places).
- In a **When** row the same item writes your value (§1.4), like *Use theme*.
- **Glass only.** Under another skin the rule still holds the values, and nothing shows (the
  canvas is a Glass feature). The Do's hint says "Shows under the Glass skin".

### 5.3 Sounds — the Do

- **The Do:** *Sound › Play sound __* in a **When** row only (a sound has no "while"). The menu
  lists your sounds by name, then **Choose a sound…**. A play button beside each name previews
  it.
- **The player.** `sound.ts` decodes a file once (`decodeAudioData`) and keeps the buffer;
  `playClip(id)` runs an AudioBufferSourceNode → its own gain → the destination, **after the
  EQ and the tone** (a chime is not part of the music) and **not through the meter** (the
  meter follows the EQ, SOUND.md). Level: a fixed `--clip-gain` token (skin base, about −6 dB).
- **Over the music, with a short duck** (his call): the music's gain dips by `--clip-duck-db`
  (about 6 dB) over 80 ms, holds for the clip, and comes back over 250 ms, through the same
  `setDuck` factor the sleep wind-down uses, so two ducks compose. Paused music stays paused;
  the clip plays alone.
- **AirPlay:** the clip goes where the music goes (it is on the same graph), so a HomePod hears
  the chime too. The hint says so.
- **Guards:** one clip at a time per rule (a second fire while it plays is dropped and logged);
  the 5-in-10-s cap (§1.5) stops a loop; a file that fails to decode marks the rule idle.
- **Cost:** `free`. Nothing here calls Apple.

### 5.4 Build order and desk test

Session B builds §5 after route 2, in this order: the store and its migration (unit tests for
the record shape and the migration) → the pictures list in Settings → the picture Do and the
two rule keys → the sound player and its Do. Each step: `npm run check`, then the desk test.

*Desk test.* (1) Settings › Glass › Canvas: Picture; Choose two pictures; rename one; the list
shows both with a check on the one in use. (2) A rule: While Genre is Jazz → Use picture "Blue";
play a jazz song under Glass: the canvas changes with the wallpaper's fade; the Canvas pill and
the list show the green dot; a non-jazz song gives your picture back. (3) Pick a picture by hand
while the rule holds: the red dot; the hint names the rule. (4) Delete "Blue": the rule dims and
its hint says the file is gone. (5) Do › Play sound › Choose a sound… with a 2 s clip; When the
next song plays, If Explicit is yes → Play sound "ping": an explicit song chimes over its first
second and the music dips and returns; a clean song does not. (6) A 30 s file is refused with
the toast. (7) Restart: both pictures and the clip are still there; the old `wallpaper.jpg`
shows as "My picture". (8) **His:** the chime on a HomePod.

## 6. The row, made for a first rule (owner A, from B's design)

> **Part:** designed · 2026-09-27 · his calls in the engine-review session

The table (§1.2) is six cells, a draft that sits dimmed until two of them are filled, words
found through nested menus, parentheses for grouping, and an order that decides who wins
without saying so. Each is a wall for a first-time user. His direction: **a rule is a
sentence**, **a row is its name and its summary**, **a press expands it**, and **nothing in the
card reads as AI or as a suggestion pushed at the user.**

### 6.1 His calls (2026-09-27)

| Fork | Choice |
|---|---|
| The row | **Collapsed: the name, the on/off toggle, the one-line summary.** A press on the row expands it in place (the Settings section's open / close motion, `enterRows` for the parts). One row open at a time; the row menu (⋯, right-click) stays. |
| The editor | **A sentence with blanks**, not a table: "When *the next song plays*, DeetsMusic *uses EQ preset* *Warm*, only if *Genre* *is* *Jazz*." Each blank is a button that opens the same section menus as today (§1.2). |
| Conditions | **Nested blocks replace the parentheses chips**: "all of these" / "any of these" / "none of these" as indented blocks, the Smart Playlist model. They map one to one onto `all` / `any` / `not`, so the evaluator does not change. |
| A describe-it box, starters in the empty state | **No.** He does not want the user fed a rule or reminded of AI. The empty state is one sentence and the + button. Recipes stay under their divider (§4), off until turned on. The agent's verb (route 2) is for an agent that a user set up, and has no place in the card. |
| The table | Goes. The sentence is the one editor; the collapsed list is the overview. Advanced users get the blocks. |

### 6.2 The collapsed row

- **Name** (bold, the stored `name`; "Untitled rule" until named) · **toggle** (on / off,
  `on`; a draft's toggle is disabled with the hint "Finish the rule first") · **summary**: the
  sentence as one muted line (`whenText` + `condText` + `doText` in rulez-words.ts, which
  exist). A rule that is idle shows why instead of the summary (`ruleIdle`), with the warning
  glyph.
- **Who wins.** A row that also matches when a row above it does shows one line: "Also matches
  when *Night jazz* does. *Night jazz* runs first." From `pickMoment`'s losers over the rules'
  own events: two moment rules on the same event whose conditions can both hold, or two While
  rules on one target. Computed on render, not per fire. (This is route 9's Rulez half.)
- **Locked rows** (built-in, recipes): the lock glyph, the name of the Settings row or recipe,
  the summary; no expand; the menu as today (§1.2).
- **Order:** the grip and *Move up* / *Move down* stay; the who-wins line is what makes the
  order visible.

### 6.3 The expanded row: the sentence

- **Line 1, When:** "When *[the next song plays]*" or "While *[…]*". The blank opens the When
  menu (sections as today). A new rule opens with this blank empty and focused: "When *[what
  happens?]*".
- **Line 2, Do:** ", DeetsMusic *[does what?]*" then the value blank(s) the Do needs ("*uses EQ
  preset* *[Warm]*", "*plays sound* *[ping]*"). While rows read "DeetsMusic *keeps* *[the
  theme]* *[Night]*".
- **Line 3, If (optional, after When and Do exist):** a dashed chip "*only if…*". Pressing it
  adds the first condition block (§6.4). A rule with no If never shows the line's words.
- **In:** the card blank shows only when the event has one ("*in* *[any card]*"), after the
  When blank. Most events have none, so most sentences never show it.
- **The draft rule** (§1.2) stays: a sentence with an empty When or Do blank is saved and dimmed.
  The blank that is missing is the one with the dashed border.
- **Name and Desc** sit above the sentence in the expanded row as two fields (the playlist
  rename idiom). Desc is optional and shows in the collapsed row's hint.
- **Live check.** Under the sentence, one muted line: "Would run for the song playing now" or
  "Would not run now: Genre is Rock". That is route 1's *Try*, always on, from `evalCond` with
  the live facts, re-read on each fact change while the row is open (the engine's seam
  subscriptions; nothing polls).

### 6.4 Conditions as blocks

- The first condition is one line: "*[Genre]* *[is]* *[Jazz]*" with a + at its end ("and…").
- A second condition makes the block visible: a head chip "*all of these*" (press to switch to
  "any of these" / "none of these"), the conditions indented under it, each with a ✓ or ✗ for
  the live facts (muted, "now").
- **A block inside a block:** the + menu's last item, *a group inside this one*, adds an
  indented child block with its own head chip. Any depth (§1.1). *Remove the group* on a head
  chip lifts its members up one level (the `tidy()` rule stays).
- Every block is a `Cond` group; the sentence's If reads the root with `condText`, which already
  writes "(A or B) and C" for the summary line.
- **Family:** the head chip and the condition chips are the Rulez cell family (`--rulez-cell-*`
  aliases, TOKENS.md); the indent guide is a 2 px rule in `--rulez-block-rule` (a theme role, the
  Settings section's divider color).

### 6.5 Words

Sentences use "DeetsMusic" as the actor, never "I" or "we", and never "suggest", "smart" or
"AI". Active voice (§1.1). The one place the app writes a rule for the user is a recipe, and
recipes say who made them: "Made by DeetsMusic. Turn it on to use it."

### 6.6 Decided inside his choices (B's recommendations, for his review)

- The table goes rather than staying as an advanced view: two editors for one thing would each
  be half-tested.
- One row expanded at a time, so the list stays readable; opening another closes the first.
- The who-wins line is computed on render (cheap: the rule count is small), never per fire.
- The live check line replaces the *Try* menu item (route 1): the same code, always visible.
- Route 2's gate: the bridge's rules verb rides the existing agent-settings gate (Ask by
  default), since the card has no describe box of its own. Only an agent the user set up can
  reach it.

*Desk test.* Max, Rulez open. (1) Empty card: one sentence and +; no starters. (2) +: a row
opens with "When *[what happens?]*" focused; pick an event; the Do blank takes focus; pick a Do
and a value; the toggle turns on; the collapsed summary reads as one sentence. (3) "only if…":
one condition; +: the block head appears with "all of these"; switch to "any"; add a group
inside; remove it. (4) Play a matching song: the live line says "Would run…"; each condition
shows ✓ / ✗. (5) A second rule on the same event with a condition that also holds: the who-wins
line names the first. (6) Press another row: the first collapses. (7) A draft: the missing blank
is dashed; the toggle is disabled with its hint. (8) A locked row does not expand; its menu
opens Settings.
