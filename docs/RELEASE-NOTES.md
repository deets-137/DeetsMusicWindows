# Release notes

The text for each GitHub Release. Newest first. Plain words, for the person installing.
Settings paths are the current names (Settings sections were regrouped after 0.4.0).

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
