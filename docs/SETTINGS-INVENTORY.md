# Every control in DeetsMusic

The full catalogue: every setting, menu item, group and folder, and what each one does.
**Bold** marks the default.

For how the settings are stored, which module owns each one, and how to add a new row, see
[SETTINGS.md](SETTINGS.md).

---

## Where a control lives

DeetsMusic puts each control in exactly one place. Nothing is repeated.

| Place | What it holds |
|---|---|
| **The title menu** (click **DeetsMusic**) | The fast switches you use many times a day: the theme, the skin, the window size, your accounts |
| **The title bar buttons** | Live actions: the listening room, Sound, the sleep timer, the volume, AirPlay |
| **The Settings card** | Every preference |
| **A right-click menu** | Verbs that act on the row under the pointer: play it, add it, go to it |
| **A card header** | How that one card sorts and filters. It is the card's own state, not a preference |
| **The Compass** (Ctrl+Space) | A search bar that reaches all of the above |

---

## The title menu

Click **DeetsMusic** in the title bar.

### Theme
**Lilac** (light, purple and mint) · **Green** (light, green and fern) · **Sepia** (light,
parchment and terracotta) · **Moonlight** (dark, slate and moon white) · **Black & Yellow**
(dark) · **Black & Red** (dark).

### Skin
**Press** — a print shop: ink on paper, square corners. The cover can become a record.
**Ocean** — cards on rolling waves, with a serif.
**Glass** — frosted panels over a soft glow.
**Cyber** — lightning behind the cards, machined type.

### Surface
The window size and what it holds. The label's own size is the preview.

| Choice | What you get |
|---|---|
| **Mini** | A small window: Now Playing and one card |
| **NP** | The player alone: Now Playing only. Called **Player (NP)** in Settings and the Compass |
| **Midi** | The tall window: Now Playing and two cards |
| **Max** | The wide window: the stage, the queue, and four cards |

### Settings…
Summons the Settings card into a slot.

### Account
**Apple Music** — sign in or out. **Last.fm** — connect or disconnect.

---

## The title bar buttons

### Go anywhere (Ctrl+Space)
The Compass bar. Type to reach any card, any setting, a transport verb, or anything in your
library. See [COMPASS-TERMS.md](COMPASS-TERMS.md) for every word it answers to.

### Listening room
Listen with friends over an 8-character code.

| Control | What it does |
|---|---|
| Your name | The name the other members see. Empty: you join as *Listener*, or *Host* for a room you start |
| Start a room | Makes a room and gives you its code |
| Join | Joins the room whose code you type |
| Copy code · Copy invite link | Shares the room |
| The member list | Everyone in the room. The host can **Remove** a member |
| **Guests may** | Five permissions, each **Everyone** or **Host only**: Play · Skip · Seek · Add songs · Reorder. Your last choice is the default for your next room |
| End room / Leave room | Ends it if you are the host, leaves it if you are a guest |

Pause is never taken away from a guest. Under **Host only** it stops that guest's own app instead.

### Sound
Two tabs. Every effect is **off** until you turn it on.

**Equalizer tab**

| Control | What it does | Choices |
|---|---|---|
| Equalizer | Turns the equalizer on or off | on / **off** |
| The presets | A built-in curve, one you saved, or Custom | **Flat** |
| The curve | Ten bands, as **Sliders** or as dots on a curve | **Sliders** / Dots |
| Reset | Puts every band back to 0 dB. Undo is offered for a moment | — |
| Avoid distortion | How a boost is kept from clipping | **Limiter** / When needed / Always / By hand |
| Lower the song by | The amount for *By hand*, in dB | −24…+6, **0** |
| Remember each output | Headphones, speakers and AirPlay speakers each keep their own preset | **On** / Off |

**Adaptive sound tab**

| Control | What it does | Choices |
|---|---|---|
| Adaptive sound | The switch over all three parts below | on / **off** |
| Match loudness | Plays every song at about the same loudness | on / **off** |
| Fuller at low volume | Adds bass and a little treble as you turn down. Gentle adds half as much as Full | Off / **Gentle** / Full |
| Headphone crossfeed | Mixes a little of each side into the other, as speakers in a room do | **Auto** / Always / Off |
| Match songs to | How loud songs are made. Standard is Apple's Sound Check level | **Standard** / Louder / Quieter |
| Keep albums together | An album played in order moves by one amount, so a quiet song stays quiet | **On** / Off |
| Songs not measured get | A song is measured the first time you hear it | **Usual amount** / No change |
| Clear measurements | Deletes every song's loudness measurement | — |
| Follow the volume of | What *Fuller at low volume* watches | **App + Windows** / App only |
| Blend amount | How much crossfeed | Light / **Medium** / Strong |
| The review question | When to ask whether the effects are worth keeping | **7 days** / 14 days / 3 days / Never |

Turning **Adaptive sound** on does not turn its three parts on. Each part has its own switch.

### Sleep timer
Music pauses when the timer runs out.

| Control | What it does | Choices |
|---|---|---|
| The dial | Turn it to set the minutes | — |
| Off | Turns the timer off | — |
| End of song | Pauses when this song ends | — |
| End of Up Next | Pauses when Up Next runs out | — |
| Wind down | Over these last minutes the volume sinks to nothing, then the music pauses | **5 min**, or 0 for a plain pause |
| Play out song | The time runs out mid-song: the song finishes first | on / **off** |
| Every day | A sleep time that arms itself daily. It pauses only if music is playing then | **Off** / Sunset / a set time (**10:00 PM**) |

### Volume
The slider, and **Mute**. Settings › Window › *Shrink volume bar* makes it a small pill.

### AirPlay ("Play on")
**This computer** · each speaker found · **Last used** · **Scan for speakers** ·
**Windows permission** when Windows is blocking the scan.

---

## The Settings card

Fifteen sections. **Tips** and **About** start open; the rest start folded.
Open one at a row with the Compass, or from the **[Settings]** button on a notice.

### Tips
Six short notes on the habits the app rewards — hover anything · right-click anything · drag
anything · click your way in · the title menu · close is not quit. Then **Show the tour again**,
which restarts the first-run walk.

### Window

| Control | What it does | Choices |
|---|---|---|
| Close to tray | × hides the window. The tray icon opens it again | on / off |
| Tray icon opens | What a click on the tray icon pops | **Mini** / Player |
| Start with Windows | Starts in the tray when you sign in | on / off |
| Resize changes surface | A window made narrow or short becomes the surface that fits it. Off: it resizes inside the current surface | **on** / off |
| Shrink volume bar | The title bar volume is a small pill that grows when you click it. A window thinner than 455 px uses the pill anyway | on / **off** |
| Mini opens at | The window size Mini opens at. **Set current** saves the size it has now | **385 × 550** |
| Player (NP) opens at | The size for the player alone | **405 × 675** |
| Midi opens at | The size for Midi | **495 × 670** |
| Max opens at | The size for Max | **1100 × 950** |
| Max window when short | A Max window dragged shorter than the stage column can hold | **Becomes Midi** / Stops at floor |
| Keep on top | The window stays above other windows | Always / Player / **Off** |
| Grow cards from edges | Click the gap beside a card to open it over its neighbor | **on** / off |
| Collapse on outside click | A click outside a grown card collapses it. Pin holds it open | **on** / off |
| Compass closes on outside click | A click elsewhere closes the Ctrl+Space bar | **on** / off |
| Grown card on a new pick | Pick another card in a grown card's title | **Keeps size** / Collapses |
| Keep view when grown | A grow or collapse keeps the view you are in, or takes that size's own | **Keep** / Per size |
| Card on drill | Go to Album, a shelf tile, a playlist: where the new card opens | **In place** (Back returns) / Summon |
| Bring a card already open | The drilled card is already on screen: bring it to you, or leave it where it sits | on / **off** |
| Keep card places on restart | Each card comes back where you left it, also after a restart | on / **off** |

### Look and feel

**The schedule**

| Control | What it does | Choices |
|---|---|---|
| Change look at | What moves the look between day and night | Sunrise and sunset / Set times / Windows mode / **Off** |
| Day look · Night look | The theme and skin for each half | **Lilac + Press** · **Black & Red + Cyber** |
| Day runs | The set times, when *Set times* is chosen | **07:00 → 19:00** |
| Shift sun times | Minutes added to sunrise and sunset | **None**, ± minutes |
| Menu pick lasts | A theme or skin picked by hand | **Until next change** / For good |

**Motion**

| Control | What it does | Choices |
|---|---|---|
| Animate look changes | Theme and skin changes play the launch animation | **on** / off |
| Animate card swaps | Cards move to their new places in the skin's own motion | **on** / off |
| Fancy scrubber | Each skin's own playhead: the Press nib, the Ocean float, the Glass lens, the charged bolt | **on** / off |
| Animate backgrounds | The moving backgrounds: the Ocean swell, the Glass aurora, the Cyber storm | **On** / Reduced / Off |

Your Windows reduced-motion preference always wins over these.

**Ocean only**

| Control | What it does | Choices |
|---|---|---|
| Draw card edges | The card edges break into grains of sand, or a soft glow | Sand / **Soft** |
| Sand width | How far the sand reaches into a card | 0–100%, **15** |

**Glass only**

| Control | What it does | Choices |
|---|---|---|
| Fancy Glass | A real blur behind each card, and the aurora drifts. Off: the frost is painted in, and it costs nothing to redraw | on / **off** |
| Canvas glow | How brightly the aurora glows | 0–100%, **40** |
| Dim canvas | Darkens the space between the cards | 0–100%, **10** |
| Backlight | The light behind each card, under its tint | 0–100%, **85** |
| Tint cards | How much theme color fills a card | 0–100%, **65** |

**Press only**

| Control | What it does | Choices |
|---|---|---|
| Record player | The cover becomes a record that turns while music plays | Spin / Still / **Off** |
| Show record on | Where the record shows | Stage / Stage + card / **Everywhere** |
| Spin speed | Turns each minute — the three real record speeds | **33⅓** / 45 / 78 |
| Show record plate | The ink shadow behind the record | **on** / off |

**Menus, hints and notices**

| Control | What it does | Choices |
|---|---|---|
| Open menus on hover | Every dropdown opens on hover instead of click | on / **off** |
| Show hover hints | The themed box every hover hint appears in | **on** / off |
| Hints appear after | How long the pointer rests first. A song row waits longer | A moment / **A pause** / A while |
| Name songs on hover | The name box on a song row | **Always** / only when Cut off / Never |
| Show notices | Which toasts appear. A failure always shows | **Everything** / Failures |

### Home

| Control | What it does | Choices |
|---|---|---|
| Hiding lasts | Right-click a Home tile › Hide takes it off the card | **Until cleared** / This session |
| Hidden tiles | **Clear** puts every hidden tile back. Playing one again also brings it back | — |

### Playback

| Control | What it does | Choices |
|---|---|---|
| Stream quality | Auto follows your network live | **Auto** / High / Low |
| Play Now plays | What right-click › Play Now starts | Song only / **Song and rest of list** |
| Drop on Now Playing | Dragging a song onto Now Playing | **Keep Up Next** / Replace it |
| Previous rewinds | What Previous may go back into | **The list** / only Played songs |
| Restore on launch | What comes back when the app opens | **Last song** (paused, with its queue) / Up Next only / Nothing |
| Shuffle button stays on | The Shuffle button turns shuffle on until you press it again. Off: it shuffles Up Next once | **on** / off |
| Shuffle keeps picks | Where songs you queued by hand land | **First** / In place / Mixed |
| Idle shuffle plays | Shuffle with nothing playing | **Library** / Nothing |
| Show the day in History | Each History row says Today, Yesterday or the date | on / **off** |

### AirPlay

| Control | What it does | Choices |
|---|---|---|
| Send to speaker | **DeetsMusic only**: the speaker plays your music and this PC goes quiet. **All PC sound**: every app's sound, and this PC keeps playing | **DeetsMusic only** / All PC sound |

### Apple Music

| Control | What it does | Choices |
|---|---|---|
| Add to Library and ♥ | Lets DeetsMusic write to your Apple Music library. It can never remove from it | on / off |
| Show ✓ on songs you have | The + on a song row becomes a ✓ when you already have the song | on / **off** |
| Export playlists | Offers **Export ▸ Apple Music** on playlists made here. DeetsMusic cannot rename, reorder or delete on Apple Music | **on** / off |

### Last.fm

| Control | What it does | Choices |
|---|---|---|
| Scrobble plays | Sends each song to your Last.fm profile once you hear half of it, or 4 minutes | on / off |
| Show now playing | Your Last.fm profile shows the song while it plays | on / off |

### Playlists

| Control | What it does | Choices |
|---|---|---|
| Show playlist counts | Fills in the song count on the overview. One small request per playlist, once | **on** / off |
| New playlist opens Search | Puts Search beside the new playlist. Mini shows one card, so Search would hide it | **Not in mini** / Always / Never |
| Cover while playing | For a song played from a playlist: the cover shown in Now Playing, in mini and in the tray panel | **Album** / Playlist |
| New cover | How a new playlist's cover starts. Letters and Note keep the theme you made it in | **Letters** / Mosaic / Note |
| Web reach | How far a playlist web goes. 1 reaches the artist's collaborators; each step reaches one circle further | 1 / **2** / 3 |
| Web size | Songs in a new web playlist | 25 / **50** / 100 |
| Web prefers songs | Familiar puts your songs first; Discover puts songs you don't have first | Familiar / Discover / **Mix** |
| Web genre chips filter | What a picked genre chip does to the seed artist's own songs | **All songs** / Keep 5 / Web only |
| Web panel closes | How the web panel leaves when you press Make playlist | **Shrink to chip** / Pop out |

### Rewind

| Control | What it does | Choices |
|---|---|---|
| Rewind card | Your listening, ranked. It offers itself once you have 50 plays | on / **off** |
| Count a play at | When a play counts as listened through | **90%** / End / Half or 4 min |
| Weekly Replay | A playlist of the past week's most-played songs, made on this weekday | **on**, **Mon** |
| Keep every Replay | Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly | on / **off** |

### Connections

| Control | What it does | Choices |
|---|---|---|
| Agent control | Lets a command line or an AI app drive DeetsMusic on this PC. **Guide** opens the setup page | on / off |
| Agent changes settings | An agent changing these settings. Agents can never change this row itself | Allow / **Ask** / Off |
| Agents read play history | Lets a connected agent see what you played, when, and what you skipped | on / off |
| Copy setup for | Copies the exact setup text for that app | Claude Desktop / Claude Code / Cursor / Other (Full) / **Other (Small)** |
| The extension block | Whether the browser bridge and the agent are running | — |

### Updates

| Control | What it does | Choices |
|---|---|---|
| Get updates | **Automatic** downloads in the background, then asks to restart. **Ask** asks before the download | **Automatic** / Ask / Off |
| Check for updates | **Check now** | — |
| Roll back | Pick an older version and **Install** it | — |

### Reset
One **Reset** button for each group. Each one asks first, and offers Undo after.

Look and feel › (Theme and skin · Look schedule · Motion · Skin settings) · Menus, hints and
notices · Window · Playback · Playlists · Sound · Home · Rewind · **Everything**.

A group already at its defaults flashes *Default* instead. Not reset: Close to tray, Start with
Windows, the Apple Music and Last.fm consents, Agent changes settings, and Updates.

### Bugs
The version and **Copy** · **What went wrong** (Playback / Sign-in / Library or playlists /
AirPlay / Updates / Something else) · **Attach log** · **Send**: *Bug* or *Suggestion* ·
**App log**: Open folder, Copy · **My reports**, one row per report you sent (Open · Copy link ·
Close · Clear).

A suggestion never carries the log.

### About
The version, the Apple trademark notice, and what the app contacts.

---

## Right-click menus

Right-click any row, tile or cover.

| Where | Items |
|---|---|
| **A song** (Library, Search, History, Rewind, Now Playing) | Play Now · Play Next · Add to Queue · Add to Playlist · Go to Artist · Go to Album · Song Credits · Start Station · Copy Link |
| **An album, artist or genre** | Play Now · Add to Queue · Add to Playlist · Go to Artist · Start Station · Copy Link |
| **A song in the Queue** | Play Now · Move to Top · Move to Bottom · Remove · Add to Playlist · Go to Artist · Go to Album · Start Station · Stop Station · Don't resume |
| **A playlist** | Play Now · Play Next · Add to Queue · Move to Folder · Remove from Folder · Generate Cover (Note / Mosaic) · Remove Cover · Import to Edit · Keep Playlist · Delete Playlist |
| **A song in a playlist** | The song items, and Remove from Playlist |
| **A folder** | Delete Folder |
| **A Home tile** | Play Now · Add to Queue · Open in Playlists · Hide (with Undo) |
| **A station** (Radio) | Play Now · Add to Queue · Copy Link |
| **The tray panel** | Add to Library · ♥ · Copy Link |
| **A card's title** | Grow · Fill · Collapse, and the card picker |
| **A text field** | Cut · Copy · Paste · Select All |

---

## The cards

| Card | What it is |
|---|---|
| **Now Playing** | The song, the cover, the transport. Always on screen |
| **Queue** | Up Next, and what played before |
| **Library** | Everything in your Apple Music library |
| **Search** | Your library and the Apple Music catalogue |
| **Playlists** | Your playlists and folders |
| **Home** | Three shelves of what to play next |
| **History** | What you played, newest first |
| **Radio** | Apple's stations |
| **Rewind** | Your listening, ranked. Off until you have 50 plays |
| **Settings** | This card |

### Card headers

**Library** — tabs **Songs** · **Albums** · **Artists** · **Genres**.

| Tab | Sort by |
|---|---|
| Songs | A–Z · Artist · Album · Release Date · Added Date · Length · Genre · Plays |
| Albums | Track Order · A–Z · Release Date · Added Date |
| Artists | A–Z · Song Count |
| Genres | A–Z · Song Count · Artist Count |

Song columns: # · Title · Artist · Album · Length · ♥ · Genre · Year · Plays.

**Playlists** — Playlists | Folders · A–Z | Added Date.
Inside a playlist: Playlist Order | A–Z | Artist | Songs.

**Radio** — Stations | Featured · A–Z.

**Search** — Artists · Songs · Albums · Playlists · Stations; Library | Apple Music.

---

## Playlist groups and folders

The Playlists card sorts everything into five fixed groups, in this order. Each one folds.

| Group | What is in it |
|---|---|
| **Made Here** | Playlists you made in DeetsMusic. They stay on this PC until you export one |
| **Your Apple Playlists** | Your own playlists on Apple Music |
| **Apple Mixes** | Apple's personalised mixes — New Music Mix, Favourites Mix, and the rest |
| **Apple Replays** | Apple's yearly Replay playlists |
| **Saved from Apple Music** | Apple Music playlists you saved |

Below them are **your own folders**. Make one with **New… ▸ Folder**. A right-click gives
**Move to Folder**, **Remove from Folder** and **Delete Folder**.

A temporary web playlist carries **Temp | N days** and deletes itself that long after its last
play. Right-click › **Keep Playlist** makes it permanent.

---

## Glossary

Every word the app uses that is not plain English: what it means, and where you meet it.
Words in *italics* have their own entry.

| Term | What it means | Where it is |
|---|---|---|
| **Adaptive sound** | Three effects that follow what you are doing: *match loudness*, fuller at low volume, and *crossfeed*. One switch sits over all three | Sound panel › Adaptive sound |
| **AirPlay** | Apple's way of sending sound to a speaker over your network | The title bar; Settings › AirPlay |
| **Apple Mixes** | Apple's personalised mixes. Their names all end in "Mix" | Playlists card, a group in the *rail* |
| **Apple Replays** | Apple's yearly Replay playlists. Not the *weekly Replay* this app makes | Playlists card, a group in the *rail* |
| **Backlight** | The light behind a *Glass* card, under its *tint* | Settings › Look and feel (Glass only) |
| **Canvas** | The background behind the cards | Settings › Look and feel (Glass only) |
| **Card** | One panel of the app: Now Playing, Queue, Library, Search, Playlists, Home, History, Radio, Rewind, Settings. A *surface* holds one to four of them | Everywhere |
| **Chip** | A small button that carries a value, such as a genre in a *web* | The web panel; the Sound panel |
| **Collapse** | Put a *grown* card back to its normal size | A card's title menu, or a click outside it |
| **Compass** | The search bar under the title bar. It reaches every card, setting, verb and library item | Ctrl+Space, or the Go anywhere button |
| **Crossfeed** | Mixes a little of each stereo side into the other, as speakers in a room do. It makes headphones less tiring | Sound panel › Headphone crossfeed |
| **Drill** | Following a link deeper: Go to Album, a *shelf* tile, a playlist. Back returns you | Right-click menus; Settings › Window › Card on drill |
| **Equalizer** | Ten sliders that raise or lower parts of the sound | The Sound button in the title bar |
| **Fancy Glass** | The *Glass* skin's live blur. Off, the *frost* is painted in, which costs nothing to redraw | Settings › Look and feel (Glass only) |
| **Fill** | Grow a card over all four *slots* in *Max* | A card's title menu, or the gaps |
| **Folder** | A group of playlists you make yourself. Not one of the five fixed groups | Playlists card › New… ▸ Folder |
| **Frost** | The blurred or painted layer that makes a *Glass* card readable | The Glass skin |
| **Grow** | Open a card over its neighbor, from the gap beside it | The gaps; a card's title; Settings › Window |
| **Half** (split) | One pill cut in two. Each half is its own button | Settings rows; the Surface menu |
| **Hint** (hover hint) | The small themed box that appears when the pointer rests on a control | Everywhere; Settings › Look and feel |
| **Home** | A card with three shelves of what to play next. It makes no requests to Apple | The card picker |
| **Host** | The person who started a *room*. Only the host can end it, or set what guests may do | The Room panel |
| **LUFS** | The unit loudness is measured in. Apple's *Sound Check* level is −16 LUFS | Sound panel › Match songs to |
| **Made Here** | Playlists you made in DeetsMusic. They stay on this PC until you export one | Playlists card, the first group |
| **Match loudness** | Plays every song at about the same loudness, so you do not reach for the volume | Sound panel › Adaptive sound |
| **Max** | The wide *surface*: the *stage*, the queue, and four cards | The Surface menu |
| **Midi** | The tall *surface*: Now Playing and two cards | The Surface menu |
| **Mini** | The small *surface*: Now Playing and one card | The Surface menu |
| **Mosaic** | A playlist cover built from the covers of its songs. It is never saved to disk | Right-click a playlist › Generate Cover |
| **Notice** | See *toast* | — |
| **NP** | The *surface* that shows the player alone. Written **Player (NP)** in Settings and the *Compass* | The Surface menu |
| **Pill** | A small rounded control that shows its current value. Click it for the next one | Settings rows; the panels |
| **Pin** | Hold a *grown* card open against an outside click | A grown card's header |
| **Player** | See *NP* | — |
| **Preset** | A saved *equalizer* curve: a built-in one, or one you saved | The Sound panel |
| **Rail** | The list of groups and folders down the side of the Playlists card | Playlists card |
| **Record player** | The *Press* skin's cover as a turning record | Settings › Look and feel (Press only) |
| **Replay** (weekly) | A playlist of the past week's most-played songs, made by this app. Not Apple's yearly *Apple Replays* | Settings › Rewind |
| **Rewind** | A card that ranks your listening. It offers itself once you have 50 plays | The card picker |
| **Room** (listening room) | Listening in step with other people, over an 8-character code | The title bar |
| **Sand** | The *Ocean* skin's card edges broken into grains | Settings › Look and feel (Ocean only) |
| **Scrobble** | Sending a song you heard to your Last.fm profile | Settings › Last.fm |
| **Scrubber** | The playhead you drag to move through a song | Now Playing; Settings › Look and feel |
| **Seed** | The artist, song or album a *web* is built from | The web panel |
| **Shelf** | A row of tiles that scrolls sideways | The Home card; artist views |
| **Skin** | The form of the app: type, corners, motion, texture. Press, Ocean, Glass or Cyber. A *theme* is the color; a skin is the shape | The title menu |
| **Slot** | A place on a *surface* where one card sits | Every surface |
| **Sound Check** | Apple's name for playing every song at one loudness. Our *match loudness* targets its level | Sound panel |
| **Stage** | The tall left column in *Max*: the big cover, Now Playing, and the queue | Max |
| **Station** | An endless stream of songs around a *seed*. Apple builds it | The Radio card; right-click › Start Station |
| **Summon** | Bring a card into a *slot* | The card pickers; Settings › Window › Card on drill |
| **Surface** | The window size and what it holds: *Mini*, *NP*, *Midi* or *Max* | The title menu |
| **Temp playlist** | A *web* playlist that deletes itself a set number of days after its last play. **Keep Playlist** makes it permanent | The web panel; right-click a playlist |
| **Theme** | The colors: Lilac, Green, Sepia, Moonlight, Black & Yellow, Black & Red. A *skin* is the shape; a theme is the color | The title menu |
| **Tile** | One cover-sized item on a *shelf* | Home; artist views |
| **Tint** | How much theme color fills a *Glass* card | Settings › Look and feel (Glass only) |
| **Toast** | A short notice that slides in, then leaves. A failure always shows one | Everywhere; Settings › Look and feel › Show notices |
| **Tray** | The Windows notification area, by the clock. DeetsMusic can live there | Settings › Window |
| **Up Next** | The songs the queue will play after this one | The Queue card |
| **Web** (playlist web) | A playlist built from an artist and the people they work with, reaching out in steps | Playlists card › the web button |
| **Wind down** | The last minutes of the sleep timer, over which the volume sinks to nothing | The sleep panel |

---

## Index — find it by what you want to do

| I want to… | Go to |
|---|---|
| Change the colors | Title menu › Theme |
| Change the shape and texture | Title menu › Skin |
| Change the window size | Title menu › Surface, or drag the window edge |
| Set the size each view opens at | Settings › Window › *… opens at* |
| Keep the window above other windows | Settings › Window › Keep on top |
| Stop the app quitting when I close it | Settings › Window › Close to tray |
| Start the app with Windows | Settings › Window › Start with Windows |
| Make the app dark at night | Settings › Look and feel › Change look at |
| Turn the animation down | Settings › Look and feel › the four Animate rows |
| Stop the hover boxes | Settings › Look and feel › Show hover hints |
| See fewer notices | Settings › Look and feel › Show notices |
| Open a card over its neighbor | Settings › Window › Grow cards from edges, then click a gap |
| Keep my cards where I left them | Settings › Window › Keep card places on restart |
| Change the sound | The Sound button in the title bar |
| Even out loud and quiet songs | Sound panel › Adaptive sound › Match loudness |
| Make quiet listening less thin | Sound panel › Adaptive sound › Fuller at low volume |
| Play to a speaker | The AirPlay button; Settings › AirPlay sets which sound it sends |
| Stop the music at bedtime | The sleep timer button |
| Listen with a friend | The listening room button |
| Change what Play Now plays | Settings › Playback › Play Now plays |
| Make Shuffle a mode that stays on | Settings › Playback › Shuffle button stays on |
| Bring back my last song at launch | Settings › Playback › Restore on launch |
| Let the app write to my Apple Music library | Settings › Apple Music › Add to Library and ♥ |
| Send my plays to Last.fm | Settings › Last.fm |
| Build a playlist from an artist's circle | Playlists card › the web button |
| Change how a new playlist's cover looks | Settings › Playlists › New cover |
| Get a weekly playlist of what I played | Settings › Rewind › Weekly Replay |
| See my listening ranked | Settings › Rewind › Rewind card |
| Let an AI app control the player | Settings › Connections › Agent control |
| Control when updates arrive | Settings › Updates › Get updates |
| Go back to an older version | Settings › Updates › Roll back |
| Put a setting back to its default | Settings › Reset |
| Report a problem | Settings › Bugs |
| Find any of the above by typing | Ctrl+Space, the *Compass* |
