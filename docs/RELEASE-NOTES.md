# Release notes

The text for each GitHub Release. Newest first. Plain words, for the person installing.
Settings paths are the current names (Settings sections were regrouped after 0.4.0).

Each entry, up to its first `###`, is copied into the update index by `release:publish` and
shown in the app's update offer and on `deets.solutions/deetsmusic/` (RELEASE.md §6.2, §6.7).
So keep the body to paragraphs and **bold**, and use absolute links only: a relative link
works on GitHub and breaks on the site.

**For the next entry:** installers after 0.4.3 are code-signed (RELEASE.md §6.9), but a signed
file still starts with no download reputation. Checked 2026-09-15 with 0.5.0: Microsoft Edge
warned "isn't commonly downloaded" (Keep › Show more › Keep anyway). Checked again 2026-09-15
with 0.6.0, downloaded from `deets.solutions/deetsmusic/`: the same Edge warning, now naming the
publisher (Aditya Sundaram); the box offered Cancel and **Delete ▾**, and the path was
**Delete ▾ › Keep anyway**. Windows showed no "Windows protected your PC", and the install
worked. Copy 0.6.0's Installing lines until a browser download of a new version shows no warning. Only the text above the
first `###` reaches the update offer and the website, so the Installing lines are for a
download page. Older entries stay as written: they were true for their version.

## 0.11.0 — 2026-09-18

**Song of the Day.** Right-click any song and **Mark as Song of the Day**: one song, for one
day, kept on this PC. Your picks gather on a new shelf at the foot of Home, each with the day
it belongs to, and Rewind's new **SOTD** button turns its board into your picks, newest first,
with **Make playlist** to turn a stretch of them into a playlist. Settings › Song of the Day
holds the whole thing: whether a day starts at midnight or 5 AM, how many picks a day may
hold, and a switch to turn the feature off entirely without losing a single pick.

**It can post them to Discord, if you ask it to.** Paste one webhook link from your own
channel — no bot, no account, nothing to register — and a marked song is posted there as a
plain Apple Music link. You choose when: it can ask you each time, post right away, or wait
until a time you set. The webhook link is encrypted on your PC and never appears in a log or
a bug report. **Posted something you would rather take back?** A **Withdraw** button pulls the
message out of the channel and keeps the pick. Settings shows **What has left this PC**: every
post, with its state and the time it went, and a Copy button for the lot.

**Pins.** Keep a playlist, a station, an album, an artist or a song in view. A pinned thing
gets a tile at the top of Library, Playlists or Radio, and a shelf of its own on Home, ordered
by what you play most. The pin badge on a tile is a button: press it to unpin.

**The DeetsBar does sums.** Press **Ctrl + Space** and type a sum — `18*3`, `1h20 in minutes`
— and the answer sits at the top of the list. Press Enter to copy it.

### Installing

Windows 11, 64-bit. The installer is per-user and asks for no administrator prompt.

The installer is code-signed, but a new version starts with no download reputation, so a
browser may still warn. In Microsoft Edge the path is **Delete ▾ › Keep anyway**; the box names
the publisher (Aditya Sundaram). Windows itself shows no warning.

## 0.10.1 — 2026-09-18

**A tour on the first launch.** Deets and Happy, the two sprites from deets.solutions, meet a
new user under the DeetsMusic title and walk them through five steps: sign in to Apple Music,
click **DeetsMusic**, click a section title, press **Ctrl + Space**, and a send-off. Each step
waits for you to do the thing it names, so nothing is clicked past; a **Next** button appears
only after a step has waited a while. **Escape** skips the tour. It runs once, on a fresh
install, and never on an update. Settings › Tips › **Show the tour again** brings it back, and
so does typing **tour** in the DeetsBar.

**Rooms start with your song, and a paused listener rejoins.** In 0.10.0 a room started from
a playing app could open empty: guests joined, nothing played, and both Queue cards stayed
blank. The host now seeds the room with its song and Up Next before it connects. A guest who
pressed Pause and then Play took the room's position but stayed silent; Play now plays. The
count badge on the title bar's room button is gone: the hover hint and the panel already say
who is in the room.

**Home shows what you played and added on your phone.** Recently Played folds in the plays
Apple Music saw on your other devices, in the right order, and Recently Added follows Apple's
own list, so an album you added on the phone this morning leads the shelf here. Neither adds a
date to your play history, so Rewind's minutes stay measured. Signed out, Home asks nothing.

**The surface that shows the player alone is called Player.** It was NP in the Surface menu,
Player in the tray, and Player (NP) in Settings. One name now, everywhere. In the Surface menu
the **Mini | Player** halves are the same width with centred labels. Typing **np** in the
DeetsBar still finds it.

**Ctrl + Space closes the DeetsBar too.** The key that opens the bar puts it away. The compass
button in the title bar still opens it.

**A thin window uses the small volume pill.** Under a certain width the full volume bar pushed
the window buttons off the title bar. A thin window now switches to the small pill by itself,
and the full bar comes back when the window widens.

**Settings labels read plainer.** A pass over every row: *Shuffle button stays on*, *Cover
while playing*, *Web genre chips filter*, *Grown card on a new pick*, *Web prefers songs*,
*Songs not measured get*. Values and stored settings are unchanged. The Playlists rail groups
are now *Made Here*, *Your Apple Playlists*, *Apple Mixes*, *Apple Replays* and *Saved from
Apple Music*.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.10.0 — 2026-09-18

**Listen with friends.** A new item in the title bar — three figures side by side — opens the
**Room** panel. Type your name, click **Start a room**, and the panel shows an eight-character
code with **Copy code** and **Copy invite link**. A friend pastes the code into **Join**, or
clicks your link and DeetsMusic joins for them. Everyone hears the same song at the same
moment, each through their own Apple Music. The room's queue becomes your queue: Now Playing,
Up Next and the Queue card show the room, and Up Next says who added each song. Under
**Permissions**, the host chooses what guests may do — Play, Skip, Seek, Add songs and
Reorder — each **Everyone** or **Host only**. A guest's Pause always works: it stops their own app, and
the room plays on. Room songs count in History, Home, your play counts and Last.fm. Details:
[listening rooms](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/ROOMS.md).

**Who wrote this song.** Right-click any song — anywhere in the app — and pick **Song
Credits**. The pane names the writers, each one a chip. Click a writer and you see everything
of theirs in your library. The credits come from the song information DeetsMusic already
reads, so this costs no extra Apple Music requests.

**A bigger, squarer cover.** The Max window's left column is rebuilt. The cover is always a
square and is never cropped, at every window height. Now Playing keeps its room and the Queue
takes the rest: the art and the song come first, and the queue is something you open when you
want it. Click the strip above the Queue, or its **Grow** button, to open the Queue over Now Playing.
The default Max window is now 1100×950. Settings › Window › **Max window when short** chooses
what a short screen does: become Midi, or stop at the floor.

**AirPlay asks before Windows does.** The first time you pick a speaker, the **Play on** panel
explains in one sentence why Windows is about to ask for permission, and names what it runs.
**Continue** answers it once; **Not now** leaves the list alone. DeetsMusic also sends the
music to the speaker only — your headphones stay silent.

**More from Ctrl+Space.** A card row now says how the card opens: type **full settings** or
**settings full**, or press **Tab** on the highlighted row to pick Card, Horizontal, Vertical
or Full. The compass mark in the title bar turns as the bar opens, and on through a full circle
when a row takes you somewhere. **Ctrl+L**, **Ctrl+K**, **Ctrl+Q**, **Ctrl+P** and **Ctrl+,**
now work while the bar is open.

**Also:** a list keeps its place — a right-click, a Ctrl+click or Shift+click, or a change of
row size no longer throws the list back to the top. A panel no longer closes under your own
press, which fixes a Settings row inside the Compass bar and several panels besides. Sound ›
Adaptive › **Match loudness** says **Measured.** for a song it has already measured, and the
percentage moves while a new one plays. The Library's **Plays** sort reads the right count.
DeetsMusic now checks every ten minutes that its own database is still writable, and says so
in the app log.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.9.5 — 2026-09-17

**Go anywhere with Ctrl+Space.** Press **Ctrl+Space** (or click the compass right of the
DeetsMusic title) and a bar drops under the title bar. Type a few letters: the cards, the window
sizes, the themes and skins, every Settings row, the transport (play, next, shuffle, repeat,
mute, the sleep timer), the equalizer presets, Up Next, what you played, your AirPlay speakers,
and your library — songs, albums, artists, genres, playlists and stations. Enter goes there;
Ctrl+Enter plays. Chips above the library rows pick a kind (Tab moves between them). A setting
you can flip shows its switch right in the bar. Commands: **fav**, **add**, **queue Fancy 3**,
**web Samara Cyn 1 R&B** (a playlist web, made and opened), **grow library**, **volume 40**.
The bar knows synonyms (skip, prefs, airplay) and forgives a typo. Every term is listed in the
[Compass guide](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/COMPASS-TERMS.md).
It makes no Apple Music calls while you type. Settings › Window › **Compass closes on outside
click** is on.

**The keyboard, everywhere.** **Space** plays and pauses. In every list — the Library, a
playlist, Up Next, History, Home, Search — **Tab** reaches the rows, the **arrows** move, **Enter**
does what a click does, the **Menu key** opens the right-click menu, **Escape** goes back.

**A card comes back where you left it.** Swap a card out and back, change the window size, or
grow a card and drill: the card returns to the same playlist, album or artist, at the same
scroll, with the filter you typed. Settings › Window › **Keep card places on restart** keeps
that across a restart too (off by default).

**Genres in the Library.** View › **Genres**: one mosaic tile per genre, with song and artist
counts; open one for its songs, albums and artists. The Sort menu of the song list lost Artist,
Album and Genre — those are views now — and a grown card's column headers still sort by them,
in record-shop order (by artist, then album, then track).

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.9.0 — 2026-09-17

**Grow a card.** In the Max and Midi windows, move the pointer over a card's title and click the
new **Grow** button, or click the gap beside a card. The card opens over its neighbor. In Max,
click again (**Fill**) to open it over all four cards. Grown, the Library card shows a letter
rail on the side and song columns (Artist, Album, Length, Genre, Year, Plays) that sort when you
click their headers. Click outside the card, press **Esc** or click **Collapse** to close it;
**Pin** keeps it open. Settings › Window has three rows for it, and **Grow cards from edges**
turns it off. Details: [card grow](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/CARD-GROW.md).

**Playlist webs from a song or an album.** In the web panel (the web button in the Playlists
card header), pick **Artist**, **Song** or **Album** above the search field. A song or album web
starts from every artist credited on it, puts the song or the album's songs first, and picks its
genre chips for you. An album web reaches 2 steps at most. The playlist name now carries the
genres you pick, for example "V (Deluxe) Reggae Web".

**Temporary web playlists.** Under **Make playlist**, choose **Keep** or **Temp**. Temp is the
default: the playlist is deleted a number of days after you last play it. Click the days to go
up (1, 3, 5, 7 or 30 days) and right-click them to go down. A temporary playlist's row shows
**Expires** and the date. To keep one, right-click it › **Keep Playlist**. When one is deleted, a
notice offers **Undo**. A playlist you export to Apple Music is always kept. Web playlists made
before this version are never deleted. Details: [the playlist web](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/PLAYLIST-WEB.md).

**Add songs to your library from any list.** Point at a song in Search, a playlist, the Queue or
History and click **+** at the end of its row. To see a ✓ on songs you already have, turn on
Settings › Apple Music › **Show ✓ on songs you have**.

**Retro-Future is now Cyber.** The skin has a new name. Your choice moves over by itself.

**Also:** Playlist webs make fewer Apple Music requests: a change during a build stops the old
build, and a search you already made is not sent again. In Sound › Adaptive, **Match loudness**
is now off until you turn it on; songs are still measured, so it works at once when you do.
Connecting Last.fm no longer tries to bring the browser back to the app: after you click
**Allow**, return to DeetsMusic yourself.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.8.0 — 2026-09-16

**Sound: an equalizer and adaptive sound.** Click the three small sliders in the title bar, left
of the alarm clock. Every effect is **off** until you turn it on. The panel has two tabs.
**Equalizer** turns ranges of sound up or down: pick a preset (Bass lift, Vocal, Treble lift,
Late night and more), move the ten sliders, or save your own. Hold **Compare** to hear the music
without the effects at the same loudness. With **Remember each output** on, your headphones,
speakers and AirPlay speakers each keep their own preset. **Adaptive** has three parts:
**Match loudness** plays every song at about the same loudness (it measures a song the first time
you hear most of it, and an album played in order moves as one); **Fuller at low volume** adds
bass and a little treble as you turn the volume down, because quiet music sounds thin to the ear;
**Headphone crossfeed** mixes a little of each side into the other on headphones, as speakers in
a room do. Open **How … decides** under each tab to see what each part is doing to the song now,
and why. The effects change only DeetsMusic's sound, not other apps. After 7 days of use the app
asks once whether to keep them. Details: [the Sound design](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/SOUND.md).

**Last.fm scrobbling.** Open the title menu › **Account** and click the button on the Last.fm
row, then click **Allow** on the Last.fm page that opens in your browser. A song is sent to your profile when you hear half of it
or 4 minutes. Your profile also shows what is playing now. Plays wait on your PC while you are
offline and are sent later. Settings › **Last.fm** pauses either part. Details:
[Last.fm in DeetsMusic](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/LASTFM.md).

**Playlist web.** Click the new web button in the Playlists card header, between **+** and
**Sync**. Pick an artist. DeetsMusic makes a playlist from that artist and the artists they make
songs with. **Reach** (1, 2 or 3 steps out), **Size** (25, 50 or 100 songs), **Prefer** (Familiar,
Discover or Mix) and genre chips shape it before you click **Make playlist**. Details:
[the playlist web](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/PLAYLIST-WEB.md).

**Stream quality.** Settings › Playback › **Stream quality**: **Auto** (the default) picks High
or Low from your connection and follows it while you listen; **High** and **Low** stay put. A
change applies from the next song. Details:
[audio quality](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/AUDIO-QUALITY.md).

**Fancy Glass.** In the Glass skin, Settings › Look and feel › **Fancy Glass**
turns on the live frost and the moving background. It is off by default: on a PC without a
graphics card it costs most of the frames.

**AI apps can read your library.** An AI app connected to DeetsMusic can list your songs by plays,
length or date added, and ask read-only questions of your library and play history ("what is my
shortest song?"). It cannot change anything this way. To keep your play history from AI apps,
turn off Settings › Connections › **Agents read play history**. Details:
[local data for agents](https://github.com/deets-137/DeetsMusicWindows/blob/main/docs/LOCAL-DATA.md).

**Also:** The AirPlay button is redrawn: a ring the arrow cuts, and the arrow rises when a speaker
plays. In Rewind, **Make playlist** no longer squeezes the two pickers.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.7.0 — 2026-09-16

**Sleep timer.** Click the alarm clock next to the volume bar. Turn the dial to set the
minutes. Or click **End of song** or **End of Up Next**. The music pauses when the time runs
out. **Wind down** lowers the volume over the last minutes. **Play out song** lets the last
song play to its end. **Every day** sets the timer each day, at sunset or at a time you pick.

**Full volume bar.** The volume bar in the title bar is now always full size. It has mute and
AirPlay in every window size. To get the small pill back, turn on Settings › Window ›
**Shrink volume bar**.

**Song bar handle for each skin.** Each skin has its own handle on the song bar: Press, Ocean,
Glass and Retro-Future. To use a plain handle, turn off Settings › Look and feel ›
**Fancy scrubber**.

**Shuffle and Repeat show when on.** The Shuffle and Repeat buttons now fill when they are on.
The Shuffle arrows move each time you click the button. The Repeat loop turns once when you set
it to one song.

**New hover hints.** Hints now show in a box that matches your theme. Settings › Look and feel
has three new rows. **Show hover hints** turns the hints on or off. **Hints appear after** sets
how long you hold the pointer before a hint shows. **Name songs on hover** shows the full song
name when a row cuts it off.

**Also:** The window buttons are in the Windows order: minimize, maximize, close. On an artist
page in Search, the playlist rows now line up with the albums. AI apps connected to DeetsMusic
can read the songs on an album or playlist. They do not change anything to do this.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.6.3 — 2026-09-15

**Home card.** Home shows three rows of tiles. The first row shows the music you played last.
The second row shows the music you added last. The third row shows the music you play most at
this part of the day, on a weekday or on a weekend. The parts of the day are morning (5 to 11),
afternoon (11 to 17), evening (17 to 22) and night (22 to 5). The score is the minutes you
listened in that part of the day, and a play counts half as much after 42 days. The third row
shows when 5 songs, albums, playlists, stations or artists have a score. To remove a tile,
right-click it and click **Hide**. Settings › Home sets how long a tile stays hidden.

**Full play history.** The History card now shows the songs you played before you closed the
app. A small mark shows each song you skipped. To show the day on each row, turn on Settings ›
Playback › **Show the day in History**.

**Select many rows.** Ctrl+click selects a row. Shift+click selects all rows between two rows.
Ctrl+A selects the full list. Escape or a plain click clears the selection. This works in the
Library, Playlists, Search, History, Rewind and Up Next. Drag the selected rows onto a
playlist. Or right-click them to play them, add them to a playlist, or remove them.

**Add to Playlist in more places.** Right-click a song in Up Next or History and click
**Add to Playlist**. You can also right-click the cover in Now Playing or the Queue. This works
for station songs too.

**Empty playlists.** An empty playlist now shows its Play and Shuffle buttons, turned off. It
also shows a space where you can drop songs.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.6.2 — 2026-09-15

**Each window size opens where you want it.** Settings › Window now has a row for every window
size — Mini, NP, Midi and Max. Pick a size from the list, or press **Set current** to save the
size the window has now. That view opens at that size every time, from the title menu, the tray
icon, or when the app starts. NP, the player on its own, is wider and steadier than before, and
it no longer turns into Midi when you make it wider.

**Two fixes in the cards.** Play and Shuffle no longer show above a list with nothing in it. And
a change of skin no longer scrolls the top of a card out of view.

**AirPlay: DeetsAirplay can see the speaker you are using.** If you also run DeetsAirplay, its
speaker list now marks the speaker DeetsMusic is playing to, shows what DeetsMusic is playing,
and can ask DeetsMusic to let the speaker go. You need both apps for this; DeetsMusic alone is
unchanged.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.6.1 — 2026-09-15

**Repeat and shuffle.** Now Playing has a Repeat button next to Shuffle: press it for the whole
list, again for one song, again for off. Shuffle now stays on until you turn it off. Every album,
playlist and artist page has a Play and a Shuffle button above its songs.

**The cover as a record.** Under the Press skin, Settings › Look and feel › Record player turns
the cover into a record that spins while the music plays. Show record on picks where: the big
cover only, or the tray panel too.

**Hover for help.** Hold the pointer on any button for a moment and a short note says what it
does: the theme and skin names, the window sizes, every player button, Sort and View. Settings
has a new Tips section at the top with the six habits that open up the rest of the app.

**Stations do more.** Right-click a station in Radio or Search to play it, add it to the queue,
or copy its link. Drag a station onto the Queue card and it plays after your songs finish; drag
it onto Now Playing and it plays now.

**The tray panel.** Right-click the song in the tray panel to add it to your library, favorite
it, or copy its link.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.6.0 — 2026-09-15

**Artist pages.** Click an artist in the Library or in Search to open its page: a round photo of
the artist, then Albums, Featured Playlists (Apple Music playlists with the artist), Your
Playlists (your own playlists that have the artist's songs), and the songs. Your Playlists can
also check Apple Music playlists you have not opened yet: click Check more on the shelf.

**Sort an artist's songs by popularity.** On a Library artist page, Sort › Popular puts the songs
in the order Apple Music ranks them, and Sort › Most Played puts the songs you play most in
DeetsMusic first. Sort, View and Search sit above the songs and stay in view while you scroll.

**Cards that move.** Settings › Look and feel › Animate card swaps (off at first) moves the cards
when you swap them, in a way that fits your skin. With it on, a playlist you open from an artist
page flies to the card that opens it. Go to Artist and Go to Album no longer swap two cards that
are both on screen.

**Reset settings.** Settings › Reset puts one group of settings back to the defaults: Look and
feel (or only its theme and skin, look schedule, motion, or skin settings), Window, Playback,
Playlists, Rewind, or Everything. It asks first, and you can undo it for 6 seconds. It does not
change Close to tray, Start with Windows, Updates, or what you allowed DeetsMusic to do with
Apple Music and AI apps.

**Find your version.** Settings › Bugs shows the version with a Copy button, and it is the first
line of About. When an AI app changes your theme, skin or window size, the change now plays more
slowly, so you can see it happen.

### Installing

- **The installer is signed by Aditya Sundaram.** A new version has little download history,
  so your browser may still warn that it isn't commonly downloaded.
- **Edge:** in the download list, click **…** › **Keep**, then the arrow on **Delete** ›
  **Keep anyway**.
- **Firefox:** in the downloads panel, click the arrow next to the file and allow the
  download. When you open it, Windows may show a blue screen: click **More info**, then
  **Run anyway**.
- **Chrome:** in the download list, click **Keep**. When you open it, Windows may show a blue
  screen: click **More info**, then **Run anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.5.0 — 2026-09-15

**Day and night looks.** Settings › Look and feel › Change look at switches between a day look
and a night look (a theme and a skin): at sunrise and sunset, at times you set, or with the
Windows light or dark mode. Sun times come from your time zone, so DeetsMusic never asks where
you are.

**A smoother start.** DeetsMusic opens with its cards rising into place instead of drawing in
one by one. A theme or skin change plays the same animation.

**Skins get their own settings.** Under Glass, Settings › Look and feel has Canvas glow, Dim
canvas, Backlight, and Tint cards. Under Ocean, Draw card edges can turn the card edges to sand,
with a Sand width slider. The rows show only while that skin is on.

**Playlist covers.** A new playlist gets a cover with its letters, in the colors of your theme
(Settings › Playlists › New cover). Right-click a playlist › Generate Cover draws one for an
older playlist. A playlist with no cover shows a picture made from up to 100 of its song covers.
To see a playlist's cover in Now Playing and the tray panel while its songs play, choose
Settings › Playlists › Show cover › Playlist.

**A mini player.** In the Surface menu, NP shows Now Playing alone in the small window.
Settings › Window › Keep on top can keep only the player on top, and Tray icon opens chooses
what a click on the tray icon shows.

**Report a bug from the app.** Settings › Bugs sends a bug or a suggestion. A bug can carry the
part of the log that fits the problem, and you can read that text before you send it. My reports
shows the state of each report and any new reply.

**More for AI apps.** An AI app connected to DeetsMusic can now add to your library, make and
edit playlists and folders, edit Up Next, check for updates, and change settings. The first
library or Apple Music change asks you in DeetsMusic. Settings › Connections › Agent changes
settings decides whether a settings change asks you each time, applies at once, or is refused.
An AI app can turn Add to Library and ♥, Export playlists, and Agent control off, but only you
can turn them on.

### Installing

- **The installer is code-signed**, with the publisher Aditya Sundaram. A new version has
  little download history, so Microsoft Edge may say the file "isn't commonly downloaded". In
  Edge's download list, click **…** › **Keep**, then **Show more** › **Keep anyway**.
- To check the file first, right-click it › **Properties** › **Digital Signatures**. It lists
  **Aditya Sundaram**, and **Details** says the signature is OK.
- If Windows shows "Windows protected your PC" when you open it, click **More info**, then
  **Run anyway**.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.4.3 — 2026-09-14

**DeetsMusic updates itself.** When a new version is out, DeetsMusic downloads it in the
background and asks you to restart. The restart takes a few seconds, and the song you were on
comes back where it stopped. Press Later to finish what you are doing, or Skip this version to
wait for the next one. Choose Automatic, Ask, or Off in Settings › Updates.

**Go back to an earlier version.** Settings › Updates › Roll back installs an earlier version
if a new one gives you trouble. Your library, playlists, and settings stay. (Roll back lists
versions from 0.4.3 on.)

**The extension question shows once.** The installer asks about the browser extension only
the first time. It does not ask again after you say No, after the extension is set up, or
during an update.

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**. Updates after this one install without that warning.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.4.1 — 2026-09-14

**Drag songs between cards.** Press and drag a song, album, artist, or playlist from any card.
Drop it on the Queue card to queue it where the line shows. Drop it on a playlist to add it.
Drop it on the Library card to add it to your library. Drop it on Now Playing to play it at
once; what you had queued plays after it (Settings › Playback › Drop on Now Playing). Press
Escape to cancel a drag.

**Edit your playlists.** Drag songs to reorder a playlist, rename it, give it your own cover,
and delete it (a playlist with songs asks first). Export a playlist to Apple Music, send it
new songs later, or import an Apple playlist to edit it here.

**Playback comes back after a network drop.** When the connection returns, the song you were
on reloads at the place it stopped.

**Smaller fixes.** The Settings scrollbar no longer shifts the rows when a section opens. A
card's title menu uses two columns when the window is too short. Right-click shows DeetsMusic
menus only; a text field gets Cut, Copy, Paste, and Select All. Browser keys such as Ctrl+F and
F5 do nothing in the app.

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.4.0 — 2026-09-13

**Sign in from a clear page.** The browser sign-in now opens a DeetsMusic sign-in page. When
you finish, the page sends you back to DeetsMusic and a notice confirms the sign-in. Click the
Account button again to cancel a sign-in that is still waiting.

**A large Library scrolls smoothly.** DeetsMusic draws only the rows near the screen, so a
library of thousands of songs scrolls smoothly and uses less memory.

**Settings are easier to scan.** Each section folds and remembers whether you left it open.
Notices now show for every action by default (Settings › Look and feel › Show notices).

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.3.2 — 2026-09-13

**Signing in works every time.** A sign-in now always asks Apple for a fresh sign-in, and
DeetsMusic checks it before saving it. Before, the sign-in page could reuse an old sign-in
that Apple no longer accepted and still say "Done".

**No restart after a sign-in.** Songs play as soon as you sign in again.

**Playback recovers by itself.** If Apple Music drops the connection for a moment, DeetsMusic
reconnects it before the next song. If Apple has really signed you out, a notice says so and
gives you a Sign in button. At launch, an expired sign-in is named at once instead of a
library sync failing quietly.

**Better bug reports.** The log now records playback and sign-in problems as they happen
(Settings › Bugs › App log).

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.3.1 — 2026-09-13

**DeetsMusic says what went wrong.** If Apple Music stops working, a notice names the cause
and gives the one button that fixes it: **Sign in**, **Try again**, or **Try now**. If the
problem is on Apple's side, DeetsMusic says your account is fine and keeps trying on its own.
The old "Unable to prepare for playback" box is gone.

**Sign-in is clearer.** Playing a song while signed out asks you to sign in. An expired
sign-in shows as "Sign-in expired" under Account. A sign-in that does not finish says so at
once, with a Try again button.

**Notices.** Short messages confirm or explain actions (Settings › Look and feel › Show notices).

**Also new:** smoother scrolling through a large Library, calmer moving backgrounds with a
Settings › Look and feel › Animate backgrounds choice, an Add to Library square on Search songs,
the official Apple Music icon on Apple playlists, and Settings › About.

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**.
- Quit any AI app that is connected to DeetsMusic before you install; it keeps a file open
  that the installer must replace.

## 0.3.0 — 2026-09-12

**Favorites.** Right-click a song › Favorite. The ♥ syncs with Apple Music. The Library has
a "Favorites only" filter.

**Faster start.** A song starts sooner after a click. The queue comes back after a restart.

**Songs Apple Music no longer offers are skipped.** DeetsMusic remembers them for 7 days,
then tries them again.

**Copy Link.** Right-click a song or an album › Copy Link. The link opens in Apple Music.

**Also new:** local playlist covers, pinned searches, a weekly Replay, smooth theme and
skin changes, Now Playing text in the album's colors, and a Glass "Play on" panel.

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**. The installer is per-user and asks for no admin rights.
- Quit any AI app that is connected to DeetsMusic before you install an update; it keeps a
  file open that the installer must replace.

## 0.2.1 — 2026-09-10

A fix for 0.2.0: the first speaker connect on an installed build now asks for the Windows
firewall permission it needs. (0.2.0 could skip the prompt and then fail with "Couldn't
reach".)

## 0.2.0 — 2026-09-10

**Play on a HomePod.** Click the AirPlay square next to the volume slider and pick a speaker.
The volume slider then controls the speaker, and the speaker starts at 20 % the first time.
The HomePod's touch surface and Siri control playback. The Home app on an iPhone shows the
song and its cover. The PC keeps playing too in this version.

**Control from an AI app or the command line.** Settings › Connections. Claude Desktop, Claude
Code, Cursor and any local MCP app can play, pause, search, queue and read what is playing.
"Copy setup for" gives you the exact text to paste. The guide is
[docs/AGENT-SETUP.md](AGENT-SETUP.md). Turn it off with one switch.

**Start with Windows.** Settings › Window. Starts in the tray at sign-in.

### Installing

- **Windows SmartScreen will warn you.** The installer is not code-signed yet. Click
  **More info**, then **Run anyway**. The installer is per-user and asks for no admin rights.
- **One Windows permission prompt on the first speaker connect.** Speakers reply over the
  network on their own, and Windows blocks that until it has a rule. DeetsMusic asks once.
- Windows 11. An Apple Music subscription. Sign in from the title menu › Account.
- Quit any AI app that is connected to DeetsMusic before you install an update; it keeps a
  file open that the installer must replace.

## 0.1.3 — 2026-09-09

First installer line: one instance only, the tray flyout, the browser extension, the
`deetsmusic` CLI and MCP server.
