---
status: built
desk_test: open
sources: [src-tauri/tauri.conf.json, src-tauri/src/csp.rs, src-tauri/src/lib.rs, src-tauri/src/velo.rs, src-tauri/src/usage.rs, index.html, src/csp-watch.ts, src/main.ts, src/tray.ts, src/dom.ts, src/settings-card.ts, src/updates-btn.ts, scripts/csp-dev-plugin.mjs, scripts/csp-relax.mjs, scripts/release-check.mjs, vite.config.ts]
updated: 2026-10-23
---
# A Content Security Policy for the webview

> **Designed and built 2026-10-21; the desk test (§10) is open. §12 is the as-built record.
> Every fork closed (C1 a, §9).** The owner asked for it after the
> whole-app security review of 2026-10-21, before the official release. This doc replaces
> Part A of `ideas/SECRETS-AND-CSP.md` (2026-09-29). That doc keeps Part B (the secrets under
> DPAPI). Every fact below was read again from the code on 2026-10-21.

## 0. Terms

- **CSP** — Content Security Policy. A list of the places a page may load scripts, styles,
  pictures, fonts and connections from. The webview refuses everything else.
- **Enforce** — the webview blocks what the policy does not allow.
- **Report-only** — the webview allows everything, and reports what the policy would block.
- **Inline script** — a `<script>` with its code inside the HTML file, not in a `src` file.
- **Hash** — `'sha256-…'` in the policy: an inline script runs only if its text has this hash.
- **IPC** — the calls from the page to Rust (`invoke`). There are about 270 commands.
- **The hook** — `on_web_resource_request` on a Tauri window: Rust code that sees each
  response from the app's own files before the webview does, and can change its headers.

## 1. Why

`src-tauri/tauri.conf.json` has `"security": { "csp": null }` and `"withGlobalTauri": true`.
So any script that runs in the page can load anything and call every command, and the
commands can write files, read the library and the settings, and change the bridge token.

The security review of 2026-10-21 found no way in today. Every outside string (Apple, Last.fm,
a room member, a friend) that reaches HTML is escaped. But two ways in stay possible:

1. **A future escaping mistake.** About 42 files write `innerHTML`. One missed `esc()` on a
   song title turns into a script.
2. **MusicKit JS.** It loads from `https://js-cdn.music.apple.com` into the same page. A bad
   copy of it runs with the full IPC.

The policy closes the first. For the second it limits what a bad script can reach: no other
host, no inline code. A script from Apple's own host can still call `invoke`. Only §8 (the
commands each window may call) narrows that, and it is later work.

## 2. What the webview loads (read from the code, 2026-10-21)

| Kind | Source | Where |
|---|---|---|
| The pages | `index.html` and `tray.html` (vite inputs); `http://tauri.localhost` in release, `http://localhost:<port>` in dev | `vite.config.ts:44`, `tauri.conf.json` |
| Inline scripts | 2 in `index.html` (the look pre-paint, the MusicKit `alert` filter); 1 in `tray.html` (the pre-paint) | `index.html:21`, `:73`; `tray.html:10` |
| Inline event handler | `onerror="window.__musicKitFailed = true"` on the MusicKit tag | `index.html:97` |
| Third-party script | `https://js-cdn.music.apple.com/musickit/v3/musickit.js`, and the same URL again from `player.ts` when the first load failed | `index.html:97`, `player.ts:137` |
| Workers | `mosaic-worker.ts`, `ocean-worker.ts`, `wallpaper-worker.ts`, each a file under `'self'` | `mosaic.ts:203`, `ocean.ts:113`, `wallpaper.ts:344` |
| Audio worklet | `sound-worklet.ts?worker&url`, a file under `'self'` (a worklet follows `script-src`) | `sound.ts:19`, `:154` |
| `blob:` URLs | covers, the wallpaper's soft picture, Metal's baked textures, a picked file, the Rulez export | `metal.ts`, `mosaic.ts`, `ocean.ts`, `wallpaper.ts`, `playlists-card.ts`, `user-files.ts`, `rulez-card.ts` |
| `data:` URLs | 7 in the CSS (e.g. the sand grain); a picked picture as JPEG; vite inlines a small asset (under 4 KB) as `data:` | `styles.css`, `user-files.ts` |
| Pictures | Apple artwork `https://*.mzstatic.com`, and library covers from `https://*.blobstore.apple.com` (found by the first run, §12.3); own covers `http://cover.localhost`; the Glass picture `http://wallpaper.localhost` and `http://files.localhost`; the Happy skin's art and the fonts are bundled files | `lib.rs:106`–`:119` |
| `fetch` from the page | `cover.localhost`, `files.localhost`, Apple artwork (the mosaic and wallpaper workers), `https://rooms.deets.solutions/room`; the fetch wrap passes MusicKit's own calls through | `playlists.ts:188`, `rules-files.ts:29`, `mosaic-worker.ts:102`, `room.ts:687`, `fetch-wrap.ts:118` |
| WebSockets | `wss://rooms.deets.solutions`, `wss://musicfriends.deets.solutions` (dev may point both at `127.0.0.1:<port>` through `roomsUrl` / `friendsUrl`) | `room.ts:832`, `friends.ts:202` |
| IPC | `ipc:` and `http://ipc.localhost` | `@tauri-apps/api` |
| Styles | the bundle's CSS files; **3 `style="…"` attributes** in `innerHTML` templates; no `<style>` tag in release (the copy editor makes one, dev only); much `el.style` (CSSOM, which a CSP does not block) | `settings-card.ts:2488`, `:2507`; `updates-btn.ts:203` |
| `eval`, `new Function` | none in `src/` | — |
| `window.__TAURI__` | nothing in `src/`, `scripts/`, `demo/`, `web/` or `docs/ops/checks/` reads it | — |
| MusicKit's own traffic | the Apple Music API, playback and licence calls, the song pieces (Media Source, `blob:` media) | inside `musickit.js` |

**Not in the webview.** Rust makes these calls, so the policy does not touch them: Last.fm,
the DeetsSupport token mint and remote config, the speed test, Discord, AirPlay, the sign-in
page (it opens in Edge), the bridge. Links opened with the opener plugin leave the webview too.

**Not this doc.** The rooms web port on deets.solutions (`web/`, WebRooms.md) is a page on
the site. Its policy is the site's headers.

## 3. The policy (release)

```
default-src 'self';
script-src  'self' https://js-cdn.music.apple.com;
style-src   'self';
img-src     'self' data: blob: https://*.mzstatic.com https://*.blobstore.apple.com http://cover.localhost http://files.localhost http://wallpaper.localhost;
media-src   'self' blob: https://*.apple.com;
font-src    'self' data:;
connect-src 'self' ipc: http://ipc.localhost
            https://*.apple.com https://*.mzstatic.com
            http://cover.localhost http://files.localhost http://wallpaper.localhost
            https://rooms.deets.solutions wss://rooms.deets.solutions
            https://musicfriends.deets.solutions wss://musicfriends.deets.solutions;
worker-src  'self';
object-src  'none';
base-uri    'none';
form-action 'none';
frame-src   'none'
```

- **`script-src` holds no `'unsafe-inline'` and no `'unsafe-eval'`.** Tauri adds a hash for
  each inline script (§4). If MusicKit needs `eval` or WebAssembly, the report-only release
  (§6) shows it, and the policy adds the one keyword it needs.
- **`style-src` is strict.** The 2026-09-29 design kept `'unsafe-inline'` because of the
  style templates. There are only 3 now, and each sets one value (`animation-delay`,
  `--slider-fill`, `--updates-got`). They move to `el.style.setProperty` after the
  `innerHTML`. A style injection cannot run code, but with `'unsafe-inline'` it can draw a
  fake control over a real one. If MusicKit adds inline styles, the report-only release shows
  it.
- **`*.apple.com` is wide on purpose.** MusicKit's hosts are not documented and change. The
  report-only release lists the real ones (§6). After that, narrow the list if it is short and
  stable.
- **`worker-src 'self'`**, not `blob:`: every worker is a file. The 2026-09-29 list had
  `blob:`; nothing needs it now.
- **`base-uri 'none'`**: no `<base>` tag is used.

**`tray.html`** has the same origin and takes the same policy. Tauri hashes its inline
script by itself (§4).

**Dev**: the same list, plus `http://localhost:*` and `ws://localhost:*` (vite and its hot
reload, on whatever free port `dev:app` picked), `http://127.0.0.1:*` and `ws://127.0.0.1:*`
(a local worker), and `'unsafe-inline'` on `style-src` on the plain dev server (vite injects
a `<style>` tag per CSS file). The probe is answered (§12.1): Tauri's `devCsp` never reaches a
dev page on the desktop, so a Vite plugin sends this policy instead.

## 4. The inline scripts

Read in Tauri's source (`tauri-codegen` 2.7.2, `context.rs` and `embedded_assets.rs`): when
`csp` is set, the build reads each HTML file in `frontendDist`, hashes each inline `<script>`,
and adds the hashes to that file's `script-src`. So `index.html` and `tray.html` each get
their own hashes, and no build step of ours is needed.

1. **The `onerror` attribute goes.** A hash never allows an inline event handler. The alert
   script (which runs before the MusicKit tag) listens instead:
   `addEventListener("error", (e) => { if (e.target?.src === MK) window.__musicKitFailed = true; }, true)`.
   The capture phase sees a script's load error.
2. **The release check** gets a new check: `index.html` and `tray.html` have no `on…=`
   attribute, and `csp` in `tauri.conf.json` is not `null`. A check on the hashes is not
   needed: Tauri makes them from the files at each build.

## 5. Two more switches in the same build

- **`withGlobalTauri: false`.** Nothing reads `window.__TAURI__` (§2). The code imports
  `@tauri-apps/api`. A script that gets in can still reach `window.__TAURI_INTERNALS__`, so
  this alone protects little. It costs nothing, and it removes the easy path.
- **`freezePrototype: true`.** Tauri freezes `Object.prototype`, so a script cannot change
  how the IPC reads its arguments. **Probe first:** the fetch wrap replaces `window.fetch`
  and the alert filter replaces `window.alert`. These are properties of `window`, not of a
  prototype, so they should still work. A cold start with music and the Network panel open
  shows it.

## 6. The rollout: a report-only release, then enforce

The 2026-09-29 design asked whether Tauri could send `Content-Security-Policy-Report-Only`.
The config cannot (read 2026-10-21: `app.security.headers` in `tauri-utils` 2.9.3 takes a
fixed list of headers, and the CSP is not one of them). **The hook can.** Tauri 2.11 has
`on_web_resource_request` on a window builder. Tauri's own doc comment for it shows a change
to the CSP header.

So:

1. **Make the two windows in code.** `"create": false` on both in `tauri.conf.json`, then
   `WebviewWindowBuilder::from_config(app, &cfg)?.on_web_resource_request(hook).build()` in
   `lib.rs` setup. Everything else in the config stays as it is.
2. **The hook** reads the mode (`enforce` · `report`) and, in `report`, renames the
   `Content-Security-Policy` header to `Content-Security-Policy-Report-Only`. Tauri still
   makes the policy and the hashes. The hook only picks the header's name.
3. **The listener.** A `securitypolicyviolation` listener in `main.ts` and `tray.ts` writes
   each block to the diag ring as `csp:blocked` (directive, blocked host, file and line; never
   the full URL, since a song piece's URL carries a session key). It fires in both modes.
4. **The steps.**

| Step | Mode | How we learn |
|---|---|---|
| 1. His dev app | `report` on `dev:built` (or `dev:app`, after the §3 probe) | a week of his use; read the ring |
| 2. One release | `report` for everyone | the ring on his installed app, bug reports, and the counts (§9) |
| 3. The next release | `enforce` | the desk test (§10) |

> **Part:** step 3 started · 2026-10-23. His call: `RELEASE_MODE` is `Enforce` from 0.99.0, a test
> build he installs and uses for a day on his own PC (not published). The review before the
> public 1.0.0: the `csp-<directive>:` lines in his installed app's log and `diag` ring
> (`csp:blocked`), and what stopped working. §10's scripted desk test was not run first; his
> day of use is the test, and the signed relaxation (§7) is the way back for everyone else.
| 4. Tighten | `*.apple.com` narrowed to the hosts steps 1–2 saw | — |

## 7. The way back: a signed relaxation

The 2026-09-29 design named the worst risk: Apple changes MusicKit, the policy blocks a new
host, and there is no sound until we ship a release. The remote config cannot change a CSP
that is built into the exe. **The hook can**, because it runs at each page load.

- The remote config (`apple_remote_config`, from DeetsSupport with the developer token) may
  carry `csp: { mode, add, versions, sig }`. `mode` is `report` or `enforce`. `add` holds
  extra sources per directive, e.g. `{ "connect-src": ["https://new.apple.com"] }`. `versions`
  is the app versions it applies to. `sig` is a minisign signature over the other three.
- The app checks `sig` with the updater key that `velo.rs` already has (`PUBKEY`). Without a
  valid signature, the field is ignored and logged. Someone who controls the worker cannot
  turn the policy off: they need the updater key, and that key can already ship any code.
- The `versions` range stops an old relaxation from reaching a later release.
- **When it applies.** The remote config rides the developer token (`apple.rs`
  `remote_config()`). **Probe first:** is it on disk in `developer-token.json`, and is it read
  before the windows are made? If yes, the hook applies it at launch. If not, the hook keeps
  the last valid relaxation in its own small file (`safe_file::write_atomic`). A relaxation
  that arrives while the app runs reloads the page at once if no music plays, else at the
  next launch.
- **To send one:** `npm run csp:relax -- --add "connect-src https://…" --versions 0.33.x`
  signs with the updater key (RELEASE.md §0 holds it) and prints the JSON for the worker's
  secret. One line in RELEASE.md and in DEBUGGING.md.

## 8. Later: the commands each window may call (not in this build)

> **Part:** idea · 2026-10-21

The policy keeps scripts out. It does not limit what a script inside can call. Tauri v2 can:
`tauri_build::Attributes::app_manifest(AppManifest::new().commands(&[…]))` makes each app
command a permission, and each capability lists the commands its windows may call. The tray
panel calls about 15 commands. Today it may call all 272. A main window list would be long, but
it would let the page call only the commands that exist for it. This is a build of its own after
the policy ships, with its own doc.

## 9. The fork (closed)

**C1 — his call, 2026-10-21: a, counts only.**

**C1. Do the block counts go home with the weekly health counts?** The listener (§6, step 3)
fills the local ring. A user who loses sound in the report-only release may never send a bug
report.

- **a. Yes, counts only (recommended).** One allow-listed key per directive, e.g.
  `csp.connect-src: 3`, with no host, no URL and no ID, under the USAGE-COUNTS.md §2 rules.
  We learn in a week that a directive blocks something on real installs. Cost: a line in
  `src/usage-keys.ts`, `npm run usage:keys`, and a DeetsSupport deploy (his call), before the
  report-only release ships.
- **b. No.** The ring and bug reports only. Nothing new goes home. We learn of a break only
  when someone tells us.

## 10. The desk test (step 3, enforce)

Run on `dev:built` with `enforce`, as a shots list in `docs/ops/checks/csp.json`, then his
hand test. The console and the ring show no `csp:blocked` through all of it:

- A cold start plays a song. Skip, seek, a station, the EQ on (the worklet).
- A launch with no network, then the network back (the MusicKit reload path, `player.ts`).
- Each skin: Ocean (its worker), Metal (its baked `blob:` textures), Happy (the scene art,
  the fonts), Press (the record).
- Glass › Canvas with the cover, then with your own picture (`files.localhost`,
  `wallpaper.localhost`, the `blob:` soft picture). A mosaic playlist cover.
- A room and a friend's row (the two `wss` hosts and the room `POST`).
- The tray panel's look on a dark-mode launch (its hashed pre-paint).
- The main window's look on a dark-mode launch (its hashed pre-paint): no Lilac × Press flash.
- The Settings sliders (`--slider-fill`), a flashed row, and an update download bar
  (`--updates-got`): the three rewritten style templates.
- The Network panel, open while music plays (the fetch wrap under `freezePrototype`).
- A forced HTML injection: a Rulez rule named `<img src=x onerror=alert(1)>` shows as
  text, and a script tag set into a row by `webview-eval` is blocked and logged.
- A signed relaxation from a test file turns `report` on at the next launch. One with a
  bad signature is ignored and logged.

## 11. What follows the build

- CLAUDE.md's build checklist gains one item: a new outside host the page talks to is a line
  in §3, and a new `on…=` attribute in HTML fails the release check.
- `ideas/SECRETS-AND-CSP.md` Part A points here. Part B (DPAPI) stays there.
- AGENT.md and the user guide need nothing: the policy changes no behavior a user sees.

## 12. As built

> **Part:** built · 2026-10-21

Where this section and the design above disagree, this section is the code.

### 12.1 The pieces

| Piece | Where |
|---|---|
| The policy, `freezePrototype: true`, `withGlobalTauri: false`, `create: false` on both windows | `src-tauri/tauri.conf.json` |
| The windows made in setup with the hook, right after the log starts (where Tauri made the config windows, so the order of the rest is the same) | `lib.rs` setup |
| The mode (`RELEASE_MODE`: `Enforce` since 0.99.0, 2026-10-23; `Report` in 0.32.0), the hook, the relaxation's check and fetch, the `csp_blocked` command | `src-tauri/src/csp.rs` |
| `verify_with`, so a test can sign with a throwaway key | `src-tauri/src/velo.rs` |
| The per-directive health counts | `usage.rs` `note_log` |
| The signing script | `scripts/csp-relax.mjs`, `npm run csp:relax` |
| The policy on the dev servers (`dev:app` and `--built`) | `scripts/csp-dev-plugin.mjs`, in `vite.config.ts` |

**The dev probe, answered by reading Tauri 2.11.6.** On the desktop, the dev page loads straight
from Vite's URL. Only a page the bundle serves passes Tauri's asset protocol, where the CSP header
and the hook live (`protocol/tauri.rs`; the dev proxy is mobile only). So neither `devCsp` nor the
hook reaches `dev:app` or `dev:built`. The Vite plugin sends the same policy from Vite's own
servers. It reads it from `tauri.conf.json` and hashes each page's inline scripts as
`tauri-codegen` does (CRLF to LF, SHA-256). Report-only by default; `DEETS_CSP=enforce` enforces.

### 12.2 What changed from the design

- **The relaxation rides `/config`, not the token (§7).** The cached remote config refreshes only
  when the developer token does (14 days, renewed 3 days before the end). That is too slow when
  there is no sound. DeetsSupport already has `GET /config?app=deetsmusic` (its `CONFIG` var
  with D1 rows over it), and a D1 row needs no deploy. `csp.rs` fetches it in the background at
  each release start (one small call), checks the signature, and keeps the signed text in
  `csp-relax.json` (`write_atomic`). A missing `csp` key drops the file. **It applies from the
  next launch only.** A reload mid-session is not built: a user with no sound restarts the app.
  `csp:relax` prints the D1 command and never runs it.
- **The counts need no worker deploy (C1).** A block is one WARN line in its own log area,
  `csp-<directive>` (`csp-connect-src`, `csp-other` for a name the list lacks).
  `usage.rs` counts each such area, and the worker already takes any short area name.
  So the report carries `log.warn.csp-connect-src: 3`, never a host or a URL (USAGE-COUNTS.md
  §2). Every area fits the worker's 16-character rule (a test holds it).
- **One line per block, not per event.** The page sends each directive + host + file once per
  page load, so a broken host that MusicKit calls a thousand times counts once a launch.

### 12.3 The first run (dev app, 2026-10-21, report-only through the Vite plugin)

- **It found a host at once.** Library covers load from `https://store-0NN.blobstore.apple.com`,
  which `img-src` lacked (`csp-img-src: would block store-033.blobstore.apple.com`, from
  `keyed.ts:126`). Added `https://*.blobstore.apple.com` to `img-src`. After the restart, 11 such
  covers were on screen and no block was logged. `connect-src` already allows `*.apple.com`.
- `window.__TAURI__` is gone, `Object.prototype` is frozen, MusicKit loaded and configured,
  and 14 songs played on the build with `freezePrototype` (13:29–13:32). The page's
  localStorage kept all 14 keys through the change to windows made in setup.
- **Not run yet:** the strict `style-src` (the plain dev server allows inline styles for
  Vite; `npm run dev:built` is the strict one), and the release bundle itself (the hook's
  rename and Tauri's own hashes). Both are in §10's desk test, and the second is a check on
  the installed build before `release:publish`: the log's `csp: Report` line at start, and no
  `csp-` line while it plays, opens each skin and shows the tray panel.

### 12.4 Decided inside his choice (for his review)

1. The relaxation applies from the next launch, never by a reload (§12.2).
2. Counts are per page load, not per event (§12.2).
3. `/config` is fetched at every release start; a dev build never fetches it.
4. A relaxation that makes a header the webview cannot take keeps the built-in policy.
