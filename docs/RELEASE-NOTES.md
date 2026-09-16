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
