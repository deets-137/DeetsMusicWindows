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
| Title menu | Mini · Player · Midi · Max | what the window holds ("A small window: Now Playing and one card") | index.html |
| Title menu | Settings… | Shows the Settings card | index.html |
| Title bar | the compass (right of the title) | Go anywhere! (Ctrl + Space) | index.html |
| Title bar | the cog (right of the compass) | Opens Settings at full size | index.html |
| Title bar | the Room item (three figures) | Listen with friends → in a room: "N listening together in room K7QM-4XHT" | index.html, room-panel.ts |
| Room panel | the stage (the silhouettes) | Everyone listening. The heads move with the music → "…when Sound is on" while nothing is routed → out of a room: "Start a room and the others join here" | room-panel.ts |
| Room panel | Your name | The name the other members see | room-panel.ts |
| Room panel | Start a room | Makes a room from what you play now and shows its code | room-panel.ts |
| Room panel | the code field | The 8-character code the host reads out. Upper or lower case, with or without the dash | room-panel.ts |
| Room panel | Join | Joins the room with that code | room-panel.ts |
| Room panel | the code | The code a friend types to join this room | room-panel.ts |
| Room panel | Copy code · Copy invite link | Copies the room code / Copies a link that opens DeetsMusic and joins this room | room-panel.ts |
| Room panel | Remove (per guest) | Removes {name} from the room | room-panel.ts |
| Room panel | Permissions (the fold) | Shows what a guest may do: play, skip, seek, add songs and reorder Up Next | room-panel.ts |
| Room panel | each guest-control pill | what the control hands over ("Guests may start the music and stop it for everyone. Off: a guest's Pause stops only their own app") | room-panel.ts |
| Room panel | Leave room · End room | Leaves the room / Ends the room for everyone. Your own queue comes back | room-panel.ts |
| Compass bar | a Settings row | the row's own hint (settings-card.ts, through `settingsRows()`) | compass.ts |
| Compass bar | a theme, skin or surface row | the title menu button's own hint | compass.ts |
| Compass bar | Open · Play (a song, album, artist or playlist row) | Enter · Ctrl+Enter | compass.ts |
| Settings › Connections | Agents read play history | Lets a connected agent see what you played, when, and what you skipped | settings-card.ts |
| Title menu › Account | Last.fm | Connects your Last.fm account in your browser. Songs you hear go to your Last.fm profile · connected: Disconnects Last.fm. Songs you hear stop going to your profile · no key: Last.fm is not in this build of DeetsMusic | index.html / lastfm.ts |
| Title menu › Account | the Last.fm name ("Connected as *name*") | Opens your Last.fm profile in your browser | lastfm.ts |
| Settings › Last.fm | Scrobble plays · Show now playing | Sends each song to your Last.fm profile once you hear half of it or 4 minutes · Your Last.fm profile shows the song while it plays | settings-card.ts |
| Settings › AirPlay | Send to speaker | DeetsMusic only: the speaker plays your music and this PC goes quiet. All PC sound: every app's sound, and this PC keeps playing | settings-card.ts |
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
| Sound panel | Match songs to · Keep albums together · Songs not measured get · Clear measurements · Follow the volume of · Blend amount | How loud songs are made: Standard is Apple's Sound Check level (−16 LUFS), Louder is −14 LUFS, Quieter is −18 LUFS · On: when you play an album in order, all its songs move by the same amount, so a quiet song stays quiet · A song is measured the first time you hear it. Until then: move it by your songs' usual amount, or leave it as it is · Deletes every song's loudness measurement. Each song is measured again the next time you hear most of it · App + Windows: counts the DeetsMusic volume and the Windows volume together. App only: counts the DeetsMusic volume · How much of each side goes into the other | sound-panel.ts |
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
| Settings › Sound (also in the Sound panel) | Avoid distortion · Lower the song by · Remember each output | How a boost is kept from distorting. Limiter only turns down just the loudest moments; the others lower the whole song · By hand only. How much the song is turned down before the equalizer. The limiter catches anything left · On: headphones, speakers and AirPlay speakers each remember their own preset | settings-card.ts |
| Settings › Sound (also in the Sound panel) | Match songs to · Keep albums together · Songs not measured get | How loud songs are made. Standard is Apple's Sound Check level (−16 LUFS), Louder is −14, Quieter is −18 · On: when you play an album in order, all its songs move by the same amount, so a quiet song stays quiet · A song is measured the first time you hear it. Until then: move it by your songs' usual amount, or leave it as it is | settings-card.ts |
| Settings › Sound (also in the Sound panel) | Follow the volume of · Blend amount · Ask to keep after | App + Windows: counts the DeetsMusic volume and the Windows volume together · How much of each side goes into the other · When to ask whether the effects are worth keeping, counted from the first time one was turned on | settings-card.ts |
| Settings › Sleep (also in the sleep panel) | Sleep every day · Sleep at · Wind down · Play out song | Arms a sleep time every day. It pauses only if music is playing when the time comes · The time the daily sleep timer runs out · Over these last minutes the volume sinks to nothing, then the music pauses. Off: a plain pause at the time · The song that is playing when the time comes finishes first. Off: the time is the silence | settings-card.ts |
| Settings › Menus, hints and notices | Compass closes on outside click | A click outside the Ctrl+Space bar closes it. Off: only Ctrl+Space, Escape, the compass button, or a pick closes it | settings-card.ts |
| Settings › Window | Shrink volume bar | On: a small pill in the title bar that grows when you click it, or hover, as the menus open. A window thinner than 455 px uses the small pill anyway | settings-card.ts |
| Settings › Motion | Fancy scrubber | Each skin's own playhead: the Press nib, the Ocean float, the Glass lens, the charged bolt. Off: a plain handle | settings-card.ts |
| Settings › Skin settings | Fancy Glass | Glass only. A live blur behind the cards, a moving background, and four sliders. Without a graphics card: about 85% fewer frames | settings-card.ts (`GLASS_FANCY_HINT`) |
| Title bar | AirPlay square | Plays on a speaker or TV on your network · *Playing on {speaker}* while connected | index.html / airplay.ts |
| "Play on" panel | Scan for speakers · Not now · Continue | Scan for speakers · Keep the speaker list open and ask again later · Show the Windows permission prompt, then play on the speaker | airplay.ts (the last two show once, before the first connect) |
| Title bar | Maximize · Minimize · Close | Fills the screen. Press again to go back · Puts the window on the taskbar · Closes DeetsMusic. With Close to tray on, it hides to the tray and keeps playing | index.html |
| Now Playing | Shuffle | Shuffles the songs after this one · *Shuffle is on. Press again to turn it off* | now-playing-card.ts (`paintModes`) |
| Now Playing | Repeat | Repeats the list, then one song, then off → Repeats the list. Press again: one song → Repeats this song. Press again: off | now-playing-card.ts (`REPEAT_HINT`) |
| Now Playing | Show queue · Show search | Shows the Queue card: what plays next · Shows the Search card: all of Apple Music | now-playing-card.ts |
| Now Playing | Previous · Play/Pause · Next | Plays the song before this one · Play / Pause (follows state) · Plays the next song | now-playing-card.ts |
| Now Playing | ♥ · + | Favorite / Unfavorite · Add to Library / In your library (follow state) | now-playing-card.ts |
| Now Playing | Mute · AirPlay (stage row) | as the title bar | now-playing-card.ts |
| Card headers | Back | Goes back one step | library-, playlists-, radio-card.ts; search-card.ts (its card header since 2026-09-17) |
| Card headers | Back, on a level a grown card's drill opened | Goes back to *<card>* | collection-card.ts `setHeader`, search-card.ts `pushPane` (CARD-GROW.md §14.4) |
| Settings › Window | Keep view when grown | A card that grows keeps the view you are in; the tile size still follows the card's size | settings-card.ts |
| Settings › Window | Card on drill | A drill opens in the card you are reading, and Back returns it; or it is summoned into another slot | settings-card.ts |
| Settings › Window | Bring a card already open | A drill whose card is already on screen: bring it to the card you are reading, or open it where it sits | settings-card.ts |
| Settings › Window | Keep card places on restart | Opens each card where you left it, also after you restart DeetsMusic | settings-card.ts |
| Library | Refresh | Reads your library from Apple Music again | library-card.ts |
| Playlists | + · Web · Sync | Makes a new playlist or a new folder · Makes a playlist from an artist and the artists they make songs with · Reads your playlists from Apple Music again | playlists-card.ts |
| Playlist web panel | Start row (Artist · Song · Album) · the field · a library artist row (song or album row) · an Apple row or an earlier web's row · Search Apple Music row · the picked artist (song, album) · Reach 3 with an album seed · Keep · Temp · the days button · Reach row · Size row · Prefer row · a genre chip · Retry · Read again · Playlist name · Make playlist | Start the web from an artist, a song or an album · Finds an artist in your library, or searches Apple Music (Finds a song… / Finds an album…) · In your library. Starts the web here · Starts the web here · Searches Apple Music for this name (song, album: …for this title) · The web starts here. Type to pick another artist (song, album) · An album starts with many artists, so its web reaches 2 at most · Keeps the playlist until you delete it · Deletes the playlist *7 days* after you last play it. Right-click the playlist to keep it · Press for *30 days*, right-click for *5 days* · 1 reaches the artist's collaborators. Each step reaches one circle further · Songs in the new playlist · Familiar puts your songs first. Discover puts songs you don't have first · (a genre chip, written again on every change) *66 R&B/Soul songs in the web.* Pick it: *44* go in, with *6* by *Artist* / *44* go in, with *6* by *Artist*. Press again to drop it / Add it: *50* go in, with *8* by *Artist* (Web only: ", with all of *Artist*'s songs") · Reads only the artists that didn't load · Reads this web from Apple Music again. Use it when an artist has new songs · Names the new playlist · Makes the playlist and opens it | web.ts |
| Radio | Refresh | Reads the stations from Apple Music again | radio-card.ts |
| Any shelf tile (Home, Library, Playlists, Radio) | the pin badge (2026-09-18, PINS.md) | Unpin | pins.ts |
| Library artist view | the hero cover | Opens the menu for this cover (the engine's cover button; the menu is Pin / Unpin) | collection-card.ts |
| Search | Clear · Filter | Clears the search · Picks which kinds of results show: songs, albums, artists, playlists, stations | search-card.ts |
| Song pane (2026-09-17) | a writer chip | Other songs by this writer | search-card.ts (CREDITS.md §7) |
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
| Rewind (2026-09-18) | **SOTD** (header, top right) | The songs you marked, newest first · pressed: *Back to your listening*. `aria-label` *Your Songs of the Day*. Hidden while Song of the Day is off | rewind-card.ts |
| Rewind (2026-09-18) | the withdraw square on a posted pick (always visible, not on hover) | Takes the Discord post down. Your pick stays. `aria-label` *Withdraw the post* | rewind-card.ts |
| Settings › Song of the Day (2026-09-18) | Withdraw, on a posted line of the record | Takes the post down. Your pick stays | settings-card.ts |
| Settings › Song of the Day (2026-09-18) | a line of the record (the whole row) | *Discord · \<full local time\>* · and the reason on a failure | settings-card.ts |
| Settings › Song of the Day (2026-09-18) | Copy, on *What has left this PC* | Copies every line to the clipboard, newest first | settings-card.ts |
| Rewind (2026-09-18) | Make playlist, on the picks board | the same button, filing the window's picks oldest first | rewind-card.ts |
| Settings › Song of the Day (2026-09-18, DeetsOTD.md) | Song of the Day · Suggest today's pick · Day starts at · Picks per day · Post my picks · Post at · Discord | Mark one song a day. With no outlet set up it stays on this PC and posts nothing · Puts the song you played most today at the head of the Home shelf. You still choose · A song marked before this hour counts for the day before · At the limit, Mark becomes Replace Today's Pick · When a marked song goes out to the outlets you turned on · The time the day's picks go out. It always falls inside the day they belong to · Posts the song's link in one channel through a webhook. Anyone who has the link can post there | settings-card.ts |
| Settings › Song of the Day | Set up / Change · Remove | Asks Discord what the webhook is. It posts nothing · Forgets the webhook here. Delete it in Discord to stop it working | settings-card.ts |
| Settings | every row and action | the row hint (SETTINGS.md §3) | settings-card.ts (pre-existing) |
| Tray panel | DeetsMusic · Hide · Previous · Play/Pause · Next · Mute · + | Opens the full DeetsMusic window · Hides this panel · as Now Playing · the + shows the song it would add | tray.html / tray.ts |
| Card gaps (2026-09-16, CARD-GROW.md) | an edge zone | *Widen Library over Search* · *Make Library taller, over Playlists* · *Fill the window with Library* · on a grown card's outer zone: *Collapse Library back to its place* | card-grow.ts (`growHint` / `collapseHint`) |
| Card header | the Grow button (hover-only) | the zone text for the direction it takes: *Widen Library over Search* → *Fill the window with Library* → *Collapse Library back to its place* | card-grow.ts |
| Queue's top edge (Max, 2026-09-17, STAGE-COLUMN.md) | the stage column's one live zone | *Make Queue taller, over Now Playing* · while grown: *Collapse Queue back to its place* | card-grow.ts (`zoneAction`, the stage branch) |
| Queue header (Max) | the Grow button (hover-only) | *Make Queue taller, over Now Playing* → *Collapse Queue back to its place*. There is no Fill step: the Queue grows up only | card-grow.ts |
| Card header | Pin (while grown, with Collapse on outside click on) | Keeps this card open when you click outside it · pinned: Lets a click outside collapse this card again | card-grow.ts |
| Grown song list | a column header | *Sorts by artist. Click again to turn it around* (Title, Artist, Album, Length, Genre, Year, Plays, #) | collection-card.ts (`colsHTML`) |
| Grown list | a rail letter | *Jump to M* · *Jump to numbers and symbols* · an empty letter: `aria-label` *No M here* | collection-card.ts (`syncRail`) |
| Settings › Window (2026-09-17) | Max window when short | Max needs height for the album cover and the queue rows. Dragged under 745 px tall it becomes Midi, or it stops there. Becomes Midi needs Resize changes surface on | settings-card.ts |
| Settings › Window | Grow cards from edges · Collapse on outside click · Grown card on a new pick | Click the gap beside a card to open it over its neighbor. Hover a card's title for the button · A click outside a grown card collapses it. Pin holds it open · Pick another card in a grown card's title: it keeps the size, or collapses first | settings-card.ts |

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
| Row + credit | the same, plus the song's writers | a third line, after a blank one (CREDITS.md §7.3) |

Nobody authors a row hint. `SHAPES` in hint.ts lists the row and tile shapes the cards build
— `.lib-row`, `.lib-tile`, `.lib-hero`, `.qrow`, `.qnow`, `.search__song`, `.search__row` (a Search
drill pane's song list; missing until 2026-09-17), `.search__tile`,
`.search__artist`, `.np` — each with its title span and its sub span, so one delegated handler
covers Library, Search, Queue, Rewind, History, Home, the Artist shelves and Now Playing.
**Add a new row shape to that table, not a new listener.** The deeper element wins: the Add
button inside a song row still says *Add to Library*.

**The third line — a song's writers** (2026-09-17, CREDITS.md §7.3). A row that carries
`data-cid` (its catalog id) shows Apple's `composerName` under a blank line. The read is
synchronous from a memory map, because a hover cannot wait for a round trip: a song not
collected yet has no third line, and asking warms it for the next hover. A row with writers
shows its hint **even under "Name songs on hover: Cut off"** — being cut off is no longer the
only reason to hover a row.

**Three settings** (Settings › Menus, hints and notices, beside Open menus on hover):

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
| Library | song | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist (▸ when several) · Go to Album · **Song Credits** · Copy Link · Start Station · Favorite |
| Library | album tile | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Go to Artist · Copy Link |
| Library | artist tile | the album menu shape on the artist's songs |
| Playlists | playlist | Rename (field, hand-made only) · Keep Playlist (a temporary web playlist, 2026-09-17) · Play Now · Play Next · Add to Queue · Add to Playlist ▸ · Move to Folder ▸ · Import to Edit (Apple) · Set/Change Cover… ▸ · Delete Playlist (local) |
| Playlists | a picked set of playlists (Ctrl/Shift+click) | Play Now · Play Next · Add to Queue · Add to Playlist ▸ · **Delete N playlists** (the local ones in the pick, 2026-09-17) |
| Playlists | song in a playlist | the song menu + Add to Library · Remove from Playlist (hand-made) |
| Playlists | folder header | Rename (field) · Delete Folder |
| Playlists | hero cover | Rename · Keep Playlist (temporary) · the cover items · Apple Music ▸ |
| Playlist web panel | the days button of Temp \| N days (2026-09-17) | no menu: a right-click steps the days back (30 → 7 → 5 → 3 → 1 → 30); a press steps forward |
| Queue | upcoming row | Play Now · Move to Top · Move to Bottom · Remove · Go to Artist · Go to Album · **Song Credits** · Copy Link · Start Station · Add to Library · Favorite |
| Queue | now hero | Go to Artist · Go to Album · **Song Credits** · Copy Link · Start Station · Add to Library · Favorite · Stop Station |
| Queue | station row | Stop Station / Don't resume |
| Now Playing | cover · title · artist | the Queue now-hero menu |
| History · Rewind | row | Play Now · Play Next · Add to Queue (+ Go to Artist / Album / **Song Credits**, where a catalog id exists) |
| Search | song · album · playlist · artist | the song menu (with **Song Credits**) · the album menu (+ Add to Library) · the playlist menu · Go to Artist · Start Station |
| Search · Radio | **station** (2026-09-15) | Play Now · Add to Queue (plays when the queue runs dry) · Copy Link. A station also drags: to the Queue card (after the queue) or Now Playing (now) |
| Artist view | shelf playlist | Play Now · Play Next · Add to Queue · Add to Playlist ▸ |
| **Pins** (2026-09-18, PINS.md) | a song anywhere the song menu appears · a Library album or artist tile · the Library artist view's cover · a Search artist row · the Search artist pane's hero · a playlist row · a station row · the Now Playing cover · a Home tile | **Pin** / **Unpin**, the last row of each menu. A pinned Home tile has no Hide row. The badge on a pinned tile is a button: a press unpins. |
| **Pinned shelf** (Library · Playlists · Radio root) | a pinned tile | the item's own row menu (the song / album / artist menu, the playlist menu, the station menu). A click does what the row does: an album or artist drills, a playlist opens, a song or a station plays. |
| **Song of the Day** (2026-09-18, DeetsOTD.md) | a song anywhere the song menu appears | **Mark as Song of the Day**, the last row — or **Replace Today's Pick** at the limit, or **Unmark Song of the Day** when it is already today's. Left out with the feature off, and left out for a song Apple has no catalog id for. |
| **Songs of the Day shelf** (Home) | a pick tile | the song menu, then **Add a note** (a field) · **Post Now** (while an outlet is on and it has not gone) · **Withdraw the post** (only while it is really posted) · **Unmark Song of the Day** (*Remove from Songs of the Day* for an imported pick) |
| **Songs of the Day shelf** (Home) | the suggestion tile (dashed rim) | **Mark as Song of the Day** first, then the song menu |
| **Rewind › Picks** | a pick row | the song menu, then the pick's own rows (as the shelf tile). A posted pick also carries the **withdraw square** at the row's end, on hover — the same verb without the menu |
| Settings | My reports row | Open · Copy link · Close · Clear |
| **Tray panel** | song (2026-09-15) | Add to Library · Favorite / Unfavorite · Copy Link |
| **Queue header (Max)** | the title, or the Grow button (2026-09-17, STAGE-COLUMN.md) | Grow ▸ (*Up, over Now Playing* — the only direction the stage column has) · while grown: Pin / Unpin · Collapse. No Fill row. |
| **Card header** | the title, or the Grow button (2026-09-16, CARD-GROW.md) | Grow ▸ (*Right, over Search* · *Down, over Playlists* — the directions that exist in this slot) · Fill (Max) · while grown: Pin / Unpin (with Collapse on outside click on) · Collapse |

Nothing opens on: the title bar, empty card space, list shelf headers, the Sort / View
popovers. That is fine — but a "what can I do here" menu on empty space is a future option.

## 3. Settings › Tips (built)

The first Settings section, collapsed by default, seven two-line notes: the gesture in the
text color, why to try it in the subtext color (`TIPS` in settings-card.ts, `.set__tip` in
settings.css). **It is not a manual.** It teaches the habits that let a person find the rest
alone — *hover anything*, *right-click anything*, *drag anything*, *click your way in*, the
title menu, *press Ctrl+Space* (the Compass, COMPASS.md), and *close is not quit* (shown only while Close to tray is on, its default) —
and tells them it is safe ("Nothing in it can break", "Nothing is permanent"). The menu verbs are not listed there; the menus show them. When a
gesture is added to the app (not a verb), add a note.

## 4. The first-run walk (BUILT 2026-09-18)

> §4.0 is **as built**. §4.1–§4.6 are the 2026-09-15 design; where the two differ, §4.0 wins.

### 4.0 As built

`src/walk.ts` + `src/styles/walk.css` + the five sprites in `src/assets/sprites/`. No Rust,
no Apple calls, no new primitive: the speech card wears the toast material and the toast
button idiom through `--walk-card-*` aliases (§2a control families), and `toast.ts` is
untouched.

**The five steps** (owner's, 2026-09-18). Each names one control and waits for the real
gesture on it:

| # | The sentence points at | Advances when |
|---|---|---|
| 1 | the DeetsMusic wordmark — sign in to Apple Music | `deets:signed-in` (main.ts, after Apple accepts) |
| 2 | the wordmark again — it is the menu | `#settings-trigger` goes `aria-expanded="true"` |
| 3 | the left card's title — every title is a card picker | a `.slot-picker__menu` opens |
| 4 | the Compass button — Ctrl + Space reaches everything | `#compass` loses `hidden` |
| 5 | nothing. The send-off, centred, with **Let's go** | — |

**Four decisions, and what each one cost:**

- **The gesture advances a step, not a button.** A step you clicked past taught nothing.
- **Next arrives only once we have failed.** It is not on the card; it is added after
  `NUDGE_MS` (9 s) of a step waiting, and logs `walk:nudge`. Its presence is an admission
  that the pointing was not good enough, so it must not be offered first.
- **The sprites travel to the target** (option A). Every step here names something at the
  top of the window, while the toast host sits at the bottom in midi — a flash 600 px from
  the sprite pulls no harder than a hint box. So the card leaves the toast host and rides
  with Deets. `reposition()` puts the group under the target (over it when there is no room
  below), lines the pointer up with the target's middle, and clamps the group on screen.
- **A step can speak again once its panel is open.** `Stop.openText` replaces the sentence
  while the step's own panel is up. Step 4 uses it: *"Esc or Ctrl + Space to close again!"* —
  we asked them to open the bar, so we owe them the way out. The card then rides **beside**
  the sprites (`data-tuck="msg"`), one line, no step counter, no buttons, which is what makes
  it fit above the DeetsBar in midi.
- **Escape is a skip, except while a panel is open** — and the listener is in the **capture
  phase** for that reason. In the bubble phase the panel has already closed by the time the
  event reaches the window, `busyEl()` reads null, and the guard never fires. Measured, not
  guessed: without capture, doing exactly what step 4's card says shut the bar *and* ended
  the walk in one press.
- **The walk waits for a clear screen.** Steps 2–4 each ask the user to OPEN a menu. The
  step advances the moment it opens, but `whenClear()` holds the travel until it closes, so
  Deets never walks off behind a menu, and the walk layer (z 95) never covers one (z 100).
  He tries four placements in order — right of the panel, left, under, over — at full size,
  then **tucked**: the speech card stands down (or shrinks to its `openText` line) and the
  two sprites alone go looking again. Only if even they cannot clear it do they take the
  bottom corner away from the panel. Measured in midi, where the bar runs y 202→745 in a
  670-tall window: the tucked pair sits at y 60→188, clear by 14 px.

**State: `onboardingStep` in settings** — the NEXT step to show, 0 = over. Not a
localStorage once-key (this supersedes §4.4): it survives a localStorage clear, the agent
can read it, and Settings › Tips hands it back. `settings-store.ts seedOnboarding()` decides
ONCE, at first load, whether this install has ever been used — the tell is `deets.theme`,
which `applyTheme` writes back on every launch and which is still absent on a true first
paint — and **persists that answer alone**, so a user who quits during step 1 does not lose
the walk they never finished, and an upgrade never sees it.

**Who owns "you are signed out".** While the walk is live, `apple-health.ts` stays quiet
about `signedOut`: step 1 says the same thing with the same button, and one cause raises one
notice (TOASTS.md). A user who has ever signed in never sees the walk and gets the sticky as
before. `initWalk()` also skips step 1 outright when a token already exists.

**The way back in:** Settings › Tips › *Show the tour again*, and the Compass row **Show the
tour** (aliases: tour, walkthrough, onboarding, getting started, help).

**Trigger:** `deets:boot-done` (boot-cover.ts, fired on both the fade and the reduced-motion
snap). A sprite under a control the launch cover still hides points at nothing.

**Reduced motion:** the sprites are placed, not walked; nothing pulses; the target takes a
focus ring instead.

**Also changed the same day:** the default cards. Midi is `Home | Library` and Max is
`Home | Library` over `Playlists | Search` (layout.ts). A stranger has nothing in the Queue
for a while, and Home is the card that fills first.

**Desk test** — run `npm run dev:fresh` (§5):

1. The window opens on Home | Library, signed out, and Deets + Happy stand under the
   wordmark with step 1. The old "Sign in to Apple Music to play songs." sticky does NOT
   also appear.
2. Wait 9 s: a **Next** button appears. Do not press it.
3. Sign in. Step 1 advances by itself when the browser comes back.
4. Step 2: click **DeetsMusic**. The step advances, but the sprites do not move until the
   menu closes.
5. Step 3: click the left card's title. The picker opens, the step advances, the sprites
   walk right and face the way they travelled.
6. Step 4: press Ctrl + Space. Step 5 lands centred, with no pointer.
7. Press **Let's go**. Restart the app: no walk.
8. Settings › Tips › Show the tour again → it starts at step **2**, not 1 (you are signed in).
9. Ctrl + Space, type "tour" → the same row is there.
10. Press Escape mid-walk, then restart the app: no walk (Escape is a skip).
11. Repeat with Windows' *Animation effects* off (reduced motion): the sprites are placed,
    the target takes a ring, and every step still advances.
12. Repeat in Max and in Mini: the group stays on screen at both window sizes.


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

## 5. Testing a first run (built 2026-09-18)

Everything a first run does not have lives in two folders, both named after the app's
identifier:

| Folder | Holds |
|---|---|
| `%APPDATA%\<id>` | the Apple token, `settings.json`, the SQLite cache, the Last.fm session, the logs |
| `%LOCALAPPDATA%\<id>\EBWebView` | localStorage — theme, skin, surface, the layout keys, every once-key |

`scripts/dev-app.mjs` deletes both before it launches:

```
npm run dev:fresh        # everything goes: you are a stranger, signed out
npm run dev:fresh:in     # the same wipe, then the Apple token and library cache go back
```

`dev:fresh` is the honest test of step 1 — you sign in to Apple again. `dev:fresh:in` keeps
`user-token.txt` and `deetsmusic.db*`, so you land on a first-run UI already signed in, with
no Apple round trip; it is the one to use when you test steps 2 onward again and again. Both
are `--fresh` and `--fresh=keep` on `dev:app`, so they combine with `--perf`, `--built` and
`--gpu=`.

**Why a real wipe and not a flag the app reads.** A pretend-first-run mode inside the app
would be a second signed-out code path, and a stranger could reach it. The wipe touches no
app code at all.

**The safety.** The identifier comes from `src-tauri/tauri.dev.conf.json` and the script
refuses to run unless it ends in `.dev`. The installed app's `com.deetsmusic.app` folders
can never be deleted this way. The kept files are copied out to `node_modules/.deets-fresh`
*before* the wipe, so a half-finished delete cannot lose them.

**If it refuses:** Windows will not delete a file a process holds open. Close the dev app and
any `deetsmusic` CLI, then run it again. The script says which folder it could not clear.
