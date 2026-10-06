---
status: built
desk_test: open
sources: [src/rulez-card.ts, src/rulez-words.ts, src/rules-app.ts, src/rules-playback.ts, src/rules-facts.ts, src/album-slots.ts, src/rules.ts, src/rules-eval.ts, src/card-grow.ts, src/layout.ts, src/sound.ts, src/player.ts, src/rules-window.ts, src/go-to.ts, src/media-menu.ts, src/rules-recipes.ts]
updated: 2026-10-06
---
# DeetsMusic — Rulez, the rules builder

**Rulez is the card where you make your own rules.** The engine that runs them is
[RULES.md](../architecture/RULES.md): the rule shape (§4), the facts (§5), the registry (§6), the
overlay (§7), a hand change (§8), the guards (§11) and the recipe for a feature that uses rules
(§19). This doc is the card: his forks (§1), the build record (§2), the routes (§3–§4, all
built), your own files in a rule (§5), the sentence row (§6), the agent's verb (§7), the routes
as built (§8), snapshots (§9), FUTURE-SETTINGS as rules (§10), the album color facts and Live
Theming (§11), moving a rule and its hover box (§12), cases (§13) and one row per recipe (§14).
**Next: a full pass on custom rules (§15)** before any more building on recipes or cases.
Recipes in Settings and the Cruisin / Pro start pick are designed in §16 (forks open). The
motion and UX review of 2026-10-06 and its fixes are §17 (where §1–§14 and §17 differ, §17 is
the code).
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

> **Part:** built · 2026-09-27 · his call: build all of them. Every route is built: route 2 is §7,
> session A's routes are §8, route 8 is §10.2. Only route 6's *Mark Suggest Less* waits (for
> Suggest Less itself).

Confirmed by the owner on 2026-09-27 after a review of the engine. Two sessions build them in
parallel on `rules-rulez`, each committing only its own paths. Each route gets its own step, its
own desk test and its own subsection here when built. Every fork inside a route that he has not
decided goes to him first. Owner: **A** = the Rulez card session, **B** = the engine-review
session.

| # | Route | Owner | What it is |
|---|---|---|---|
| L | **Rules \| Logs** toggle | A | Two view chips in the card head, the Library's Full \| Lib family; Rules is the default. Logs shows the `rule` diag lines as words (raw on a toggle), the live facts, the overlay and holds, and each rule's fire ring. |
| 1 | Last ran + Try | A | A *Last ran* cell from the fire ring; *Try* in the row menu runs `pickMoment` with the live facts and says "would run" or why not, without running the action. |
| 2 | The agent as the parser | B | **BUILT 2026-09-27, desk test passed (§7).** `rules list / words / show / add / remove / on / off` on the bridge, one MCP tool, the CLI verb; a rule validated with `validate()` against `known()`. Agent-made rules carry `by: "agent"`. Gate: the existing agent-settings gate (§6.6). This is the §1.6 "text form", for an agent the user set up; the card itself carries no AI box (his call, §6.1). |
| 3 | Recipes | A | Shipped rule sets (`source: { recipe }`) with one switch each, shown locked under a Recipes divider; Duplicate makes an editable copy. The first sets are his fork. |
| 4 | Import and export | A | A rule or all rules as a JSON file (validated on load; broken ones named and skipped), Copy / Paste as text in the row menu. |
| 5 | Facts that cost nothing | A | The song's ♥, Diary score and play count; queue length; minutes since the app opened; minutes idle; battery and charging; a metered network. No Apple call. Rooms and Friends stay out (his call, §1.1). |
| 6 | Actions the app already does | A | Show a note (a toast), Add the song to a playlist, Mark Suggest Less, Open the Diary for this song, Pause scrobbling, Hide to the tray. Add to playlist and ♥ are Apple writes: `cost: "apple"`, the §1.5 gate, and his cost call first. |
| 7 | Cancel events as a veto | A | More `cancelled()` seams on the §1.7 shape: *The queue runs out → Keep* (no play-on), *The surface changes → Keep* (hold a grow). The list is his fork. |
| 8 | FUTURE-SETTINGS as rules | B | **Walked 2026-09-27 (§10), all five built and desk-tested the next afternoon (§10.2).** Walk [FUTURE-SETTINGS.md](../FUTURE-SETTINGS.md): each hard-coded "when" behavior that should be a built-in rule or a recipe rather than a row. |
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

### 5.4 Build order and desk test (the desk test is at the end of §5.5)

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

### 5.5 As built (2026-09-27)

> **Part:** built · 2026-09-27 · desk test passed 2026-09-27 (§5.4 steps 1–7; 8, the HomePod, is his)

Where this and §5.1–§5.4 differ, this is the code.

**Files.** `src-tauri/src/user_files.rs` (the store: `files.json` + `files/<id>.<ext>` + a
picture's `<id>.json` colors; `add` / `rename` / `delete` / `colors` / `migrate_wallpaper` as
functions over a folder, with three `cargo test`s on a temp dir; the five `user_files_*`
commands, all `spawn_blocking`; the `files` protocol) · `src/user-files.ts` (the cached list,
`onFilesChange`, `loadFiles` with the migration, `readPicture` (moved from wallpaper.ts),
`addPicture`, `addSound`, `renameFile`, `deleteFile`, `pickFile`, `fileUrl`) ·
`src/rules-files.ts` (`initRulesFiles`: the `picture` and `playSound` actions, the decoded-clip
cache, `previewSound`, `fileGone`) · `src/wallpaper.ts` (reads `effective` for the canvas and
the picture id; `setWallpaperFromFile` is `addPicture` + your value) · `src/settings-card.ts`
(the Picture row: a menu of your pictures + Choose; right-click rename / delete) ·
`src/settings-store.ts` (`glassPictureId`, both keys in `RULE_KEYS`) · `src/rules-eval.ts`
(the two Action members) · `src/sound.ts` (`decodeClip`, `playClip`, `clipPlaying`, by the card
session, 9e4f0d8) · `skin.css` (`--clip-gain-db` −6, `--clip-duck-db` 6) · `lib.rs`.

**Decided inside his choices (for his review).**
- The store's id is `f` + the time in base 36 + 4 random hex chars; a file never changes
  under its id (a new choice is a new id), so `http://files.localhost/<id>` is served
  immutable, as the wallpaper was.
- A sound's length is checked on the page after a decode (the decoder knows the length; Rust
  does not), its size in both places. Formats: what WebView2 decodes (mp3, wav, ogg, m4a, flac).
- The picture list's menu shows "None yet" (inert) until a picture exists; a delete of the
  picture in use falls back to the first picture left, or none. Rename and delete act on the
  picture in use (the one the menu shows), through the row's right-click; a picture not in use
  is renamed by picking it first.
- The migration runs on the first `user_files_list` (at launch, `initRulesFiles` → `loadFiles`),
  not at Rust start, so it can point `glassPictureId` at the record it made.
- `readPicture` moved to user-files.ts so wallpaper.ts imports user-files and not the other
  way round (no import cycle).
- The clip's level and duck are skin tokens (base only; a skin may override): −6 dB and a 6 dB
  dip.
- The agent's `settings` verb does not expose `glassPictureId` (its values are file ids that
  change per machine); an agent uses the `rules` verb's `picture` word, or `glassCanvas`.
- The Rulez words (`Use picture`, `Play sound`), the two run-time lists (`pictures`, `sounds`),
  the "Choose a picture… / Choose a sound…" menu items, a sound's "Listen", and the idle hint
  for a gone file are the card session's lines in rulez-words.ts and rulez-card.ts (in the same
  commit). The agent's `rules` verb reaches both words by name (`do: "picture", value: "Blue"`)
  and shows the same gone-file idle.
- The chip sits on the Canvas pill, not on the Picture row: the row is a split row (a menu
  and a button) with no store key of its own, and the chip slot belongs to keyed rows. The
  pill's hint names the rule either way.
- `__files` in DevTools (telemetry builds): `list`, `addPicture(file)`, `addSound(file)`,
  `rename`, `delete`, so a desk test adds a file made on the page, without the native picker.

**Desk test run (2026-09-27, Claude on his dev app; Ask-mode Allows pressed over CDP at his
word).** (1) Two pictures dropped on the Picture row (a DataTransfer with a File, the real
drop path): both saved (`files:add`, 10 KB each), the row's menu lists them, the canvas drew
the last one (`wallpaper:draw why: glassPictureId`); rename through the right-click field →
"Crimson". (2) The agent rule *While Genre is Jazz → Use the picture Blue*, then Blue Train:
`__rules.applied()` held both keys, the canvas was blue (picture). (3) A hand pick of Red from
the row's menu: a `next` hold on both targets, the overlay let go, the Canvas pill's red dot
hint: "Your pick holds. Press to give it back to your rule 'Jazz blue'". (4) Delete Blue
through the right-click question: the file and its colors gone from `files/`, your picture
fell back to Crimson, the rule reads "The file this rule uses is gone." (5) A 0.8 s ping made
on the page (`__files.addSound`); the rule *When the next song plays → Play the sound ping*:
`clip:play {gainDb: -6, duckDb: 6, ms: 800}` then `rule:file {played: true}`, audible over
Blue Train. The *Explicit* version did not fire: the `explicit` fact read false for
`song:1693657477` (Only in the West), whose album cover wears the advisory badge. Not a bug
(the card session, the same night): Apple rates only the marked songs, and neither the track
store nor MusicKit's item carries a rating for that one; the album's badge is for its other
tracks, and the app's own row shows no E. (6) A 30 s file: refused with the toast, nothing saved. (7) A page
reload: both files, the picture in use and the rule came back. Everything the test made was
removed after it; the canvas went back to Covers.

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
- **Order:** the grip and *Move up* / *Move down* stay (the grip went 2026-09-27: hold, then move, §12); the who-wins line is what makes the
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

**How the words are built, so a new word needs no grammar code (2026-09-27 late night).** The
condition-block bug ("Charging" + "s on battery") came from cutting one string apart. The rules
that keep it from coming back, all in rulez-words.ts:
- **Parts, never string surgery.** A condition is `leafParts`: a `name` plus the `rest`
  ("Genre" + "is Jazz"), or a whole phrase with no name ("The PC is on battery"). The card draws
  one blank per part. Nothing slices, splits or measures a phrase to find a word in it.
- **One case rule.** A phrase goes lower case mid-sentence only through `lowerFirst`: it lowers
  the first letter only when the first word is an ordinary capitalized word, so "AirPlay",
  "EQ preset" and "DeetsMusic" keep their case. Its one limit: a plain one-capital name
  ("Apple") reads as a common word; start such a label with another word.
- **Every Do word says its own verb.** `SAYS` holds the When form (`act`) and the While form
  (`keep`) of each word; a test fails when a new Do word has none, so the label is never bent
  into a verb.
- **Tests** (`tests/rulez-words.test.ts`): every fact's parts join back into its phrase; the
  yes / no phrase is whole; `lowerFirst` keeps names; every Do word has its SAYS.
- **What still depends on a format** (not grammar, for the custom-rules pass, §15): a recipe
  part's title is the text after `": "` in the rule's name (rulez-card.ts `recipeRowHTML`), and
  a few Do values read lower case by a list of ids (`doValueText`, the `plain` list).

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

## 7. Route 2 as built — the agent's `rules` verb (owner B, 2026-09-27)

> **Part:** built · 2026-09-27 · desk test passed 2026-09-27 (AGENT.md §8; the Off step is his)

The whole record is [AGENT.md §8](../integrations/AGENT.md): the surfaces (the `rules` MCP
tool, `deetsmusic rules …`, `GET` / `POST /rules`), what an agent reads (`list`, `words`,
`show`) and writes (`add` in the words form or the stored shape, `remove`, `on`, `off`), the
gate (Agent changes settings: Ask / Allow / Off), what was decided inside his choices, and the
desk test. Files: `src/agent-rules.ts` (the window's half; it imports the engine's exports
read-only), `src/agent-rules-shape.ts` (pure: the shaping, `findUserRule`, `agentWords`;
`tests/agent-rules.test.ts`), `src/agent-writes.ts` (two dispatch cases), `bridge.rs`
(`/rules` in `AGENT_ROUTES`), `cli/src/main.rs` (`Rules`, `op_rules`, the tool).

What Rulez sees: an agent's rule is a user rule with `by: "agent"` (the `Named` field the card
session added), at the top of the list. The card marks it (§6.2 shows who made a row); a
person edits or removes it like any rule of theirs. The desk test needs a dev app restarted on
this bridge (a Rust change).

## 8. Session A's routes and §6 as built (2026-09-27)

> **Part:** built · 2026-09-27 · desk test open (his)

Where this section and §3, §4, §6 differ, this section is the code.

**Files.** `src/rulez-card.ts` (rewritten for §6: the collapsed list, the sentence, the
blocks, the views, paste / import / export) · `src/rulez-blocks.ts` (pure: all / any / none
blocks; `tests/rulez-blocks.test.ts`) · `src/rulez-words.ts` (`SAYS`, `sentenceText`,
`stateParts`, `whoWins`, `canBothHold`, the new words) · `src/rulez-logs.ts` (the Logs view) ·
`src/rules-recipes.ts` (the four recipes) · `src/rules-facts.ts` (route 5) · `src/rules.ts`
(`ruleStats`, `tryRule`, `recipesOn` / `setRecipe`, the shared Apple cap, `appleIf`, the launch
hold on skip lines) · `src/rules-eval.ts` (`{ recipe }` source, `Stored.recipes`, `failingLeaf`,
`APPLE_CAP`, the new names) · `src/rules-app.ts` (route 6's actions) · `src/rules-playback.ts`
(`station.return`, the Discovery station) · `src/player.ts`, `src/card-grow.ts`,
`src/replay.ts` (route 7's three cancel sites) · `src/diag.ts` (`onDiag`) · `src/sound.ts`
(`outputKind`) · `src/context-menu.ts` (a searching field widens its own box).

| Route | As built |
|---|---|
| L | *Rules \| Logs* is the split pill primitive (`splitPillHTML`, the Full \| Lib family) in the head. Logs: **What ran** (the rule lines of the diag ring as sentences, newest first, 80 at most; *Words \| Raw*), **Last ran** (every rule: its last fire, fires in the last 10 s, off until restart), **Holding now** (what each While rule lays, and where your pick holds), **Facts now**. It follows new rule lines through `diag.onDiag`, at most every 300 ms, only while it shows. The view and the open row are the card's memory. |
| 1 | *Last ran* is in Logs only (his call). An open row of yours shows *Try* live under the sentence (§6.3); a locked row (built-in, recipe) keeps *Try* in its menu, since it does not open. `failingLeaf` names the part that is not true now. |
| 3 | `Stored.recipes` lists the recipes that are on (none by default). Six ship: the four of §4, Play on launch (§10.2) and Live Theming (§11.1). A recipe shows locked under **Recipes** as one row with one On \| Off switch (§14); its menu: Turn on / off, Try, *Duplicate into your rules*, Copy as text. Party's station is `{ special: "discovery" }`, found from your Discovery station at run time. |
| 4 | The header's ⋯: **Paste a rule** (a field: Ctrl+V, then Enter), **Import from a file…** (a file picker), **Export your rules to a file** (`deetsmusic.deetsrules.json` in Downloads), **Copy your rules as text**. A row's menu: *Copy as text*. Every pasted or imported rule is checked against `known()`; a broken one is named and skipped. |
| 5 | Loved, Diary score, Times played, Songs up next, Minutes since the app opened, Minutes with no press, Battery, Charging, Online, Data saver, Output kind. The Diary score and play count are read once per song, only while a rule reads them (`pin_play_counts`, the cached Diary list, one `diary_get`). Minute facts wake the engine only while a rule reads them. |
| 6 | Show a note, Hide the app in the tray, Add the song to a playlist (your local playlists and editable Apple ones), Love the song (Apple), Open the Diary for this album, Turn scrobbling on / off. An add to an Apple playlist is an Apple call through `appleIf`. *Mark Suggest Less* waits for Suggest Less. |
| 6 cap | His call: **at most 3 Apple actions in 30 s across all rules**, and never from an event another rule caused, never while Apple asks us to wait. |
| 7 | *A station is about to come back* (`maybeResumeStation`), *You go Back from a grown album or artist* (`levelLeft`), *The weekly Replay is about to be made* (`runWeeklyReplay`; a Keep marks this week done). Keep's words are now *Keep it from happening*, for every cancel event. |
| 9 | Your rows and the locked rows show "Also matches when *X* does. *X* runs first." from `whoWins` (same event and card, or a shared While target, and conditions that can both hold). The Settings chip names your rule: *Your rule "Night jazz" sets this now.* |
| 10 | A When row's *Use theme / skin / EQ preset* opens with a greyed line: *Saves it as your own pick, for good*. The song balance stays the only polled fact; every route 5 fact has a seam or a `next` time. |

**Decided inside his choices (for his review).**
- The Apple cap's number is 3 in 30 s (he asked for "a number of calls per 30 s").
- The header gets a ⋯ for paste / import / export: + now makes a rule at once (§6.3), so those
  moved off it.
- Paste is a field, not a clipboard read: the WebView refuses the page a read.
- A condition line is two blanks, not three: *[Genre]* *[is Jazz]* (the value menu holds is /
  is not / above / below together).
- The open row's parts enter with `enterRows`; the row itself opens with no height motion.
- A recipe with two rules shows two locked lines; the switch sits on the first. (Replaced the same day: one row per recipe, §14.)
- An agent's rule starts its summary with *Made by an AI app.* (his words in AGENT-SETUP.md)
- The fire cap (5 in 10 s) covers recipes too.
- The indent guide uses `--border`, not a new role (§6.4 named `--rulez-block-rule`).

**Found at the desk (2026-09-27).**
- A searching field in a flyout widened the top menu and pushed the open flyout off the window
  (his picture): the class now goes on the box that holds the field.
- Every rule of yours logged "cannot run: unknown event" at launch, then ran: the engine now
  logs a skip only after the launch cover is done.
- A stray "The volume went back" line at launch: the volume property logs only when a rule laid
  one.

**Desk test (Claude, dev:app, through the UI).** The sentence flow: + opens the When menu; the
Do blank; a value; *only if…*; a second condition shows *all of these* with ✓ / ✗; switch to *any*;
the summary reads as one sentence; the stored rule is `{ any: [...] }`. A recipe's switch turns
it on and off. *Try* on the cog's locked row says "Would run now." Logs shows its four parts in
words. Export saved the file; Paste added a good rule and named a broken one. *Show a note* on
*You open a card › History* showed the note. *Keep* on *You go Back from a grown album* kept the
Library grown after Back (the log shows `grow:kept on back`). **Not run at the desk:** the
station return and the weekly Replay cancels, the Apple actions, the route 5 facts other than
the ones Logs lists, the who-wins line with two real rules, and drag in the new list.


**Desk test with music (Claude, 2026-09-27, later the same night).** Through the UI on the dev
app, a library album playing:
- *The music pauses* / *The music resumes*: each note showed; the snapshots read `ran`.
- The cascade guard: "When the next song plays, if genre is Alternative → Skip ahead" on a
  7-song album. It fired at chain steps 0 to 4, about 2.3 s apart; on the 5th the notice named
  it (*"T skip alt" ran 5 times in 10 seconds…*), and the next song's snapshot reads `refused`.
- *A song ends* (a seek to 98 %) ran its note.
- A While rule "while the music is playing → the volume at 8 %": 8 % while playing, and on
  Pause it gave back the level it found (2 %, the level at that moment). Between two songs the
  music stops for about 0.2 s, so the rule lets go and lays its value again; you do not hear it.
- Who wins: two rules on *The music pauses*; the snapshot reads `ran` / `lost`, and the second
  row says "Also matches when "T pause 2" does. "T pause 2" runs first."
- The Apple cap: "When the music pauses → Play the playlist *test*", four hand pauses 4.5 s
  apart: three ran, the fourth read `refused (3 Apple calls in 30 s already)`.
- The free facts in Logs: loved, songs up next, minutes open, minutes with no press, output
  kind, battery, charging, online, data saver.
- Drag in the new list: the first rule moved to third. (Found: a script's pointer made
  `setPointerCapture` throw and end the drag; the capture is now tolerant.)

**Run later:** the station-return and weekly-Replay cancels (the end of §10), and the Diary
score / times played facts with a rule that reads them (§10.2). Nothing of §8 is left unrun.

## 9. Snapshots: the app state when a rule runs (his calls, 2026-09-27)

> **Part:** built · 2026-09-27

His question: can the app capture its state at the time a rule runs, for better debugging?
His calls: **the facts and the verdict** (not only the facts the rule reads, not the whole app
state); read in **the Logs view, the log file and reports, and the agent / diag tools**; for
**runs and near misses** (not every event).

- **What a snapshot holds** (`rule:snap`, rules.ts `momentSnap` / `stateSnap`): every fact at
  that moment; each rule that listens to the event (same event, same card or any, same clock
  minute), each with its verdict — `ran`, `lost` (to a rule above), `no` (a condition is not
  true), `refused` (the fire cap, an Apple guard) — and each of its conditions with ✓ / ✗
  (rules-eval.ts `leafResults`); the chain step and whether a rule caused it. A While rule's
  start, end and hand hold write one too (`holds`, `ended`, `hand`).
- **When:** only when a rule listens to the event. An event nobody listens to saves nothing.
- **Where:** one line in the diag ring. So the Logs view shows it (a *What ran* line opens in
  place: the rules checked, ✓ / ✗, the facts; in Words mode it takes the place of its `rule`
  lines), the log file gets it at the ring's flush (every 5 minutes, and on unload), a bug report
  carries it, and the agent reads it with `deetsmusic diag --tag rule:snap` / the `diag` tool.
- **Size:** about 1 KB; the ring (300 lines) bounds how many are kept.

*Desk test.* Make a rule on *The music pauses* with a condition that fails, and one that holds.
Pause. Logs › What ran: one line; open it: both rules, `ran` and `did not run`, each condition
✓ / ✗, and the facts. `deetsmusic diag --flush --tag rule:snap` prints the same.

## 10. Route 8 — the FUTURE-SETTINGS walk (owner B, 2026-09-27)

> **Part:** built · 2026-09-27 · **his call the same night: yes to all five.** Built and
> desk-tested by Claude the next day (§10.2).

The question (§3, route 8): which of the hard-coded behaviors in
[FUTURE-SETTINGS.md](../FUTURE-SETTINGS.md) are "when" or "while" decisions, and so belong to
the engine as a built-in rule or a recipe rather than as a Settings row. The test applied to
each entry: a rule decides *when* something happens or *while* what is true; a row decides
*what* a thing is (a scope, a threshold, an order, a shape). A "when" that costs an Apple call
on a timer is never a rule (RULES.md §6).

**Already rules.** §16 New-Playlist summon is the `playlist.create` rule (RULES.md §13). §17
Radio resume after a break-out is the `station.return` cancel event (route 7, §8). §18 (the
toasts) and §23 are built as features.

**Candidates: a rule instead of a row** (my recommendation first).

| FUTURE-SETTINGS | Today | As a rule | Why |
|---|---|---|---|
| **§22 Play on launch** | Documented, not built: a row with a picker (*Nothing · Last song · A station · A playlist · A song*) plus starred playlists | **A recipe, "Play on launch"**: When *The app opens* → *Play a playlist / Play a station / Play*, off by default; the user picks the source in the recipe's copy (Duplicate → the Do's value). *Last song* = the `play` Do on the restored queue. The starred pool waits (a "random of these" Do is a later word) | Every part of §22's table is a When + a Do the engine has today. The row's picker would be a second UI for the same thing. **Guard to keep:** §22's rule that a tray launch never plays — `app.open` fires on `deets:boot-done`, so the engine must not emit it for a hidden `--tray` start (to check with the card session; one `if` at the emit) |
| **§10 Queue summon: flip or no-op** | A row, not built (`deets.summonFlip`) | **A cancel event**, `queue.summon` (In: the card the Queue would displace; fact `grown`) with Do *Keep it from happening* — the §1.7 shape, like `grow.outside` | "Do nothing when the Queue is already on screen" is a veto on an about-to moment, which is exactly what a cancel event is; a row would hard-code one answer |
| **§5b Shuffle press with nothing playing** | Built as the row `shuffleIdle` (*library* / *noop*) | A built-in rule made by that row: When *You press shuffle* · If *The music is not playing* → *Play the library shuffled*; the row keeps its key | Fits §13's pattern (a row makes its rule) and gives a user rule the same event (*You press shuffle*) for their own use. Low value on its own; worth it only when a shuffle event is wanted anyway |
| **§20 Drill-in target** (Go to Artist / Album: in place or in Search) | Built as Full \| Lib chips; a setting "open drills in Full" is the follow-up | An event `goto.artist` / `goto.album` with two Dos, *Open in the Library* / *Open in Search*, and In = the card the verb came from. The default stays the built-in rule (Library in place, the rest in Search) | The split is already "per surface" — that is a rule's `In`. A user rule can then say "from the Queue, open in the Library" without a new row |
| **§8 Surface switching** (auto-flip on resize) | Built as the row `surfaceAutoFlip` | Not a rule; but a **fact** `windowWidth` / `windowHeight` (seam: the resize) lets a user say *While the window is narrower than 500 → Keep on top* | The surface is a deliberate choice (§8's principle); the size is a fact worth having |

**Stay rows** (a "what", not a "when"): §1 Play Now scope, §2 queue menu actions and order, §3
drag initiation, §4 Previous reach, §5a shuffle placement, §6 the caret, §7 the listened-through
threshold, §9 per-menu hover, §11 title underline, §12 / §13 the skin knobs, §14 eager counts
(an Apple cost gate), §15 the submenu sort, §19 artist placement, §21 sync cadence (Apple on a
timer: never a rule), §24 the Now Playing squares, §25 graphics quality.

**Rows that should be rule keys when built** (so a While rule can hold them): §25 *Graphics
quality* (*While on battery → Light*, with route 5's `battery` / `charging` facts), §12 / §13
a skin's intensity preset (*While Genre is Ambient → Glass calm*), §11 the title underline,
§24 the Now Playing squares (*While Surface is Mini → hide Search*). Each is one line in
`RULE_KEYS` and the readers choose `effective` (RULES.md §19 step 4).

**His forks, decided 2026-09-27 (late; he went to bed after): yes to all five.** (1) §22 as
a recipe. (2) §10 as a cancel event. (3) §20 as an event with two Dos. (4) §5b's shuffle
event. (5) The `windowWidth` / `windowHeight` facts. Each is one step with its own desk test,
recorded in §10.1.

### 10.1 The build (two sessions, same split as §3)

| # | Step | Owner | The seam | Decided inside his choice (for his review) |
|---|---|---|---|---|
| 1 | **Play on launch** recipe | A (rules-recipes.ts, rules-app.ts) | `emitAppOpen()` in rules-app.ts, on `deets:boot-done` | The recipe ships off with *Play* (the restored queue = §22's *Last song*); Duplicate and change the Do to *Play a playlist* / *Play a station* for a source. **The tray guard:** `app.open` is not emitted when the window is hidden at boot (`--tray`, `isVisible()` false), and not when it is shown later from the tray; the log says `rule: app.open skipped (tray)`. The starred-playlists pool is a later Do |
| 2 | **Queue summon** cancel event | A (layout.ts, rules-app.ts, rulez-words.ts) | `onCardRequest` in layout.ts, before `setSlot(lruSlot(), "queue")` when the Queue is already on screen | Event `queue.summon` (*The Queue button is pressed with the Queue on screen*), In = the card the flip would displace, fact `grown`; Do *Keep it from happening* only (the §1.7 shape). A hidden card request (the agent's summon) is the same event |
| 3 | **Go to** events | A (go-to.ts, library-card.ts, rules-playback.ts or rules-app.ts, rulez-words.ts) | `goToArtistItem` / `goToAlbumItem` (go-to.ts) and the Library's `trackMenu(items, ctx, nav)` | Events `goto.artist` / `goto.album`, In = the card the verb came from; Dos *Open in the Library* (the Library card summoned and drilled, §20's option c, for a library track; else Search) and *Open in Search*. The built-in rule keeps today's split: `row:goToTarget` made by a new row Settings › Menus › **Go to opens** (*Where it fits* (default) · *Search* · *Library*) — a row makes its rule (RULES.md §13). Cost: the Library path is local; Search is the existing one-hop catalog read |
| 4 | **Shuffle press** event | A (player.ts `shuffleQueue`, rules-playback.ts, rulez-words.ts) | the shuffle button's press (the Now Playing square, the Compass, a media key, the agent), not a mode change from a rule | Event `shuffle.press` (*You press shuffle*); the row `shuffleIdle` makes the built-in rule *If The music is not playing → Play the library shuffled*, and `player.ts` drops its own idle branch (the rule is the one path). Fact `playing` exists |
| 5 | **Window size** facts | B (a new `src/rules-window.ts`, registered from main.ts) | a `ResizeObserver` on `<html>`, published on a 150 ms trailing edge (the seam) | Facts `windowWidth` / `windowHeight` in logical px (`innerWidth` / `innerHeight`), kind number, unit px, section Window; the `surface` fact stays the deliberate choice. One recheck per settled resize, none per frame |

*Desk tests.* (1) Recipe on, restart → the last song plays after the boot cover; `npm run
dev:app -- --tray` → nothing plays, `rule: app.open skipped`. (2) Queue on screen, rule *When
the Queue button is pressed… → Keep*: the press does nothing; rule off: the flip. (3) From
the Queue's right-click Go to Artist with a rule *Open in the Library*: the Library card comes
drilled to the artist; with none: Search as today; the row's three values. (4) Nothing
playing, press shuffle: the library plays shuffled through the rule (`rule` log line); the row
on *noop*: nothing. (5) `__rules.facts().windowWidth` follows a drag of the window edge, one
change per settled resize; a rule *While Window width is below 500 → Keep on top*.


**The last two cancels, with music (2026-09-27).**
- *A station is about to come back* + Keep: the album's last song playing, the Discovery station
  added to the queue from the Radio card ("Will resume after"), a seek to the end. The rule ran,
  the player logged `resumeStation … kept: rule`, and no station played.
- *The weekly Replay is about to be made* + Keep: this week's Replay marked due in dev storage, a
  reload; eight seconds later the log read "weekly kept back by a rule". Found: the Replay module
  registered its event only when its check ran, so for the first eight seconds a rule on it read
  "unknown event"; rules-app.ts now registers it at start. (A first try whose paste had not
  landed made a real rolling Replay in the dev app; dev data only.)
- Session B's finding, *Explicit* false for "Only in the West" (Yeek): neither the track store
  (a catalog song) nor MusicKit's item carries a rating, and the app's own row shows no E. Apple
  sends a rating only for a marked song, so false is the right reading; the album cover wears
  the badge for its other songs.
- The chip's hint now reads "…give it back to your rule "Jazz blue"." (session B's catch).

### 10.2 As built (2026-09-27, afternoon; one session built all five)

> **Part:** built · 2026-09-27 · desk test run by Claude (below); his look is open

Where this and §10.1 differ, this is the code.

**His two calls at the build.** (1) The Queue's cancel event: §10 assumed the Queue button still
flips the two slots when the Queue is on screen. It does not (layout.ts does nothing then, since
ARTIST-VIEW.md §6). He named his case: Max, Playlists grown, the Queue pressed. (2) The idle
shuffle rule's condition: **No song loaded** (today's behavior), not "the music is not playing".

| Step | As built |
|---|---|
| 1 | Recipe **Play on launch** (`launch`, rules-recipes.ts): When *The app opens* → *Play*, off. `emitAppOpen` asks `isVisible()` first; a hidden start logs `rule {event: app.open, reason: "skipped (tray)"}` and emits nothing. |
| 2 | `queue.summon`, *The Queue is about to replace a card or end a grow* (cancel, Keep only). layout.ts `onCardRequest` asks it only where a Queue request changes the layout: the grow over the Queue ends, or the Queue takes a slot (Midi, Mini). In = the grown card or the card it would replace; `grown` names the grow. |
| 3 | `goto.artist` / `goto.album`, *You press Go to Artist / Album* (In = the card the menu opened in, `context-menu.ts menuCard()`). Their only Do is **Open it in** *Library* / *Search* (`openIn`); `rules.ts decided()` returns it to the site, as `cancelled()` does Keep. `go-to.ts goTo()` does the rest: each Go to item has a Library way and a Search way, and a missing way falls back to the other. Settings › Menus, hints and notices › **Go to opens** (`goToTarget`: Where it fits · Search · Library) makes `row:goToTarget:artist/album`; *Where it fits* makes none. |
| 4 | `shuffle.press`, *You press shuffle*: player.ts `onShufflePress`, fired in `shuffleQueue` (a press that shuffles; a press that turns the mode off is not one). The idle branch moved to `shuffleLibrary()`, run only by the action *Play the library shuffled*. `shuffleIdle` = Library makes `row:shuffleIdle`: `if loaded is false`. New fact **A song is loaded** (`loaded`). |
| 5 | `src/rules-window.ts`: `windowWidth` / `windowHeight` (px, Window section), one ResizeObserver on `<html>`, 150 ms trailing edge, a change only when the size moved. |

**Decided inside his choices (for his review).**
- In Max, a grow never covers the Queue: Fill covers the four content slots only. So his exact
  case (Playlists grown, a press in the Queue) is `grow.outside`, which his rule "Keep
  playlists" already covers. The new event matters in Midi and Mini, and for the Queue's own
  grow over Now Playing.
- The Go to events offer only *Open it in*, as a cancel event offers only Keep: another Do there
  would win first and leave the menu doing nothing.
- *Library* from another card summons the Library card drilled (`requestLibraryDrill`), for a
  song or album you have. A song you do not have goes to Search even when the rule says Library.
- An artist you have still opens in the Library from any card under *Where it fits* (that was
  already the artist menu's behavior).
- In the Library card a song with two credited artists keeps its submenu of names; elsewhere the
  Library way uses the first name.
- The Settings row sits in Menus, hints and notices (§10.1 said "Menus"); it wears the New mark.
- Found on the way: an agent's *Play a station* rule stored the station's id, which the action
  could not read ("its station is gone"), and the agent's word list had no stations. Both
  fixed: the action finds an id in the stations the Radio card holds; the words list them.

**Desk test run (2026-09-27, Claude, dev:app, presses through the UI).**
- The §2 and §8 steps left open, with music: the clock (a rule at 12:30 PM showed its note at
  12:30:00); *Diary score* (a song scored 8 ran "Diary score ≥ 7"; the plays rule lost to it);
  *Times played* (0, then 1 on the replay); *Play a station* (a pause started Apple Music Chill;
  MusicKit's first shape failed and the player's fallback played it).
- (1) Recipe on through its switch; a reload resumed the paused song
  (`recipe:launch:0 applied`). A `--hidden` start: `skipped (tray)`, nothing played.
- (2) Midi, the Queue off screen, Keep rule: the Show queue button did nothing (In =
  Settings). Rule gone: the Queue took Settings' slot. Diary grown over the Queue, a Keep rule
  *if Grown card is Diary*: the grow stayed; rule gone: it collapsed.
- (3) *Library*: Go to Album on Casio in the Queue opened the Library at *For Ever*;
  Sunshine (not in your library) fell back to Search. *Search*: Go to Artist on a Library row
  opened Search. *Where it fits*: the Library in place from the Library, Search from the Queue.
- (4) Nothing loaded: the Shuffle square played 3,963 songs shuffled through `row:shuffleIdle`.
  *Nothing*: the press turned shuffle on and nothing played.
- (5) 1,100 → 495 → 1,100 px (Max → Midi → Max): one check each way; *While Window width is
  below 500 → Keep on top* held and let go.
- Everything made for the test was removed; the settings went back as they were.

## 11. The album color facts (his call, 2026-09-27)

> **Part:** built · 2026-09-27 · desk test run by Claude (below); his look is open

His ask: change the look to match the album cover. His call: the facts now; the Album theme
itself goes into Skinz, built with it later ([SKINZ.md](SKINZ.md) §12).

- **Album color** (`albumColor`, Playback): the cover's one color (`albumColor`,
  ALBUM-COLOR.md §The album's one color) as a word: Red · Orange · Brown · Yellow · Green · Teal
  · Blue · Purple · Pink · Grey.
- **The cover is light / dark** (`albumLight`, Playback): Apple's `bg`, the art's main field,
  at OKLCH lightness 0.62 or more.
- **Cost:** none. It reads the palette the Now Playing card already asks for
  (`lookupPalette` shares its cache and its in-flight lookup), once per cover, and only while a
  rule reads either fact. The pure part is `colorName` / `albumWords` in album-slots.ts
  (`tests/album-words.test.ts`); the registration is rules-facts.ts.
- **It suits a While rule.** The palette lands a moment after the song starts; the fact's seam
  rechecks then. A When *The next song plays* rule can read the cover before it lands.

**Decided inside his choice (for his review).**
- **The words and the bands.** OKLCH hue, measured on the pure colors: red from 10°, orange
  45°, yellow 80°, green 125°, teal 170°, blue 225°, purple 280°, pink 320°. Grey below chroma
  0.04 (the aurora's own grey line). Brown = an orange or yellow with lightness under 0.5.
- **Light or dark reads the main field, not the colorful one.** A dark cover with a bright red
  logo is "red" and "dark".

**Desk test (Claude, dev:app).** *While Album color is orange → Use theme Moonlight*: Casio
(*For Ever*, main color `#e0a137`) held Moonlight; Sunshine (orange, dark) kept it; Blue Train
(teal, dark) let go, and the look schedule's Lilac came back. **Found:** *For Ever*'s amber sits
at 76°, just under yellow's line (80°), so a golden cover reads "orange". The line is a choice
for him (below).

**Open for him:** where the orange / yellow line sits. At 80° amber and gold read orange; at
about 72° they read yellow and CSS `orange` (#ffa500, 71°) stays orange.

### 11.1 The recipe Live Theming (his ask, 2026-09-27)

> **Part:** built · 2026-09-27 · desk test run by Claude (below); the mapping is for his review

The theme follows the album cover, until the Album theme (SKINZ.md §12) can do it with the
cover's own colors. A recipe (rules-recipes.ts `LIVE_THEMES`), off by default like the others:
six While rules, one per theme, each *While the cover is light / dark and Album color is … →
Use theme …*, `onHand: next`. **His call (2026-09-27): light or dark picks the theme's
lightness**; the color picks the nearest of the three, by the theme's own hint.

**How the change shows (2026-09-27):** a rule's theme change crossfades in place in 500 ms, with
no cover ([UX-COVERUPS.md §6c](../architecture/UX-COVERUPS.md)). The last cover's color stands
until the new one lands, so a song changes the theme once. The recipe's description says it
works best with a GPU.

| Cover color | A light cover | A dark cover |
|---|---|---|
| Red | Sepia | Black & Red |
| Orange, Brown, Yellow | Sepia | Black & Yellow |
| Green, Teal | Green | Moonlight |
| Blue, Grey, Purple | Lilac | Moonlight |
| Pink | Lilac | Black & Red |

- **Every color, light or dark, picks exactly one theme of its own lightness**
  (`tests/album-words.test.ts`).
- **With no song or no palette** no rule holds: your theme shows, or the look schedule's. The
  recipe sits above the built-in rules, so while a cover plays it beats the look schedule.
- **A hand theme pick** holds until the next cover of another color (the rule chip shows it).
  Since 2026-09-29 (RULES.md §18b) "another color" means a cover for which that rule's condition
  is false: a red cover after an orange one (both Sepia's words) keeps your pick; a song with no
  palette keeps it too (undecided is not a change).
- **The skin does not change.** Only the theme is a color; a rule of your own can add a skin.
- **To change the mapping:** *Duplicate into your rules* on a recipe line, then edit the copy.

*Desk test (Claude, dev:app, the switch pressed in Rulez).* Casio (orange, light) → Sepia;
Blue Train (teal, dark) → Moonlight; *So Far So Good* (purple, light) → Lilac; Sunshine
(orange, dark) → Black & Yellow. Each read `recipe:live:<n>` on `key:theme`.

**For his review:** the color half of the table (Grey could leave the theme alone).

## 12. Moving a rule, and the hover box (his calls, 2026-09-27)

> **Part:** built · 2026-09-27 · desk test run by Claude (below); his hand test is open

His report: dragging a rule by its six-dot grip was finicky and often did nothing. His calls:
**no grip**; move a rule the way songs and folders move elsewhere, **hold, then move**; and a
**hover box** with the name on line 1 and the description on line 2, because the sentence is
cut off.

- **The move** is the one drag primitive, `rowDrag` in its hold mode (row-drag.ts; a Playlists
  folder uses the same): press the row's bar and hold still (`--hold-ms`, 400 ms; the bar swells),
  then move. A quick press is still the click that opens the row; a move before the hold is a
  scroll. A ghost follows the pointer and a line shows where the rule lands. Your rules sit in
  their own box (`.rulez__mine`), so the line never lands among the recipes. An open row folds
  as it lifts, so one bar travels, and opens again after the drop.
- **The hover box** is a row shape in hint.ts (`.rulez__bar`): line 1 the name, line 2 the
  whole sentence (or why the rule does not run), and your Desc, when you wrote one, as a third
  line (`data-hint-note`). It shows under the same rule as a song row: when a line is cut off.
- **The sentence ends in "…" now** (`.rulez__said`): it sat in a flex box, which cut it with no
  ellipsis, and the hover check could not see it was cut.

**Found on the way.** The card redrew its whole list about 4 times a second: Sound's seam fires
with the audio worklet's status, the engine rechecked each time, and Rulez redrew after each
check. A redraw under the pointer closed the hover box before it opened, and could drop a
held press. Fixed twice: the engine rechecks only when a seam's fact really changed (RULES.md
§10), and Rulez skips a redraw whose HTML is the same. It also holds redraws while a row is
pressed or moving. Measured: 20 redraws in 5 s before, 0 after.

**Decided inside his calls (for his review).**
- The lead column stays as an empty space on your rows, so your names line up with the locked
  rows' lock glyphs.
- Only the bar lifts a rule: a press in the open sentence (a blank, a field) never starts a move.
- The hover box's second line is the sentence the row shows (his "description"); a Desc you
  wrote is the third line.

*Desk test (Claude, dev:app, pointer events on the real rows).* A 20 px move before the hold:
nothing moved. Hold 550 ms, then move to the top: the bar swelled, a ghost and a line showed,
"Keep playlists" went from third to first. An open row held and moved to the bottom: it folded
as it lifted and opened again after the drop. A hover on the cut sentence: the box read "Keep
playlists" / the whole sentence. **His:** the move with a real mouse, and the feel of 400 ms.

## 13. Cases: one rule, many branches (to talk through)

> **Part:** idea · 2026-09-27 · his call: talk it through before any build

His question: what would it take for one rule to hold every branch with a clean UI? Live
Theming (§11.1) is six rules today, six locked lines, because a rule has one condition and one
Do.

**The shape.** A rule with an ordered list of **cases**, each a condition and a value; the first
case that holds wins; an optional *otherwise* last.

> **While a song plays, DeetsMusic uses theme:**
> · if the cover is light and the album color is Red, Orange, Brown or Yellow → **Sepia**
> · … five more cases …
> · otherwise → **your own theme**

**The engine stays small.** At the rebuild a rule with cases becomes one internal rule per case
(pure, tested), so `resolveState` and `pickMoment` do not change. Around it: a `cases` field
(optional; the store stays v1), a hand change holds the whole rule, the snapshots, *Try* and
the Logs name the case, *who wins* compares whole rules, and the words say "uses a theme by
album cover (6 cases)".

**The UI is most of the work.** The collapsed row as today, with that summary. The open row: the
Do blank once at the top, then one line per case (the condition blocks, compact, and one value
blank), a +, a hold to move a case, *otherwise* last, and the live line naming the case that
holds now. The build checklist: a new row shape, `--rulez-case-*` alias tokens in the menu-row
family, `enterRows`, hints. Also: the agent's verb (`add` / `show` with cases), paste and
import, the recipe viewer (one locked line per recipe), Live Theming rewritten as one rule.
About one sitting, as big as the §6 sentence.

**To talk through** (my first recommendation in each):
1. **Same Do for every case, a value per case**, or a different Do per case. The first keeps the
   UI clean and covers every "pick one of N" rule.
2. **Both kinds of rule** (While and When), or While first. The expansion is the same code.
3. **Otherwise:** offered, with "your own value" as its default, or not at all.

## 14. One row per recipe (his call, 2026-09-27)

> **Part:** built · 2026-09-27 · desk test run by Claude (below); his look decides custom recipes

His report: Live Theming showed six locked lines and one switch, on the first. §8 had put a
recipe's switch on its first rule; with six rules the other five looked like they lost theirs.
His call: **one row per recipe**. He decides custom recipes (grouping your own rules) after he
sees how it looks (§13 has the related idea, cases).

**Not a new concept in the engine.** A recipe was already one group: an id, a name, a
description, its rules, and one entry in `Stored.recipes`. Only the drawing changes; the engine
and the store do not, and nothing migrates.

- **The row** (`recipeRowHTML`): the lock glyph, the recipe's name, its description as the
  summary line (the hover box shows it whole), the one switch, the ⋯. A recipe that is off is
  dimmed. The row carries its first rule's id, so the menu (Turn on / off, Try, Duplicate into
  your rules, Copy as text) and the switch act on the whole recipe as before.
- **Open** (a press on the row; one row open at a time, yours included): a line "Made by
  DeetsMusic. *N* rules, read-only: Duplicate into your rules to change them.", then each rule:
  its part name ("Light warm covers"), its sentence, and the live line (*Holds now* /
  *Would not run now: …*), or "Turn the recipe on to use it." while it is off.
- **Who wins:** the row shows the first of its rules that a rule above beats.
- The built-in rules keep one locked line each (`lockedRowHTML`): each is its own Settings row.
- **The who-wins line names the recipe** (`winsHTML`): *Also matches when the recipe "Live
  Theming" does. The recipe "Live Theming" runs first.* Found at the desk: it named one part
  ("light warm covers") where any of the six can be first, and its second sentence started in
  lower case. The Logs view still names the part that ran.

*Desk test (Claude, dev:app, handed over by the theme-switching session).* Six recipe rows, one
switch each; Live Theming On, the others Off and dimmed. A press opened Live Theming to its six
rules; "Light cool covers" read *Holds now* for the playing cover (Break Away, Lilac on screen),
the other five *Would not run now: …*. Its switch turned all six off (the row dimmed, 0 live)
and on again (6 live); it was left on, as he had it.

## 15. Next: a full pass on custom rules (his call, 2026-09-27)

> **Part:** project · 2026-09-27 · his call: one design pass, then he decides; nothing built

After seeing one row per recipe (§14), his call: "good enough for now". Before any more building
on grouping, one pass designs **custom rules** as a whole, and he decides from it. The pass
covers, together:

- **How a group of rules shows:** a recipe is one row that opens to its rules (§14). Should
  your own rules group the same way (a recipe of your own, one switch for several rules)?
- **Cases** (§13): one rule with many branches. Is a case list a group, or a group a case list?
  Live Theming is the test: today six rules under one recipe row; with cases, one rule.
- **Custom recipes:** making, naming, ordering and sharing your own; where Duplicate into your
  rules leads (six loose rules today).
- **What stays the same:** the engine's rule shape and evaluation (a group or a case list
  expands to plain rules, §13), the store's `v: 1`, the agent's verb.

The questions of §13 (same Do per case, both kinds, *otherwise*) are part of this pass.

**Layout (added 2026-09-27).** The Do words for the part states and the artist order (LAYOUT.md
§4, item 6) are designed in this pass: "Shuffle is Hidden", "the artist view shows Albums first".

## 16. Cruisin and Pro: recipes in Settings, and a start pick (his calls, 2026-09-28)

> **Part:** designed · 2026-09-28 · his calls below; the start pick's forks are HOP-IN.md §4; nothing built

**The terms** (Cruisin, Pro) are defined in [HOP-IN.md](HOP-IN.md).

**The problem.** Rulez is a heavy feature. Many users will never want to build a rule. But the
effect of a recipe (a quieter night, Focus, Battery saver) is useful to everyone. Today a user
turns on a recipe only in the Rulez card, and that card is in Max only, behind a card title.

### 16.1 His calls

1. **No mode, one gate.** The app is the same app for every user, with one exception: **the
   Rulez card is offered only when the Settings row says Pro** (second round, 2026-09-28).
   Everything else is the same for Cruisin and Pro. The gate has a precedent: `rewindCard`
   already takes the Rewind card out of the card picker (`poolFor`, layout.ts). Rulez adds the
   same test on the new key, beside its `maxOnly` test.
2. **Recipes in Settings.** A Recipes section in Settings: one switch per recipe, and the
   recipe's `desc` as its one-sentence line. A user turns on an effect without reading a rule.
3. **The Recipes section sits right after Tips** (fourth round, 2026-09-28): it is the Cruisin
   entry point.
4. **A start pick, on a welcome screen before sign-in.** The user selects Cruisin or Pro; the
   pick pre-sets settings once. The screen, the two presets and their forks are
   [HOP-IN.md](HOP-IN.md).
5. **Switching to Cruisin keeps your rules running** (third round). Only the Rulez card leaves
   the card picker. The gate never changes what the app does; the recipes in Settings still work.
6. **Ctrl + Space finds the Rulez card as usual, under Cruisin too** (third round). The gate is
   on the card picker only. For a future gated card, hiding it from Ctrl + Space too is still
   open; decide per card.

### 16.2 The Recipes section, against the code

- **One truth.** A Settings switch calls `setRecipe(id, on)` (rules.ts), the same store
  (`rules.recipes`) as the recipe rows in the Rulez card (§14). A switch in one place shows in
  the other. No new key, no schema change, nothing migrates.
- **The rows come from `RECIPES`** (rules-recipes.ts) plus Live Theming, in that list's order.
  A new recipe gets its Settings row with no Settings code.
- **What each row shows:** the name, the `desc` line, the switch. The locked rules and the
  who-wins line stay in the Rulez card. A link line at the end of the section, *Make your own in
  the Rulez card (Max)*, is the step up to Pro.
- **The checklist (CLAUDE.md › Working style):** a `NEW_MARKS` line for the section (5a); a
  hint per row in the ONBOARDING.md §1 ledger (3); Compass reaches store-backed rows by itself
  (9). The agent's `rules` verb (§7) lists recipe rules but cannot turn a recipe on or off
  today (agent-rules.ts only names the source). A recipe switch for the agent is part of this
  build: one verb action over `setRecipe`, a line in AGENT.md.
- **The `desc` lines are now user copy for a stranger.** Each one is read again before build, in
  the Tips voice (ONBOARDING.md §3), with no rule words ("state", "moment", "while").

## 17. The motion and UX review, and its fixes (2026-10-06)

> **Part:** built · 2026-10-06 · Claude's shots check passed; his hand test open

His ask: look at the card as a motion and UX designer, as a beginner, an intermediate user, a
pro, a tech-savvy user and a user who does not know the card exists. Three walks with the
shots runner on the web demo (`shots/scratch/rulez-ux.json`, `-ux2`, `-ux3`).

### 17.1 What the review found

- **Bugs.** (1) One Esc to close a condition menu also folded the open rule and took Rulez out
  of Fill: the context menu closed itself in the capture phase, then list-keys' Back and the
  grow's Esc both ran. (2) After you picked When, nothing moved you to Do (§6.3 said the Do blank
  takes focus). (3) A field in a flyout (a note, a genre, a time) did not take focus. (4) Genre,
  Artist and Album saved what you typed: "Ja" + Enter made "Genre is Ja", which no song matches.
- **The first screen.** One line for you, then 18 locked rows: 7 recipes dimmed because they were
  off (read as "not available"), and 11 "Made by Settings" rows with names repeated (×4, ×2, ×2).
- **What works.** The sentence; the live line with ✓ / ✗; who wins; a draft that turns itself On
  when complete; Logs in Words and Raw.
- **Left as findings, not built** (no pick yet): the When menu opens over the line it fills;
  flyout labels wrap to two lines; Playback holds about 20 facts; a new rule is never asked for a
  name; the X and the un-fill button sit side by side; Logs › Last ran lists every "never"; Delete
  has no undo; "Copy as text" gives JSON; the recipe sentence "time is from 10:00 PM".
- **A correction.** The review said the row did not use the Settings section motion. It did: a
  Settings section's rows slide in with `enterRows` and its close is instant, as here. He then
  picked a height glide (17.2).

### 17.2 His picks, as built

| Pick | As built |
|---|---|
| Fix the four bugs | **Esc:** context-menu.ts now stops the key after it closes the menu, and card-grow.ts yields to `defaultPrevented`, so a list's Back step (list-keys.ts) is one step too (CARD-GROW.md, Esc). **When → Do:** `advance` opens the next dashed blank of a draft after a pick (When, While, Do, a While part, a While condition); a finished rule stops. A new rule glides open, then its When menu opens. **Field focus:** a flyout's field takes focus when the flyout shows (context-menu.ts, every menu). **Enter:** `resolveTyped` saves the library's spelling: the same name typed in full, else the first suggestion; names that start with the text come first; with no match it stays as typed, as the empty line says. |
| 2A: one row per Settings row, folded | `settingGroups` makes one locked row per Settings row (the rule's `row` or `fixed` source). It opens like a recipe: "Made by Settings. *N* rules, read-only.", an **Open in Settings** chip, then each rule's sentence and live line. The "Made by Settings" divider is a fold button with the shelf chevron and a count, **shut by default**; it is card memory (`settings` in the snapshot). Its rows enter with `enterRows` when it opens. *Try* tries every rule of the row. |
| Recipes at full strength | An off recipe is no longer `is-idle`; only the switch says Off. Your own off rules and drafts stay dimmed. |
| A button in an open recipe | **Duplicate into your rules** (the row menu's words) on the "Made by DeetsMusic. *N* rules, read-only." line. It is the open row's own chip (`.rulez__blank`, the Rulez cell family), so it reads as part of the sentence around it. |
| Row motion: a height glide | The open part sits in `.rulez__fold` (grid rows 0fr → 1fr, the Library search bar's glide), `--rulez-fold-dur` (= `--dur-med`) and `--rulez-fold-ease` (= `--ease-ui`). Opening one row and closing another cross in the same frames. The row's fill and border fade in the same time. The parts still enter with `enterRows`. Reduced motion: no glide. Other renders wait for the glide; when it ends the shut fold is taken out in place, so the parts' entry motion is not cut. `frames.during("rulez-row")` times it. |

**Decided inside his picks (for his review).**
- The Esc change reaches every grown card: in a grown, drilled album, Esc now goes Back first and
  the next Esc collapses (before, one Esc did both).
- A flyout's field takes focus on hover too, not only on a click.
- A Settings row opens to its rules like a recipe (before, a locked row did not open).
- A Settings row's collapsed line shows its sentences one after another (the hover box shows
  them all).
- Only "Made by Settings" folds; "Recipes" stays a plain divider.

### 17.3 Desk test

Max, Rulez open (Fill).
1. Press **+**. The new rule glides open, then the When menu opens. Pick Playback › The next song
   plays: the Do menu opens by itself.
2. Do › Window › Show a note: the field has the cursor. Type, Enter: the rule reads as one
   sentence and turns On.
3. *only if…* › Playback › Genre: type the first letters of a genre you have, press Enter: the
   condition names the whole genre.
4. Open the + of the condition, press Esc: the menu closes; the rule stays open and Rulez stays
   at Fill. Focus the rule, press Esc: the rule glides shut; Rulez stays at Fill. Esc again: Fill
   collapses.
5. Open one rule, then another: one glides shut while the other glides open; the rows below move,
   they do not jump.
6. The recipes read at full strength; each switch says Off. Open one: the **Duplicate into your
   rules** chip copies it to the top of your rules.
7. "Made by Settings" is shut, with its count. Open it: one row per Settings row ("Grow on album or
   artist" once). Open that row: four rules, each with its live line, and **Open in Settings**.
8. Close Rulez and open it again: the fold is as you left it.
9. Reduced motion (Windows › Accessibility › Animation effects off): rows open and close at once.

