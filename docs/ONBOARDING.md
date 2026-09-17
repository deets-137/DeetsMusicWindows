# Onboarding — how the app explains itself

> Three layers, cheapest first: **hover hints** on every control (§1), **right-click menus**
> everywhere a thing can be acted on (§2), and **Settings › Tips** for the gestures nothing on
> screen announces (§3). The box itself is §1a. §4 designs the fourth layer — a **first-run walk** led by the Deets and
> Happy sprites from deets.solutions — which is **not built**. §1–§3 were built 2026-09-15.

Terms used here: a **hint** is the themed box the app shows when the pointer rests on a
control (`src/hint.ts`; it replaced the native `title` tooltip on 2026-09-15). A **menu** is
the shared themed right-click popover (`src/context-menu.ts`). A **card** is one panel in the
bento (Library, Playlists, Queue, …).

## 0. The voice

Every hint and tip is written the way the Settings rows are (SETTINGS.md §3): one short
active sentence, verb first, plain words, no jargon. A hint says what the control **does**,
not what it **is** — the icon already says what it is. A second sentence only when the first
leaves a real question ("Press again: one song").

```
Reads your library from Apple Music again      ✓  verb first, says what happens
Refresh                                        ✗  the icon already says this
Re-fetches the library index from the API      ✗  jargon
```

## 1. Hover hints — the ledger

Every hint is the themed box (§1a). A screen reader gets the `aria-label`; the hint is for
the pointer. You still WRITE a hint as `title="…"` in markup or `el.title = "…"` in code —
nothing about authoring changed when the box did.

| Where | Control | Hint | Set in |
|---|---|---|---|
| Title bar | DeetsMusic (the title) | Opens the menu: theme, skin, window size, account, and Settings | index.html |
| Title menu | each Theme | Light/Dark + its two colors ("Light. Purple and mint") | index.html |
| Title menu | each Skin | one line on the idiom ("A print shop: ink on paper, square corners. The cover can be a record") | index.html |
| Title menu | Mini · NP · Midi · Max | what the window holds ("A small window: Now Playing and one card") | index.html |
| Title menu | Settings… | Shows the Settings card | index.html |
| Settings › Connections | Agents read play history | Lets a connected agent see what you played, when, and what you skipped | settings-card.ts |
| Title menu › Account | Last.fm | Connects your Last.fm account in your browser. Songs you hear go to your Last.fm profile · connected: Disconnects Last.fm. Songs you hear stop going to your profile · no key: Last.fm is not in this build of DeetsMusic | index.html / lastfm.ts |
| Title menu › Account | the Last.fm name ("Connected as *name*") | Opens your Last.fm profile in your browser | lastfm.ts |
| Settings › Last.fm | Scrobble plays · Show now playing | Sends each song to your Last.fm profile once you hear half of it or 4 minutes · Your Last.fm profile shows the song while it plays | settings-card.ts |
| Title bar | Sound (the EQ faders) | Sound: the equalizer and adaptive sound. Everything is off · on: *Sound: Vocal EQ · Match loudness · Fuller at low volume · Crossfeed* | index.html / sound-panel.ts |
| Sound panel | Compare | Hold to hear the music without the effects, at the same loudness | sound-panel.ts |
| Sound panel | i (the reading) | *This song is heavy in the bass and soft in the top end.* Click for the numbers · before 3 s of sound: *What this song's sound is like. Click for the numbers* | sound-panel.ts |
| Sound panel | Bass · Body · Voice · Detail · Air | Bass, 20–150 Hz: the kick drum and the bass guitar. Raise it for weight; lower it if the sound booms. Hold to hear only this range (and one line each for Body, Voice, Detail, Air) | sound-panel.ts |
| Sound panel | This song · What you hear (legend) | The song's own shape, averaged while it plays · The song's shape with your equalizer and adaptive sound applied | sound-panel.ts |
| Sound panel | Equalizer · Adaptive tabs | The equalizer: the curve, the sliders and the presets · Adaptive sound: even loudness between songs, a fuller sound at low volume, and a natural sound on headphones | sound-panel.ts |
| Sound panel | Reset · Undo | Puts every band back to 0 dB (the Flat preset). Undo is offered for a moment · Brings back what was there before | sound-panel.ts |
| Sound panel | Equalizer · Adaptive sound pills | Turns the equalizer on or off · Turns adaptive sound on or off. Each of the three parts below also has its own switch | sound-panel.ts |
| Sound panel | the graph · a band's dot | Click the curve to add a band. Drag a dot to move it; roll the wheel on a dot to widen or narrow it · Drag to move this band. Wheel: wider or narrower. Double-click: back to 0 dB. Delete: remove | sound-panel.ts |
| Sound panel | a graphic fader | *250 Hz: +2.0 dB.* Drag up for more, down for less | sound-panel.ts |
| Sound panel | band row: shape · On/Off · × | The band's shape. Click for the next one · Turns this band on or off without losing it · Removes this band | sound-panel.ts |
| Sound panel | ‹ › · Sliders/Dots · ⋯ | The previous / next preset · Sliders: ten fixed sliders, one per range. Dots: a dot per band on the curve, free to move · Save, rename, delete, import or copy the preset | sound-panel.ts |
| Sound panel | Save as · Rename · Delete · Import · Paste · Copy · OK | Saves the curve under a new name · Renames this saved preset · Deletes this saved preset. Click twice · Reads an Equalizer APO or AutoEq text file (Preamp and Filter lines) · Reads Equalizer APO or AutoEq text from the clipboard · Copies the preset as Equalizer APO text · Saves the name | sound-panel.ts |
| Sound panel | the two "How … decides" folds | Shows what the equalizer uses and the settings that change it · Shows what each part follows and the settings that change it | sound-panel.ts |
| Sound panel | Avoid distortion · Lower the song by ‹ › · Remember each output · × | How a boost is kept from distorting: Limiter only turns down just the loudest moments; the others lower the whole song (when needed, always, or by an amount you set) · 0.5 dB lower / higher · On: headphones, speakers and AirPlay speakers each remember their own preset · Forgets the preset for this output | sound-panel.ts |
| Sound panel | Match loudness · Fuller at low volume · Headphone crossfeed | Plays every song at about the same loudness, so you do not reach for the volume between songs · Adds bass and a little treble as you turn the volume down, because quiet music sounds thin. Gentle adds half as much as Full · On headphones, mixes a little of the left side into the right and back, as speakers in a room do. Auto: only on headphones | sound-panel.ts |
| Sound panel | Match songs to · Keep albums together · Songs not measured yet · Clear measurements · Follow the volume of · Blend amount | How loud songs are made: Standard is Apple's Sound Check level (−16 LUFS), Louder is −14 LUFS, Quieter is −18 LUFS · On: when you play an album in order, all its songs move by the same amount, so a quiet song stays quiet · A song is measured the first time you hear it. Until then: move it by your songs' usual amount, or leave it as it is · Deletes every song's loudness measurement. Each song is measured again the next time you hear most of it · App + Windows: counts the DeetsMusic volume and the Windows volume together. App only: counts the DeetsMusic volume · How much of each side goes into the other | sound-panel.ts |
| Sound panel | footer: Keep: 7 days pill · Keep · Turn all off · the meter | *Asks whether to keep the effects on Sep 23* (or: this long after you first turn one on · never · you chose to keep them). Click for the next choice · Keeps the effects and stops asking · Turns the equalizer and adaptive sound off · The limiter stops distortion by turning down only the loudest moments. Shows how much it cut, and the loudest moment, in the last half second | sound-panel.ts |
| Title bar | Sleep timer (the alarm clock) | The sleep timer. Music pauses when it runs out · armed: *Sleep in 23:14* / *Sleep at the end of this song* / *Sleep at 10:00 PM, every day* | index.html / sleep.ts |
| Sleep panel | the dial | Turn the timer to set the minutes. Music pauses when it runs out | index.html |
| Sleep panel | End of song · End of Up Next | Pauses when this song ends · Pauses when Up Next runs out | index.html |
| Sleep panel | Wind down pill | Over these last minutes the volume sinks to nothing, then the music pauses. Click for the next length | index.html |
| Sleep panel | Play out song pill | On: when the time runs out in the middle of a song, the song plays to its end first | index.html |
| Sleep panel | Every day pill · ‹ › | A sleep time that sets itself every day: at sunset, or at a time you pick. It pauses only if music is playing then · 15 minutes earlier / later | index.html |
| Sleep panel | Off / Not tonight | Turns the sleep timer off | index.html |
| Title bar | Volume bar | The volume. Drag it, or roll the wheel | index.html |
| Title bar | Mute (in the volume bar) | Turns the sound off and on | index.html |
| Settings › Window | Shrink volume bar | On: a small pill in the title bar that grows when you click it, or hover, as the menus open | settings-card.ts |
| Settings › Look and feel | Fancy scrubber | Each skin's own playhead: the Press nib, the Ocean float, the Glass lens, the charged bolt. Off: a plain handle | settings-card.ts |
| Settings › Look and feel | Fancy Glass | Glass only. A live blur behind the cards, a moving background, and four sliders. Without a graphics card: about 85% fewer frames | settings-card.ts (`GLASS_FANCY_HINT`) |
| Title bar | AirPlay square | Plays on a speaker or TV on your network · *Playing on {speaker}* while connected | index.html / airplay.ts |
| Title bar | Maximize · Minimize · Close | Fills the screen. Press again to go back · Puts the window on the taskbar · Closes DeetsMusic. With Close to tray on, it hides to the tray and keeps playing | index.html |
| Now Playing | Shuffle | Shuffles the songs after this one · *Shuffle is on. Press again to turn it off* | now-playing-card.ts (`paintModes`) |
| Now Playing | Repeat | Repeats the list, then one song, then off → Repeats the list. Press again: one song → Repeats this song. Press again: off | now-playing-card.ts (`REPEAT_HINT`) |
| Now Playing | Show queue · Show search | Shows the Queue card: what plays next · Shows the Search card: all of Apple Music | now-playing-card.ts |
| Now Playing | Previous · Play/Pause · Next | Plays the song before this one · Play / Pause (follows state) · Plays the next song | now-playing-card.ts |
| Now Playing | ♥ · + | Favorite / Unfavorite · Add to Library / In your library (follow state) | now-playing-card.ts |
| Now Playing | Mute · AirPlay (stage row) | as the title bar | now-playing-card.ts |
| Card headers | Back | Goes back one step | library-, playlists-, radio-card.ts; search-card.ts panes |
| Library | Refresh | Reads your library from Apple Music again | library-card.ts |
| Playlists | + · Web · Sync | Makes a new playlist or a new folder · Makes a playlist from an artist and the artists they make songs with · Reads your playlists from Apple Music again | playlists-card.ts |
| Playlist web panel | Start row (Artist · Song · Album) · the field · a library artist row (song or album row) · an Apple row or an earlier web's row · Search Apple Music row · the picked artist (song, album) · Reach 3 with an album seed · Keep · Temp · the days button · Reach row · Size row · Prefer row · a genre chip · Retry · Read again · Playlist name · Make playlist | Start the web from an artist, a song or an album · Finds an artist in your library, or searches Apple Music (Finds a song… / Finds an album…) · In your library. Starts the web here · Starts the web here · Searches Apple Music for this name (song, album: …for this title) · The web starts here. Type to pick another artist (song, album) · An album starts with many artists, so its web reaches 2 at most · Keeps the playlist until you delete it · Deletes the playlist *7 days* after you last play it. Right-click the playlist to keep it · Press for *30 days*, right-click for *5 days* · 1 reaches the artist's collaborators. Each step reaches one circle further · Songs in the new playlist · Familiar puts your songs first. Discover puts songs you don't have first · (a genre chip, written again on every change) *66 R&B/Soul songs in the web.* Pick it: *44* go in, with *6* by *Artist* / *44* go in, with *6* by *Artist*. Press again to drop it / Add it: *50* go in, with *8* by *Artist* (Web only: ", with all of *Artist*'s songs") · Reads only the artists that didn't load · Reads this web from Apple Music again. Use it when an artist has new songs · Names the new playlist · Makes the playlist and opens it | web.ts |
| Radio | Refresh | Reads the stations from Apple Music again | radio-card.ts |
| Search | Clear · Filter | Clears the search · Picks which kinds of results show: songs, albums, artists, playlists, stations | search-card.ts |
| Search | recent-term pin | Pin / Unpin | search-card.ts (pre-existing) |
| Any list | Sort · View · magnifier | Changes the order of this list · Changes what the list groups by and how big the rows are · Finds a name in this list | collection-card.ts |
| Sort popover | ↑ · ↓ | First to last: A to Z, newest first · Last to first: Z to A, oldest first | collection-card.ts |
| View popover | density icons | Rows: one line each · Small tiles · Large tiles | collection-card.ts |
| Any list | Play · Shuffle row | Play these songs in this order · Shuffle these songs (a context can override: `ActionTitles`). With no songs yet the row is disabled, and the hint moves to the row itself: *Add a song to play this list* (a disabled button shows no tooltip) | collection-card.ts |
| Any list | Favorites filter pill | Favorites only | collection-card.ts (pre-existing) |
| Hero | cover button | Opens the menu for this cover | collection-card.ts |
| History | skip mark | You skipped this one (the Next glyph on a song you cut short) | history-card.ts |
| Song rows (2026-09-17): Search, Playlists (Lines), Queue rows + hero, History rows + hero | the Add-to-Library square (hover) | Add to Library · *In your library* (only with Show ✓ on songs you have on) | add-square.ts |
| Rewind | Make playlist | A playlist of this window's top songs, filed under Replay | rewind-card.ts (pre-existing) |
| Settings | every row and action | the row hint (SETTINGS.md §3) | settings-card.ts (pre-existing) |
| Tray panel | DeetsMusic · Hide · Previous · Play/Pause · Next · Mute · + | Opens the full DeetsMusic window · Hides this panel · as Now Playing · the + shows the song it would add | tray.html / tray.ts |
| Card gaps (2026-09-16, CARD-GROW.md) | an edge zone | *Widen Library over Search* · *Make Library taller, over Playlists* · *Fill the window with Library* · on a grown card's outer zone: *Collapse Library back to its place* | card-grow.ts (`growHint` / `collapseHint`) |
| Card header | the Grow button (hover-only) | the zone text for the direction it takes: *Widen Library over Search* → *Fill the window with Library* → *Collapse Library back to its place* | card-grow.ts |
| Card header | Pin (while grown, with Collapse on outside click on) | Keeps this card open when you click outside it · pinned: Lets a click outside collapse this card again | card-grow.ts |
| Grown song list | a column header | *Sorts by artist. Click again to turn it around* (Title, Artist, Album, Length, Genre, Year, Plays, #) | collection-card.ts (`colsHTML`) |
| Grown list | a rail letter | *Jump to M* · *Jump to numbers and symbols* · an empty letter: `aria-label` *No M here* | collection-card.ts (`syncRail`) |
| Settings › Window | Grow cards from edges · Collapse on outside click · Grown card on card pick | Click the gap beside a card to open it over its neighbor. Hover a card's title for the button · A click outside a grown card collapses it. Pin holds it open · Pick another card in a grown card's title: it keeps the size, or collapses first | settings-card.ts |

**Rule for new controls:** an icon-only button gets an `aria-label` *and* a `title`. A button
with a visible word gets a `title` only when the word leaves a question (Sort, View). A control
whose meaning changes with state updates `title` where it updates `aria-label`.

Not hinted on purpose: text labels that say it all (the theme names in the Settings look
row, the Sort keys, the Group-by keys, the Account row) and the scrubbers. List rows have no
written hint either — they get the row hint instead (§1a).

## 1a. The hint box — one engine, adopted not wired

Built 2026-09-15. `src/hint.ts` + `src/styles/hint.css` + the `--hint-*` skin tokens. It
replaced the native `title` tooltip everywhere: the Windows box could not be themed, delayed,
or given a second line, so a cut-off song name had nowhere to go.

**It is central by adoption.** No call site was edited for it. On boot the engine sweeps the
page, moves every `title` value to `data-hint`, and REMOVES the attribute, so Windows never
draws its own box. A `MutationObserver` (`subtree` + `attributeFilter: ["title"]`) does the
same for every element added later and every later `title` write, so the state-driven hints
(Play/Pause, Favorite/Unfavorite, the AirPlay square) keep working untouched. Both webviews
run it: `main.ts` and `tray.ts`.

**Two kinds of hint.**

| Kind | Where it comes from | Shape |
|---|---|---|
| Written | what a `title` said | one line, the author's words |
| Row | read off a list row itself | the name, and the line under it (a song's artist) |

Nobody authors a row hint. `SHAPES` in hint.ts lists the row and tile shapes the cards build
— `.lib-row`, `.lib-tile`, `.lib-hero`, `.qrow`, `.qnow`, `.search__song`, `.search__row` (a Search
drill pane's song list; missing until 2026-09-17), `.search__tile`,
`.search__artist`, `.np` — each with its title span and its sub span, so one delegated handler
covers Library, Search, Queue, Rewind, History, Home, the Artist shelves and Now Playing.
**Add a new row shape to that table, not a new listener.** The deeper element wins: the Add
button inside a song row still says *Add to Library*.

**Three settings** (Settings › Look and feel, beside Open menus on hover):

| Row | Choices | Default |
|---|---|---|
| Show hover hints | on / off — off silences both kinds | on |
| Hints appear after | A moment (250 ms) · A pause (600) · A while (1100) | A pause |
| Name songs on hover | Always · Cut off · Never | Always |

A row always waits 1.6× the chosen delay: scanning a list must stay quiet. Moving to another
control within 400 ms of a hint closing shows the next one at once (`WARM_MS`).

**Behaviour worth knowing.** The box is `pointer-events: none` and sits at z 95 — above a
toast (90), below a menu or picker (100). A control **inside** a pop panel, menu, flyout or picker gets `.hint--over` (z 105), so its own panel does not cover its hint (2026-09-16, the web panel). It hangs under the anchor, centred on the pointer's
x, and flips above when there is no room below. It hides on press, scroll, resize, Escape, and
when its row is re-rendered away; a pressed control stays quiet until the pointer moves off it.
Touch pointers get nothing. Focus shows it only on `:focus-visible`, so it follows the keyboard
and not the mouse. Under reduced motion it appears without the rise. Where an element had a
`title` and no accessible name of its own, adoption promotes the hint to `aria-label`, so
removing the attribute takes nothing from a screen reader.

## 2. Right-click — the coverage table

One shared menu, cursor-anchored; the native menu is blocked everywhere except text fields
(Cut / Copy / Paste / Select All, `browser-defaults.ts`). The song menu has one shape wherever
a song appears (`trackMenu`, library-card.ts).

| Surface | Item | Menu |
|---|---|---|
| Library | song | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist (▸ when several) · Go to Album · Copy Link · Start Station · Favorite |
| Library | album tile | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Copy Link |
| Library | artist tile | the album menu shape on the artist's songs |
| Playlists | playlist | Rename (field, hand-made only) · Keep Playlist (a temporary web playlist, 2026-09-17) · Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Move to Folder ▸ · Import to Edit (Apple) · Set/Change Cover… ▸ · Delete Playlist (local) |
| Playlists | song in a playlist | the song menu + Add to Library · Remove from Playlist (hand-made) |
| Playlists | folder header | Rename (field) · Delete Folder |
| Playlists | hero cover | Rename · Keep Playlist (temporary) · the cover items · Apple Music ▸ |
| Playlist web panel | the days button of Temp \| N days (2026-09-17) | no menu: a right-click steps the days back (30 → 7 → 5 → 3 → 1 → 30); a press steps forward |
| Queue | upcoming row | Play Now · Move to Top · Move to Bottom · Remove · Go to Artist · Go to Album · Copy Link · Start Station · Add to Library · Favorite |
| Queue | now hero | Go to Artist · Go to Album · Copy Link · Start Station · Add to Library · Favorite · Stop Station |
| Queue | station row | Stop Station / Don't resume |
| Now Playing | cover · title · artist | the Queue now-hero menu |
| History · Rewind | row | Play Now · Play Next · Add to Queue (+ Go to Artist / Album, links where a catalog id exists) |
| Search | song · album · playlist · artist | the song menu · the album menu (+ Add to Library) · the playlist menu · Go to Artist · Start Station |
| Search · Radio | **station** (2026-09-15) | Play Now · Add to Queue (plays when the queue runs dry) · Copy Link. A station also drags: to the Queue card (after the queue) or Now Playing (now) |
| Artist view | shelf playlist | Play Now · Play Next · Add to Queue · Add to Playlist ▸ |
| Settings | My reports row | Open · Copy link · Close · Clear |
| **Tray panel** | song (2026-09-15) | Add to Library · Favorite / Unfavorite · Copy Link |
| **Card header** | the title, or the Grow button (2026-09-16, CARD-GROW.md) | Grow ▸ (*Right, over Search* · *Down, over Playlists* — the directions that exist in this slot) · Fill (Max) · while grown: Pin / Unpin (with Collapse on outside click on) · Collapse |

Nothing opens on: the title bar, empty card space, list shelf headers, the Sort / View
popovers. That is fine — but a "what can I do here" menu on empty space is a future option.

## 3. Settings › Tips (built)

The first Settings section, collapsed by default, six two-line notes: the gesture in the
text color, why to try it in the subtext color (`TIPS` in settings-card.ts, `.set__tip` in
settings.css). **It is not a manual.** It teaches the habits that let a person find the rest
alone — *hover anything*, *right-click anything*, *drag anything*, *click your way in*, the
title menu, and *close is not quit* (shown only while Close to tray is on, its default) —
and tells them it is safe ("Nothing in it can break", "Nothing is permanent"). The menu verbs are not listed there; the menus show them. When a
gesture is added to the app (not a verb), add a note.

## 4. The first-run walk — designed, not built

**The idea (yours, 2026-09-15):** the Deets and Happy sprites from deets.solutions lead a
new user through the app on the first launch. Deets (the person, 32×64 a frame) points and
talks; Happy (the dog, 32×32) walks along and sits while a step waits.

### 4.1 The art

Copied from `DeetsSolutions/assets/sprites/` (the site copies them from the game repo; keep
the same filenames so a redraw is a drop-in):

| File | Size | Frames | Use |
|---|---|---|---|
| `deets/idle_down.png` | 32×64 | 1 | Deets standing, facing the viewer — the "speaker" pose next to a tip |
| `deets/walk_side.png` | 128×64 | 4 | Deets walking to the next stop |
| `happy/idle_down.png` | 32×32 | 1 | Happy standing |
| `happy/sit_side.png` | 32×32 | 1 | Happy sitting — the "waiting for you" pose |
| `happy/walk_side.png` | 128×32 | 4 | Happy trailing Deets |

Rendered at 2× with `image-rendering: pixelated`; the walk cycle is the site's own rule —
`steps(4)` at 7 fps (`0.571s`), `background-position-x` to `−4 × frame width` (chrome.css
"Sprite walkers"). The side strips face **left**; mirror with `scaleX(-1)` for rightward
travel, `transform-origin: 50% 100%` so the feet stay on the floor line. The sprites are
copied into `src/assets/sprites/` (the bundle carries them; nothing is fetched).

### 4.2 The shape

A **walk** is a short list of **stops**. Each stop is one thing on screen, one sentence, and
one thing to try. The sprites stand at the stop; a speech card (the toast surface, `sticky`,
one **Got it** button and one **Skip the tour**) holds the sentence.

```
                ┌───────────────────────────────────────┐
   ⌈Deets⌉      │ Right-click a song for more: Play Next,│
   ⌊idle ⌋ 🐕   │ Add to Playlist, Go to Artist.         │
                │                     [Skip]   [Got it]  │
                └───────────────────────────────────────┘
        ▲ the card the stop is about gets the row flash (`is-flash`, settings.css)
```

Between stops Deets **walks** along the bottom edge of the window to the next card (Happy
trails, then sits when the card arrives); the speech card slides to follow. Under
`prefers-reduced-motion` the sprites are placed, not walked, and the card snaps.

### 4.3 The stops (draft — six, under a minute)

| # | Where the sprites stand | The sentence | Try it |
|---|---|---|---|
| 1 | under the title | "This is DeetsMusic. Click the name for themes, skins, and the window size." | opens the title menu once |
| 2 | under Now Playing | "Play, pause, skip. Right-click the cover for the artist, the album, or a station." | — |
| 3 | under Library | "Your music. Sort and View change the order and the size. The magnifier finds a name." | — |
| 4 | under a song row | "Right-click any song: Play Next, Add to Playlist, Copy Link." | opens the menu on the first row |
| 5 | between two cards | "Drag a song onto Now Playing to play it, or onto a playlist to add it." | — |
| 6 | the tray corner | "Close hides DeetsMusic to the tray. The music keeps playing. The tray icon brings it back." | — |

Stop 2 and 3 adapt to the surface: in Mini there is one card, so the walk visits Now Playing,
then swaps the slot to Library for stop 3 (`requestCard`). In the player view (NP) the walk
is stops 1, 2, 6 only.

### 4.4 When it runs, and how it stops

- **Once, on the first launch after sign-in**, when the library has loaded (an empty bento has
  nothing to point at). Never on a launch that resumes playback.
- Keyed by exe path like every one-shot flag (dev and the installed app share settings —
  `deetsmusic-dev-installed-shared-settings`): `deets.notice.walk.<exeHash>`.
- **Skip the tour** ends it and marks it seen. **Got it** advances. Escape = Skip. Any click
  outside the speech card = Skip (the user wants to use the app, not read).
- Settings › Tips gets a ninth row: **Show the tour again** (an action half), so a user who
  skipped can come back. The Reset › Everything group clears the seen flag.
- The agent never starts it (a walk under an agent-driven session would confuse both).

### 4.5 Build order and cost

1. Copy the five sprite files; a `.walker` block in styles.css with the site's cycle rule
   (skin tokens for the floor offset and the 2× scale; no literal px).
2. `src/walk.ts`: the stop list, the sprite element pair, the Web Animations travel between
   stops, the speech card via `toast()` (`sticky`, `onceKey` off — the walk owns its flag).
3. The two hooks: the first-launch trigger in main.ts after the library load; the Tips row.
4. Reduced-motion and the three surfaces.

About 300 lines; no Rust, no Apple calls, no new tokens beyond the walker geometry.
**Decided 2026-09-15: Deets speaks in the toast surface** (one primitive, themed already, one
place for the button styles), not in a speech bubble anchored to the sprite. The stops'
sentences take the Tips voice (§3): the habit and why it is safe, not the list of verbs.

### 4.6 Not this

- No coach-mark overlay dimming the app (the app is the point; a dimmed app hides it).
- No multi-page welcome screen before sign-in — sign-in is the first-run step, and it has
  its own copy (HANDOFF.md, the Account row).
- No tips on a timer, and no "Did you know" toasts after the walk (TOASTS.md §4: a toast that
  interrupts must be about what the user just did).
