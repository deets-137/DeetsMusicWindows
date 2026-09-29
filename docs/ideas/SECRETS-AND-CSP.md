---
status: idea
desk_test: none
sources: [src-tauri/tauri.conf.json, index.html, tray.html, src-tauri/src/lib.rs, src-tauri/src/apple.rs, src-tauri/src/lastfm.rs, src-tauri/src/friends.rs, src-tauri/src/beta.rs, scripts/dev-app.mjs]
updated: 2026-09-29
---
# Secrets at rest, and a Content Security Policy

> **Designed 2026-09-29, not built.** The owner asked for the setup of both to be written
> down ("let's doc setting up both"). Every fork below is his. The front matter says `idea`
> because docs:check (check 11) allows nothing else in `ideas/`; move this doc out of
> `ideas/` when a build starts. Both came from the 2026-09-29 security review, with the
> friend key pin (FRIENDS.md §19, built the same day).

## 0. Terms

- **CSP** — Content Security Policy. A list of the places a page may load scripts, styles,
  pictures, fonts and connections from. The webview refuses everything else.
- **Inline script** — a `<script>` with its code inside the HTML file, not in a `src` file.
- **Hash** — `'sha256-…'` in the CSP: an inline script runs only if its text has this hash.
- **DPAPI** — the Windows Data Protection API. It encrypts bytes with a key that belongs to
  the signed-in Windows user. Another user, or a copy of the file on another PC, cannot
  decrypt it. `friends.json` and `sotd-outlets.json` use it today.

## Part A. A Content Security Policy for the webview

### A1. Where we are

`src-tauri/tauri.conf.json` has `"security": { "csp": null }` and `"withGlobalTauri": true`.
So any script that runs in the page can load anything and call every Tauri command. The only
third-party script is MusicKit JS from Apple. The risk that a CSP closes: an HTML injection
(a song title or a friend's name that reaches `innerHTML` without `esc`) that turns into a
script. A script in this page can call `invoke` on every command, including the ones that
write files and read the library.

### A2. What the webview really loads (read from the code, 2026-09-29)

| Kind | Source | Where |
|---|---|---|
| The page | `http://tauri.localhost` (release, Windows) · `http://localhost:<port>` (dev, vite) | `tauri.conf.json` `build` |
| Inline scripts | 2 in `index.html` (the look pre-paint, the MusicKit `alert` filter), 1 in `tray.html` (the pre-paint) | `index.html:12`, `:55`; `tray.html:10` |
| Inline event handler | `onerror="window.__musicKitFailed = true"` on the MusicKit tag | `index.html:79` |
| Third-party script | `https://js-cdn.music.apple.com/musickit/v3/musickit.js`, and the same URL again from `player.ts` (`MUSICKIT_SRC`) when the first load failed | `index.html:79`, `player.ts:114` |
| Module scripts, workers | the bundle under `'self'`; `new Worker(new URL(…))` for `mosaic-worker.ts`, `ocean-worker.ts`, `wallpaper-worker.ts` | `mosaic.ts:130`, `ocean.ts:112`, `wallpaper.ts:341` |
| Audio worklet | `sound-worklet.ts?worker&url`, a file under `'self'` | `sound.ts:19`, `:149` |
| Blob URLs | `URL.createObjectURL` for covers, the wallpaper's soft picture, a picked file, the Rulez export | `mosaic.ts`, `ocean.ts`, `wallpaper.ts`, `playlists-card.ts`, `user-files.ts`, `rulez-card.ts` |
| data: URLs | `data:image/svg+xml` sand grain in `styles.css`; `data:image/jpeg` from a picked picture | `styles.css:2000`, `user-files.ts:128` |
| Pictures | Apple artwork `https://*.mzstatic.com` (friends' presence is limited to it since 2026-09-29); own covers `http://cover.localhost`; the Glass picture `http://wallpaper.localhost` and `http://files.localhost` | `lib.rs:91`–`:104`, `wallpaper.ts:83` |
| fetch from the page | `cover.localhost` (a playlist cover), `files.localhost` (a rule file, the picture), Apple artwork from the mosaic and wallpaper workers, `https://rooms.deets.solutions/room` | `playlists.ts:172`, `rules-files.ts:29`, `mosaic-worker.ts:81`, `room.ts:249` |
| WebSockets | `wss://rooms.deets.solutions`, `wss://musicfriends.deets.solutions` (dev may point both at `http://127.0.0.1:<port>` through `roomsUrl` / `friendsUrl`) | `room.ts:208`, `friends.ts:134` |
| Tauri IPC | `ipc:` and `http://ipc.localhost` | `@tauri-apps/api` |
| Fonts | bundled files under `'self'` (`src/styles/fonts.css`). No web font host | `fonts.css` |
| Styles | the bundle; in dev, vite adds many `<style>` tags; 2 `style="…"` attributes in `innerHTML` templates; much `el.style` (CSSOM, which a CSP does not block) | — |
| MusicKit's own traffic | the Apple Music API, the playback and licence calls, the HLS stream through Media Source (`blob:` media) | inside `musickit.js` |

**Not in the webview** (Rust makes these calls, so a CSP does not touch them): Last.fm
(`lastfm.rs`), DeetsSupport's token mint and remote config (`apple.rs`), Discord, AirPlay,
the loopback sign-in page (it opens in Edge, not in this webview), the extension bridge.

### A3. The proposed policy (release)

```
default-src 'self';
script-src  'self' https://js-cdn.music.apple.com;
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob: https://*.mzstatic.com http://cover.localhost http://files.localhost http://wallpaper.localhost;
media-src   'self' blob: https://*.apple.com;
font-src    'self' data:;
connect-src 'self' ipc: http://ipc.localhost
            https://*.apple.com https://*.mzstatic.com
            http://cover.localhost http://files.localhost http://wallpaper.localhost
            https://rooms.deets.solutions wss://rooms.deets.solutions
            https://musicfriends.deets.solutions wss://musicfriends.deets.solutions;
worker-src  'self' blob:;
object-src  'none';
base-uri    'self';
form-action 'none';
frame-src   'none'
```

- **`script-src` holds no `'unsafe-inline'` and no `'unsafe-eval'`.** The inline scripts
  run by hash (A4). If MusicKit needs `eval`, the report phase (A5) shows it; then the fork
  is `'unsafe-eval'` or no CSP on `script-src`.
- **`style-src 'unsafe-inline'`** stays. A style injection cannot run code, and taking it out
  means rewriting every `style="…"` template. Tauri adds a nonce to `style-src`, and a nonce
  turns `'unsafe-inline'` off in the browser, so the config also sets
  `"dangerousDisableAssetCspModification": ["style-src"]`.
- **The Apple hosts are wide on purpose** (`*.apple.com`). MusicKit's hosts are not
  documented and change. The report phase lists the real ones; narrow the list then if it
  is short and stable.
- **`frame-src 'none'`**: nothing frames today. MusicKit's `authorize()` popup is not used
  (the sign-in runs in Edge).

**Dev** (`app.security.devCsp`, Tauri v2): the same list, plus `http://localhost:*` and
`ws://localhost:*` (vite and its hot reload), `http://127.0.0.1:*` and `ws://127.0.0.1:*`
(a local worker through `roomsUrl` / `friendsUrl`), and `'unsafe-inline'` on `script-src`
(vite injects its client). **`tray.html`** is the same origin, and takes the same policy.

### A4. The inline scripts: hashes, not a nonce

A nonce needs a server that writes a new value per page load. The page is a file in the
exe, so a nonce would be a constant, which is no protection. The plan is hashes:

1. **Tauri hashes them for us.** When `csp` is set, Tauri's build reads the HTML in
   `frontendDist` and adds a `'sha256-…'` for each inline `<script>` to `script-src`. Check
   this on the first `npm run dev:built`: the look pre-paint must still apply on a dark-mode
   launch, and the console must show no blocked inline script. If Tauri does not do it for
   `tray.html`, a small build step (`scripts/csp-hashes.mjs`) computes the hashes after
   `vite build` and writes them into the config.
2. **The `onerror` attribute goes.** A hash never allows an inline event handler (that
   needs `'unsafe-hashes'`). The MusicKit alert script listens instead:
   `addEventListener("error", e => { if (e.target?.src === MK) window.__musicKitFailed = true }, true)`.
   The capture phase sees a script's load error. It runs before the tag, which it must.
3. **The release check** fails a build whose `index.html` / `tray.html` has an inline script
   or `on…=` attribute that is not in the policy. Otherwise the next edit to the pre-paint
   breaks the look with no error the owner sees.

### A5. The rollout

| Step | What | How we learn |
|---|---|---|
| 1. Listen | Dev only: `devCsp` set, and a `securitypolicyviolation` listener in `main.ts` writes each block to the diag ring as `csp:blocked` (directive, URL, file). | A week of his normal use in `dev:app`, then read the ring. |
| 2. Report only in release | Tauri has no report-only switch, and a `<meta>` CSP cannot be report-only (browsers ignore it). **Check first:** whether `app.security.headers` in the Tauri version we ship can send `Content-Security-Policy-Report-Only`. If it can, ship one release with it and the same listener. If not, skip to step 3 with a longer step 1. | the ring on his installed app |
| 3. Enforce | `csp` set in `tauri.conf.json`. | the desk test below |
| 4. Tighten (optional) | narrow `*.apple.com` to the hosts step 1 saw; `withGlobalTauri: false` (nothing in `src/` reads `window.__TAURI__`; it imports `@tauri-apps/api`). | — |

**The desk test for step 3:** a cold start plays a song; skip, seek, a station, the EQ on
(the worklet); the mosaic cover, the Ocean skin (its worker), Glass › Canvas with the cover
set and with your own picture (the `files.localhost` and `wallpaper.localhost` paths and the
blob soft picture); a room and a friend's row (the two `wss` hosts); the tray panel's look;
a launch with no network (the MusicKit reload path). The console and the ring show no
`csp:blocked`.

### A6. The risks

- **MusicKit breaks.** It is Apple's script, it loads what it wants, and it can change without
  a release of ours. A block there means no sound. This is why step 1 is long, and why
  `*.apple.com` is wide. A kill switch is worth a thought: the remote config
  (`apple_remote_config`) cannot change a CSP, because the CSP is in the exe.
- **The workers.** A worker script fetched from `tauri.localhost` may not carry the page's
  CSP header, so `connect-src` may not bind the mosaic and wallpaper workers. That is a gap,
  not a breakage. The rooms and friends sockets are in the page, so they are bound: a new
  worker host needs a release.
- **The Glass picture.** The picture comes back as `http://files.localhost/<id>` and as a
  `blob:` soft copy, and the cover wallpaper is `https://*.mzstatic.com`. All three are in
  `img-src`. A rule that holds a picture uses the same `files.localhost` link.
- **A new host in a feature.** Every new outside host the page talks to is now a CSP line.
  Add it to the CLAUDE.md build checklist when step 3 ships.

## Part B. The secrets at rest, under DPAPI

### B1. Where we are

| File in `<app_data>` | What | Today |
|---|---|---|
| `friends.json` | the Ed25519 seed and the friend list | DPAPI (`friends.rs::protect`) |
| `sotd-outlets.json` | the Song of the Day webhooks | DPAPI (`sotd/outlet.rs`) |
| `user-token.txt` | the Apple Music user token: the key to the user's Apple library | **plain text** (`apple.rs::persist_user_token`, `:700`) |
| `lastfm-session.json` | the Last.fm session key: it can scrobble as the user | **plain JSON** (`lastfm.rs::finish_connect`, `:314`) |
| `developer-token.json` | the app's MusicKit developer token, minted by DeetsSupport | plain. It is not the user's, and it expires; left as it is |

What DPAPI protects against: another Windows account on the PC, a copy of the folder (a
backup, a sync tool, a support zip, a lost disk). What it does not: a program that runs as
the same user, which can call DPAPI too. That is the same line `friends.json` already draws.

### B2. The plan

1. **One helper.** `src-tauri/src/dpapi.rs` with `protect` / `unprotect`, lifted from
   `friends.rs`. `friends.rs` and `sotd/outlet.rs` keep their copies until they are touched
   (the friends.rs note, "no shared lock", is about the files, not the two functions, which
   hold no lock).
2. **New names, not the same name.** `user-token.bin` and `lastfm-session.bin`. A new name
   means a file's format is never a guess, and an older app that reads the `.txt` finds
   nothing instead of reading ciphertext as a token.
3. **Write:** always the `.bin`, through `protect`. `persist_user_token` and
   `finish_connect` change; nothing else writes these files.
4. **Read, with the migration** (the one function per secret, at setup):
   1. `.bin` exists → `unprotect`. A failure (another account, another PC) is one warn and
      "signed out"; the file is left alone (the friends.json rule, FRIENDS.md §16.4).
   2. else the plain file exists → read it → write the `.bin` → read the `.bin` back and
      compare → **only then** delete the plain file. A failure at any step keeps the plain
      file and uses the token; the next launch tries again.
   3. else apple.rs's old repo fallback (`repo_secrets_dir()/user-token.txt`, dev only) as
      today, now written to the `.bin`. The repo file is never deleted: it is the owner's.
5. **Sign-out and disconnect** delete both names (`apple.rs:1180`, `lastfm.rs:379`).
6. **Blocking I/O:** all of it runs at setup or in the existing async paths. No new sync
   command (FRIENDS.md §8.11).

### B3. The copies between apps

DPAPI's key is the **Windows user's**, not the app's. The installed app, the beta and the dev
app run as the same user, so a `.bin` made by one decrypts in the others. A byte copy still
works. What changes is the list of names:

| Copy | Where | Change |
|---|---|---|
| The beta's first start and `deetsmusic-beta pull` | `beta.rs` `FILES` | add `user-token.bin`, `lastfm-session.bin`; keep the old names for one release, so a new beta can pull from an old full app and the other way round |
| The dev app's first seed from the installed app | `lib.rs:131` | add `user-token.bin` |
| A second dev profile | `scripts/dev-app.mjs:58` | add `user-token.bin` |
| A new PC, another Windows user | — | does not decrypt. The user signs in again, which is correct: a sign-in should not travel in a zip |

If both names are copied, B2 step 4 uses the `.bin`. A plain file beside a readable `.bin` is
then deleted too, so a plain copy pulled from an older app does not stay on disk.

### B4. The tests

- **Pure:** `migrate_plan(bin: Option<Result<..>>, plain: Option<..>) -> Plan` (use the
  `.bin` · migrate · signed out · keep plain) as its own function, tested for each row of B2
  step 4, with the date in each test name.
- **DPAPI round trip:** `protect` then `unprotect` returns the bytes; `unprotect` of junk is
  an `Err`, never a panic. DPAPI works in `cargo test` on Windows.
- **The migration on disk:** a temp dir with a plain `user-token.txt` → `load` → the `.bin`
  exists, the `.txt` does not, the token is the same. And the failure path: a read-only temp
  dir keeps the `.txt` and still returns the token.
- **The release check:** no `fs::write` of `user-token.txt` or `lastfm-session.json` in
  `src-tauri/src` (a grep, like check 9).
- **The desk test:** an installed app signed in to Apple and Last.fm updates to the build:
  it opens signed in to both, the `.txt` / `.json` are gone, the `.bin` files are not
  readable in Notepad. `deetsmusic-beta pull` gives a beta that is signed in to both. Sign
  out removes the `.bin`.

## Open forks (his)

1. **CSP rollout:** a report-only release first (if Tauri can send the header), or a long dev
   phase and then enforce.
2. **`style-src 'unsafe-inline'`:** keep it (recommended: styles cannot run code), or rewrite
   the style templates.
3. **`withGlobalTauri: false`** in the same release, or later.
4. **DPAPI file names:** new `.bin` names (recommended), or the same names with a format sniff.
5. **`developer-token.json`:** leave it plain (recommended: it is not the user's), or protect
   it with the rest.
