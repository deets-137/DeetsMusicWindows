# Onboarding — how the app explains itself

> Three layers, cheapest first: **hover hints** on every control (§1), **right-click menus**
> everywhere a thing can be acted on (§2), and **Settings › Tips** for the gestures nothing on
> screen announces (§3). §4 designs the fourth layer — a **first-run walk** led by the Deets and
> Happy sprites from deets.solutions — which is **not built**. §1–§3 were built 2026-09-15.

Terms used here: a **hint** is the native `title` tooltip WebView2 shows after about one
second of hover. A **menu** is the shared themed right-click popover (`src/context-menu.ts`).
A **card** is one panel in the bento (Library, Playlists, Queue, …).

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

Native `title` only. There is no themed tooltip primitive (a "B" option that was considered
and parked: ~150 lines, tokenized box, fixed delay; build it only if the OS box offends the
polish). A screen reader gets the `aria-label`; the hint is for the pointer.

| Where | Control | Hint | Set in |
|---|---|---|---|
| Title bar | DeetsMusic (the title) | Opens the menu: theme, skin, window size, account, and Settings | index.html |
| Title menu | each Theme | Light/Dark + its two colors ("Light. Purple and mint") | index.html |
| Title menu | each Skin | one line on the idiom ("A print shop: ink on paper, square corners. The cover can be a record") | index.html |
| Title menu | Mini · NP · Midi · Max | what the window holds ("A small window: Now Playing and one card") | index.html |
| Title menu | Settings… | Shows the Settings card | index.html |
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
| Playlists | + · Sync | Makes a new playlist or a new folder · Reads your playlists from Apple Music again | playlists-card.ts |
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
| Rewind | Make playlist | A playlist of this window's top songs, filed under Replay | rewind-card.ts (pre-existing) |
| Settings | every row and action | the row hint (SETTINGS.md §3) | settings-card.ts (pre-existing) |
| Tray panel | DeetsMusic · Hide · Previous · Play/Pause · Next · Mute · + | Opens the full DeetsMusic window · Hides this panel · as Now Playing · the + shows the song it would add | tray.html / tray.ts |

**Rule for new controls:** an icon-only button gets an `aria-label` *and* a `title`. A button
with a visible word gets a `title` only when the word leaves a question (Sort, View). A control
whose meaning changes with state updates `title` where it updates `aria-label`.

Not hinted on purpose: text labels that say it all (the theme names in the Settings look
row, the Sort keys, the Group-by keys, the Account row), the scrubbers, list rows.

## 2. Right-click — the coverage table

One shared menu, cursor-anchored; the native menu is blocked everywhere except text fields
(Cut / Copy / Paste / Select All, `browser-defaults.ts`). The song menu has one shape wherever
a song appears (`trackMenu`, library-card.ts).

| Surface | Item | Menu |
|---|---|---|
| Library | song | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist (▸ when several) · Go to Album · Copy Link · Start Station · Favorite |
| Library | album tile | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Copy Link |
| Library | artist tile | the album menu shape on the artist's songs |
| Playlists | playlist | Rename (field, hand-made only) · Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Move to Folder ▸ · Import to Edit (Apple) · Set/Change Cover… ▸ · Delete Playlist (local) |
| Playlists | song in a playlist | the song menu + Add to Library · Remove from Playlist (hand-made) |
| Playlists | folder header | Rename (field) · Delete Folder |
| Playlists | hero cover | Rename · the cover items · Apple Music ▸ |
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

Nothing opens on: card headers, the title bar, empty card space, list shelf headers, the
Sort / View popovers. That is fine — but a "what can I do here" menu on empty space is a
future option.

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
