---
status: idea
desk_test: none
sources: [src-tauri/tauri.conf.json, src-tauri/tauri.beta.conf.json, index.html, src-tauri/src/provider.rs, src/player.ts, src/styles/themes.css, src/styles/skin.css, docs/ops/BETA.md, docs/features/SKINZ.md, docs/features/HIDE-CARDS.md]
updated: 2026-10-15
---
# White label — DeetsMusic as the base for another brand's player

> **An idea, opened 2026-10-14** from the owner's ask: "Bandcamp doesn't have a Windows native
> player, and DeetsMusic can be a foundation for it." A white-label build changes the name and
> the monogram in the title bar, the icon, and the look (a theme or a skin). Nothing is built.
> The forks are his (§9). Do not tell a user the app does this.

## 0. Terms

- **White label:** one code base, built under a different name and look for a different
  owner. The user of that build sees the other brand, not DeetsMusic.
- **Brand:** the set of values one build carries: the name, the monogram, the icon, the
  identifier, the link scheme, the servers, the default look.
- **Brand layer:** the parts of the app that show or carry the brand. Changing them does not
  change what the app does.
- **Service layer:** the parts of the app that talk to the music service (today Apple Music
  through MusicKit) and play the sound.
- **Monogram:** the short title in the title bar (`DM`) that shows when the window is narrow.
- **Overlay config:** a second Tauri config file that Tauri merges over `tauri.conf.json` at
  build time. DeetsMusic Beta is built this way (`tauri.beta.conf.json`, BETA.md §3).

## 1. The short answer

The brand layer is a small job. The app already builds a second identity (Beta) from the same
tree, and its look is already tokens. The service layer is the big job. For Bandcamp, the name
and the icon are not the problem. The problem is that the app plays Apple Music and nothing
else, and Bandcamp gives no public way for an app to read a fan's collection (§4).

So "white label" is two separate projects:

1. **A brand config** (§2, §6): any build can carry another name, monogram, icon and look.
   This is useful on its own, and it is the cheap first step.
2. **A second service** (§3, §4): the app plays a source that is not Apple Music. A Bandcamp
   player needs this. The brand config alone does not make one.

## 2. The brand layer — where the brand lives today

| What | Where | Note |
|---|---|---|
| Product name, exe name | `tauri.conf.json` `productName`, `mainBinaryName` | Beta overrides both. |
| Identifier (data folder, single instance) | `tauri.conf.json` `identifier` = `com.deetsmusic.app` | Also hard-coded in `beta.rs`, `lib.rs:131`, `log.rs:131`. |
| Window titles | `tauri.conf.json` `app.windows[].title` | Main and tray windows. |
| Title bar name and monogram | `index.html:106` `.app-title__full` "DeetsMusic", `.app-title__short` "DM" | Plain text in the markup. |
| Icon (exe, installer, taskbar, tray) | `src-tauri/icons/` | Beta has `icons-beta/`. The tray uses the window icon (`tray.rs:324`). |
| Publisher, copyright, descriptions | `tauri.conf.json` `bundle` | The installer and the Windows "Apps" list show these. |
| Code signing | RELEASE.md §0 | The signature names the publisher. A user sees it in the UAC prompt. |
| Updater key and channel | `tauri.conf.json` `plugins.updater.pubkey`; `update.rs` `BASE` | One key and one channel per brand. |
| Link scheme | `deetsmusic://` (rooms, friends, sign-in) | Beta uses `deetsmusic-beta://`. |
| Servers | `apple.rs` (sign-in, token), `update.rs`, `report.rs`, `usage.rs`, `room.ts`, `friends.ts`, `presence.ts` | All on deets.solutions. |
| Words on screen | about 147 string literals in `src/*.ts` name "DeetsMusic" | Toasts, Settings rows, hints, the walk. |
| CLI, MCP, extension | `cli/`, `mcpb/`, `extension/` | Each carries the name `deetsmusic`. |
| Look | `src/styles/themes.css` (6 theme slots), `src/styles/skin.css` (skins) | All tokens. A brand theme is one more `[data-theme]` block. |

**The Beta precedent.** `tauri.beta.conf.json` already overrides the name, the exe, the
identifier, the icons, the installer icon, the CLI and the link scheme. `release-check.mjs`
already reads it. A brand build is the same pattern with more fields. The Beta did not need
the title bar text, the server URLs or the on-screen words, so those are still literals.

## 3. The service layer — why a second service is the real work

- **MusicKit is in 29 front-end files.** `player.ts`, `queue.ts`, `queue-sync.ts`,
  `now-playing-card.ts`, `vinyl.ts`, `sound.ts`, `room.ts` and others call it. QUEUE.md
  describes the MusicKit windowing that the queue depends on.
- **The provider seam is small.** `provider.rs` defines `MusicProvider` with four reads:
  library songs, playlists, playlist tracks, catalog search. Playback, the ♥, Add to Library,
  stations, Suggest Less and the artist view all go to Apple directly.
- **Many features are Apple features.** Stations and radio mode, Suggest Less (Apple's −1),
  catalog Search, Add to Library and ♥, the credits (Apple's `composerName`), the Home New
  shelf, Full | Lib. A different service loses these, or each one needs its own version.
- **The good news.** A source with no DRM (plain MP3 or FLAC) plays through an `<audio>`
  element. The Equalizer, the loudness meter and AirPlay sit on the Web Audio graph
  (SOUND.md), so they work at least as well on such a source as on MusicKit. The queue being
  the master (the Queue card is the truth, QUEUE.md) also helps: a simple player under it is
  easier to keep in step than MusicKit.
- **The precedent.** PROVIDERS.md designed Spotify beside Apple, and it was parked on
  Spotify's terms (2026-09-15). The seam work in that doc is the same work a second service
  needs.

## 4. Bandcamp — the facts that decide it

> **Not checked against the web on 2026-10-14.** These are from Claude's knowledge. Check each
> one before a decision.

- Bandcamp has apps for iOS and Android. It has no Windows or macOS app. The web site is the
  desktop player.
- Bandcamp has **no public API for fans**. Its documented API is for artists and labels (sales
  reports, merch orders), on approval. The web site reads a fan's collection through internal
  endpoints. An app that calls those endpoints uses a private API, and Bandcamp's terms can
  close it at any time.
- The stream on the web is MP3 at 128 kbps. A purchase downloads in full quality (FLAC, MP3
  320, and others).
- Bandcamp's owner changed twice: Epic Games bought it in 2022, and Songtradr bought it from
  Epic in 2023.

What follows from this:

1. **A Bandcamp player made without Bandcamp is a terms risk.** It reads a private API. The
   same rule as Apple applies: we use what the service documents.
2. **A white label for Bandcamp means Bandcamp is the customer.** They give the API and the
   brand rights. Without them, the build cannot carry the Bandcamp name or logo (trademark).
3. **A clean path with no Bandcamp API: local files.** A Bandcamp buyer downloads the
   purchases. A "local library" provider (a folder of FLAC and MP3 files, their tags and
   covers) plays them with no outside service. This also serves anyone with their own files,
   and it is the second service with the fewest terms. It is not a Bandcamp brand. It is a
   provider that a Bandcamp brand, or DeetsMusic itself, could use.

## 5. Concerns

1. **Apple's terms under another brand.** A white-label build that still plays Apple Music
   would use the owner's Apple developer token (minted by `music-api.deets.solutions`) under
   someone else's name. Apple's MusicKit terms tie the token to the developer. Read the terms
   before a single Apple build ships under another brand.
2. **Signing and the publisher.** The installer and the UAC prompt show the signer. A brand
   build signed by the owner shows "Aditya Sundaram". A brand that wants its own name needs
   its own certificate, or accepts his.
3. **Updates.** Each brand needs its own updater key and channel. A shared channel would offer
   one brand's build to another brand's users.
4. **Servers and privacy.** Rooms, Friends, Song of the Day, reports and usage counts all go to
   deets.solutions. A brand either shares them (its users' reports and counts reach the owner)
   or runs its own workers. USAGE-COUNTS.md §2's privacy rules hold either way, and the brand's
   privacy text must name who receives what.
5. **Data folder and single instance.** The identifier picks the data folder and the
   single-instance lock. Two brands on one PC must not share it (the Beta lesson, BETA.md §7).
6. **One tree, not a fork per brand.** A fork per brand drifts. Every fix lands N times. One
   tree with a brand config keeps every brand on the same fixes.
7. **Support.** A brand's users report bugs. Who answers them, and where do the reports go?
8. **The license.** The repo is public under MIT. Anyone can fork it and rename it today. What
   a white-label deal sells is the maintenance, the build tooling, the servers and the owner's
   time, not the code.
9. **Words on screen.** About 147 literals name "DeetsMusic". Each becomes a read of the
   brand name. Some lines are about DeetsMusic itself (the Updates rows, the release notes)
   and need their own words per brand.
10. **The demo, the guide, the site.** `demo/`, `web/`, `docs/guide/` and deets.solutions are
    DeetsMusic. A brand needs its own, or none.

## 6. The shape of a brand config (one way, for the forks)

- A folder per brand: `brands/<name>/`.
  - `brand.json`: the name, the monogram, the identifier, the link scheme, the publisher, the
    server URLs, the updater key and channel, the default theme and skin, the hidden cards
    (HIDE-CARDS.md's `hiddenCards`), the features that are off.
  - `icons/`: the same set as `src-tauri/icons/`.
  - `theme.css`: one `[data-theme="<name>"]` block with the 12 roles (TOKENS.md). A skin only
    if the brand needs its own geometry or motion.
- `npm run release -- --brand <name>` writes the Tauri overlay from `brand.json` (as Beta's is
  written by hand today), and Vite takes the brand values as one `BRAND` constant.
- DeetsMusic itself becomes `brands/deetsmusic/`, and Beta becomes a brand too. Then the
  default build proves the brand path on every release.
- A docs:check rule fails a literal "DeetsMusic" in `src/` outside the brand file, the same way
  check 29 fails a `window` cast.
- The look: the brand theme is the default slot. SKINZ.md's role editor (designed, not built)
  is the tool to make one.

## 7. What it costs, roughly

| Part | Size |
|---|---|
| Brand config: name, monogram, icon, identifier, scheme, publisher | Small. The Beta pattern. |
| Brand theme | Small. One block of 12 roles. |
| Brand skin | Medium. A skin is about 100–200 lines of tokens (Ocean, Press). |
| Words on screen through `BRAND` | Medium. 147 sites, each read once. |
| Servers per brand | Medium. The workers are plain JS; each brand is a deploy and a domain. |
| Local-files provider | Large. A folder scan, tags, covers, the cache, an `<audio>` player. |
| A second streaming service under the seam | Large. Playback, the queue, and each Apple-only feature (§3). |

## 8. A first step that is useful on its own

Make the brand config with DeetsMusic and Beta as its first two brands (§6). Nothing changes
for a user. Beta's overlay stops being hand-written, the title bar name and monogram come from
the brand, and the words on screen read one constant. After that, a third brand is a folder,
not a code change, for as long as it plays Apple Music.

## 9. The forks (his)

1. **Who is the customer?** A service (Bandcamp, which gives the API), an artist or a label
   (a player for their own catalog), or no customer yet (the brand config only, as groundwork).
2. **One tree with a brand config, or a fork per brand?** Claude's recommendation: one tree
   (§5.6).
3. **Can a brand's user leave the brand look?** The brand theme only, or the brand theme as the
   default with the other themes and skins still in Settings.
4. **Apple under another brand at all?** Yes after a read of MusicKit's terms, or never
   (another brand always means another service).
5. **Which servers does a brand share?** All of deets.solutions, some (reports only), or none.
6. **A "made with DeetsMusic" line?** In Settings › Updates, in the About text, or nowhere.
7. **Local files as the second service?** It serves Bandcamp buyers with no Bandcamp API
   (§4.3). Build it for DeetsMusic first, or only for a brand.

## 10. Renaming the base brand: DeetsMusic → DeetsBeats

> **Part:** idea · 2026-10-15. Planned, not built. "DeetsBeats" was his working name. The check
> in §10.3 found it unsafe, so the new name is open. The plan below holds for any new name.

### 10.1 His calls (2026-10-15)

- **Only the display name changes.** The display name is what a user sees: the title bar, the
  window titles, toasts, the installer, the Start menu, the Windows Apps list.
- **The internal IDs stay.** The identifier `com.deetsmusic.app` (the data folder, the
  single-instance lock), the link scheme `deetsmusic://`, the updater channel and key, and the
  worker domains do not change. No user sees them. No data moves.
- **The CLI gets the new name, and the old name stays as an alias.** A user who typed
  `deetsmusic` before still works, and does not need to know about the rename.
- **The MCP is renamed in full, with no migration code (2026-10-15, §10.5).** v1 is not out
  and there is no user base yet. His own data must survive; the MCP holds none, and the data
  folder does not move.
- **The same rule holds for a future white label** (§6), and for a possible user setting that
  changes the monogram in the title bar: the display name only.
- **Why this is safe now:** on 2026-10-15 there was 1 active install on the latest version
  and 2 across all versions (USAGE-COUNTS.md), and those are his.

### 10.2 What changes

| What | Where | Change |
|---|---|---|
| Name and monogram | `index.html:106` | "DeetsBeats" and "DB", read from the brand (§6). |
| Window titles, installer name | `tauri.conf.json` `productName`, `app.windows[].title` | New name. `mainBinaryName` and the install folder: check what an update does when `productName` changes before you pick (§10.4). |
| Words on screen | about 200 sites in 49 files in `src/` | Read the `BRAND` name constant (§6). Lines about the product's history keep the old name. |
| Rust user text | toasts, tray menu, the report form, log headers | Same constant on the Rust side. Paths that use `deetsmusic` as an ID stay. |
| MusicKit app name | `player.ts:176`, `player.ts:232` | New name. Apple shows it nowhere a user sees; it is the app name in Apple's logs. |
| CLI | `cli/Cargo.toml` `[[bin]]`, `hooks.nsh`, `cli-dist.mjs` | `deetsbeats.exe` is the main name; `deetsmusic.exe` stays as the alias (§10.4). |
| MCP | `mcpb/manifest.json`, `cli/src/main.rs` (tool list, `initialize`), `crates/mcp-install` | A full rename: the server key `deetsbeats`, the names and the texts (§10.5). |
| Extension | `extension/` | The name in the store listing and the popup. The native host name is an ID and stays. |
| Site, guide, demo, README, repo | deets.solutions, `docs/guide/`, `demo/` | New name. GitHub redirects a renamed repo. |
| Release notes | RELEASE-NOTES.md | One line in the release that renames: "DeetsMusic is now DeetsBeats." |

### 10.3 Before the build: the name check

"Beats" is a mark of Apple's in music and audio (Beats Electronics; Apple Music's station was
"Beats 1" until 2020). An app that plays Apple Music under a name with "Beats" in it can read as
an Apple product, and the MusicKit rules forbid a claim of Apple's endorsement.

> **Checked 2026-10-15 (Claude, on the web; not a lawyer's opinion).** Result: **DeetsBeats is
> not safe. Claude recommends another name, with no "beat" in it.**

- **No one uses "DeetsBeats".** A web search found no product, artist or mark of that name.
- **Beats Electronics, LLC (Apple's) opposes almost every "beat" mark.** USPTO TTABVUE lists
  100+ proceedings with Beats Electronics as a party. The newest page alone has 16 oppositions
  from 2024–2026, among them BUCKLEBEATS, FRIDGEBEATS, VIBROBEATZ, BEATBEST, OUTBEAT, REDBEAT,
  TPBEAT and UPBEAT SOUND CO. In 2021 it opposed MUSICY BEAT (audio gear) on the shared
  "beat/beats" part, and called its marks "famous" for "audio- and music-related products and
  services". "<word>BEATS" for music software is the exact shape it opposes.
- **The music context makes it worse.** DeetsBeats plays Apple Music, and Apple owns Beats. A
  user can take it for an Apple or Beats app. Apple Music's Identity Guidelines §7.5 say: "Do not
  indicate any kind of sponsorship or endorsement by Apple." Apple can end the MusicKit access
  that the whole app depends on, so the risk is not only a letter from a lawyer.
- **Not registering the name does not remove the risk.** An opposition stops a registration. An
  app that only uses the name can still get a demand to stop, and a rename after v1 costs more
  than one now.
- **What a new name avoids:** "beat", "beats", "beatz" in any form; "Apple", "Music" in an
  Apple-like form; a round headphone mark with one letter in it (Beats' logo is a "b" in a
  circle). The Deets-head icon (§10.6) is far from that logo.
- **Before the next name is final:** a search of USPTO and EUIPO for it in classes 9 (software)
  and 41/42 (music services), and a web search.

Sources: [TTABVUE, Beats Electronics as a party](https://ttabvue.uspto.gov/ttabvue/v?pnam=Beats+Electronics%2C+LLC++),
[Law Street Media on MUSICY BEAT, 2021](https://lawstreetmedia.com/news/tech/beats-files-opposition-to-musicy-beat-mark/),
[Apple Music Identity Guidelines](https://marketing.services.apple/apple-music-identity-guidelines).

### 10.4 Open (his)

1. **The alias for the CLI.** Two copies of one exe, or a small `deetsmusic.exe` that starts
   `deetsbeats.exe`. Test both against the NSIS close-the-CLI rules (`hooks.nsh`) first.
2. **`productName` on update.** Read in the docs 2026-10-15:
   - `productName` names the install folder (`%LOCALAPPDATA%\DeetsMusic`, RELEASE.md §2) and
     the Start-with-Windows value (`${PRODUCTNAME}`, RELEASE.md §3). A Tauri NSIS installer
     keeps the same folder only while the product name stays the same (BETA.md §4.2).
   - So a new `productName` installs a SECOND app in `%LOCALAPPDATA%\<new name>`, beside the
     old one, and the pinned taskbar button stops working (RELEASE.md §6.8).
     `release-check.mjs:97` fails such a build on purpose until it is allowed.
   - **The data survives.** The data folder is the identifier's (`%APPDATA%\com.deetsmusic.app`),
     not the product name's, and the identifier does not change (§10.1). The new app opens on
     the same library, settings, tokens and Diary.
   - **The trap:** both apps share that one data folder. If the old app's uninstaller runs with
     **Delete app data** checked, it deletes the new app's data too.
   - **With no user base (his call, §10.5), the plan is a hand move, not updater code:** copy
     `%APPDATA%\com.deetsmusic.app` somewhere safe; install the new name by hand; uninstall
     DeetsMusic from Installed apps with **Delete app data** NOT checked; pin the new app. The
     release-check rule gets a one-time allow for this release.
   - **Not tested:** what the OLD app's updater does if it is offered the renamed build (likely
     the second install above). Do not publish the renamed build to the live channel until a
     test install shows it; or install it by hand only.
3. **The monogram.** "DB", or a user setting (§10.1).
4. **The order.** The brand config (§8) first, then the rename as one value in it. Claude's
   recommendation: yes. With the config, a new literal "DeetsMusic" fails docs:check.

### 10.5 Agents: the MCP is renamed in full

> **His call, 2026-10-15:** a full rename of the MCP as DeetsBeats. No migration code: v1 is
> not out (0.27), and there is no user base yet. Only his own data must survive.

An agent sees three things from the MCP: the server key in the AI app's config (it becomes the
tool prefix, `mcp__deetsbeats__play` in Claude Code), the tool descriptions, and the
`initialize` reply (`serverInfo`, `cli/src/main.rs:1286`). The AI app also shows the server
name to the user on each tool call and each permission prompt, so the key is part of the
display name.

- **What changes:** the server key (`deetsbeats`) in what `crates/mcp-install` writes (Claude
  Code's `~/.claude.json`, Codex's `config.toml`), `serverInfo.name`, the tool descriptions,
  and `mcpb/manifest.json` (`name`, `display_name`, the texts, the bundle file name
  `deetsbeats.mcpb`). The "ours" test (`lib.rs:231`, the `deetsmusic` file-name prefix) reads
  the new name.
- **No migration code.** The app does not move an old entry, and the CLI does not detect an
  old Claude Desktop extension.
- **His one-time steps around the release that renames.** On 2026-10-15 he had no MCP
  installed in any AI app, so only step 4 applies to him. Steps 1–3 are for anyone who has one:
  1. BEFORE the update: run `deetsmusic mcp uninstall --all` (the old CLI removes the old
     `deetsmusic` entries). AFTER it: run `deetsbeats mcp install`. If the update went first,
     delete the `deetsmusic` entries by hand.
  2. Remove the DeetsMusic extension in Claude Desktop › Settings › Extensions, then open
     `deetsbeats.mcpb`.
  3. Allow the `mcp__deetsbeats__*` tools again in Claude Code.
  4. Replace the `deetsmusic` tool names in this repo's CLAUDE.md, the agent memories and any
     skills, in the same commit as the rename.
- **Why the order matters:** an old entry beside the new one gives an agent two working copies
  of every tool. It picks either one.
- **His data is not touched.** The MCP has no data of its own. The app's data lives in the
  identifier's folder (`com.deetsmusic.app`), and the identifier does not change (§10.1).
- **The CLI** keeps `deetsmusic` as an alias of `deetsbeats` (§10.4), for scripts and habits.
  The MCP gets no alias.

### 10.6 The icon: the Deets head with headphones

> **Part:** idea · 2026-10-15. He draws it by hand. Claude made the template only.

- **The template** is in `icon-template/` at the repo root, made from the Deets sprite
  (`src/assets/sprites/deets/idle_down.png`). The head is 16×15 pixels.
  - `deets-head-32.png`: a 32×32 canvas, the head only, transparent. Draw on it in a pixel
    editor (Aseprite, Piskel, Paint.NET).
  - `guide-32.png`: the same grid at 20× with zones: blue for the headband (rows 4–8), orange
    for the ear cups (columns 3–8 and 23–28, rows 13–22), grey for the 2-pixel edge to keep
    clear, red for the center line.
  - `deets-head-16.png` and `guide-16.png`: a blank 16×16 grid for the small sizes, with the
    32 head shrunk in faint grey as a reference only.
  - `sizes.png`: the head at 16, 24, 32, 48 and 64 pixels on light and dark.
- **What he hands back:** `deets-head-32.png` drawn over, and `deets-head-16.png` if he draws
  the small size. Same names, PNG, transparent background. The guides are to look at, not to
  draw on. A drawing on `guide-32.png` also works if each cell is filled whole: Claude reads it
  back one cell at a time.
- **Sizes.** The 32 art grows by whole numbers to 64, 128 and 256 with no blur. Windows also
  shows 16, 20 and 24 (the tray, the title bar, the taskbar at 100–150 % scale). A shrunk
  32 blurs at those sizes (`sizes.png` shows it at 16 and 24). So a hand-drawn 16 is needed,
  and possibly a 24.
- **His drawing (2026-10-15):** `deets-head-32.png` is drawn: the head with a white headband
  in a black outline and black ear cups. The art fills 18×15 of the 32 pixels (columns 7–24,
  rows 9–23), so at 16 pixels it is about 9 pixels wide. `deets-head-16.png` is still blank, so
  the small sizes come from a shrunk 32 until he draws one. Both are his calls in the build.
- **The build.** The `.ico` and the PNG set get made from his hand-drawn sizes with
  nearest-neighbor scaling. `npx tauri icon` likely smooths pixel art; check its output before
  using it. The Beta icon (`icons-beta/`) needs its own variant (open).
- **As built (2026-10-15, branch `icons-fifteen`, his calls):** he kept his canvas: 32 and up
  are the whole 32 canvas ×1, ×2, ×4, ×8, ×16, ×32 (`app-icon.png`). 16 is his hand-drawn 16;
  20 is that 16 centered; 24 is the head 1:1 centered; 48 is the 24 ×2 (Claude's calls inside
  his pick: 32 → 48 is not a whole number). The `.ico` holds 16, 20, 24, 30, 32, 36, 48, 64,
  256, each read back pixel for pixel. 36 is the 150 % taskbar: the head ×2, edge to edge (his
  call: Windows puts the space between taskbar icons). 30 is the 125 % taskbar: the head 1:1
  centered, since no whole-number scale fits (Claude's call).
- **`npm run icons`** (`scripts/icons.py`, Python with Pillow) makes the whole set from his two
  drawings, with the extension (16 = his 16, 32 = his 16 ×2 for the toolbar at 200 %, 48 = the
  24 ×2, 128 = the canvas ×4) and the MCP bundle (the canvas ×8). Run it again after a drawing
  changes. `npm run icons -- --site ../DeetsSolutions` also writes the site's icons at the exact
  size they are shown (the DeetsMusic page 72 CSS px, the home card 56; 1x / 1.5x / 2x files
  in `srcset`, the head at a whole-number scale), since a browser blurs a 512 shrunk to 72.
- **The other repos (2026-10-15):** DeetsSolutions `38abe54`, committed, NOT pushed: the icon,
  the site icons, the link-preview card (`og.jpg`, the head on a dark tile because its white
  headband vanished on the white one; `build-og-cards.py` takes a tile color per card), the
  `og:image` and `main.css` versions. DeetsSupport: `src/signin/icon.png` committed, NOT
  deployed (only the icon: `signin:assets` also copies the stylesheets, which were left as
  they were).

#### Before it goes live

His plan: the icon ships with a later release, after other build items. Left:
1. **The release:** merge `icons-fifteen`, build, publish. A release line in RELEASE-NOTES.md
   (his wording).
2. **The same day:** push DeetsSolutions `38abe54`; deploy DeetsSupport (the sign-in icon, and
   Apple's Access Request reads it from there). Both are his calls.
3. **Discord:** the Rich Presence badge is the asset `deetsmusic` in the Discord Developer
   Portal › Rich Presence › Art Assets (`src/presence.ts`). It is still the old icon until he
   uploads `app-icon.png` there under the same name.
4. **The sign-in page's mark** shows the 1024 px icon at 40 px (`.mark` in DeetsSupport's
   `signin.js`), which a browser blurs. The fix is the site's: exact-size files and
   `image-rendering: pixelated`. `signin.js` holds his own uncommitted edits, so it waits.
   Its comments still say "the DM mark".
5. **Update desk test:** install the release over 0.27.x and look at the pinned taskbar button,
   the Start menu and Installed apps. Windows caches shortcut icons; if the old one stays, the
   installer may need to refresh the shell (`SHChangeNotify`).
6. **Not needed for live:** `icons-beta/` (Beta-first is paused; its look is open), the
   `Square*Logo` set (the Store, unused by NSIS), `icon.icns` (macOS).
- **Why `app_icon.rs` (2026-10-15):** Tauri gives a window ONE picture, the first `.ico`
  frame, and Windows scaled his 16 up to the 24 px taskbar button: a blur. Now each window
  loads the exe's icon resource (id 32512) at the exact size per scale (small = SM_CXSMICON,
  big = 24 px × scale, the taskbar's size) and sends `WM_SETICON`, again on a scale change;
  the tray takes the `.ico` frame of the small-icon size at the taskbar's scale. Checked on his
  taskbar at 100 %: the 24 frame shows 1:1.
- **A scale change while open (2026-10-15):** a window hears it as `ScaleFactorChanged`. The
  tray has no window that hears it, and Windows fixes the system scale for the process's
  life. So the main window is subclassed for `WM_SETTINGCHANGE` / `WM_DISPLAYCHANGE` /
  `WM_DPICHANGED`; after the message returns, the tray size is read from the taskbar window
  (`Shell_TrayWnd`) and, if it changed, the tray frame and every window's frames are set again
  (log line `app_icon: tray 16px → 24px`). Desk test: with the dev app open, Settings ›
  Display › Scale 100 % → 150 % → 100 %; the taskbar button and the tray stay crisp, with no
  restart. First run (his): the tray followed (log), but at 150 % the head was small, because
  the exe still held the old frames. `build.rs` now reruns when `icons/icon.ico` or
  `icons-beta/icon.ico` changes (tauri-build does not watch them, and our own
  `rerun-if-changed` lines turn Cargo's default off).
