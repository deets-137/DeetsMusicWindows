# Release notes

The text for each GitHub Release. Newest first. Plain words, for the person installing.
Settings paths are the current names (Settings sections were regrouped after 0.4.0).

Each entry, up to its first `###`, is copied into the update index by `release:publish` and
shown in the app's update offer and on `deets.solutions/deetsmusic/` (RELEASE.md §6.2, §6.7).
So keep the body to paragraphs and **bold**, and use absolute links only: a relative link
works on GitHub and breaks on the site.

**Before `release:publish` of 0.5.0:** installers after 0.4.3 are code-signed (RELEASE.md §6.9),
but SmartScreen may still warn on a browser download until reputation builds. Check what a
browser download of the 0.5.0 installer shows, and correct its Installing line to match. Older
entries stay as written: they were true for their version.

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

- **The installer is code-signed**, with the publisher Aditya Sundaram. If Windows SmartScreen
  still shows a notice on a browser download, click **More info**, then **Run anyway**.
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
