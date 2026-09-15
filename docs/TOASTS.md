# DeetsMusic — Toasts

> Built 2026-09-13 (branch `claude/deetsmusic-toast-impl-rfw6ch`), **awaiting the first
> desk test** — the test script is [DEBUGGING.md §Toasts](DEBUGGING.md#toasts). Code:
> `src/toast.ts` (the primitive), `src/styles/toast.css` (the host + strip), the `toasts`
> key in `settings-store.ts`, the "Show notices" row in `settings-card.ts`. Design
> history and the candidate ledger: [FUTURE-SETTINGS §18](FUTURE-SETTINGS.md).
> Reference build: the Deets.Solutions toast (`DeetsSolutions/js/toast.js`,
> `docs/ui.md` §Toasts) — same API, same token model; the differences are §3.

**Terms.** A *toast* is one transient message strip. The *host* is the fixed container
that holds the stack. A *kind* is the severity: `info` · `success` · `warn` · `error`. A
*tier* is the user setting that decides which kinds show. A *notice* is a one-time toast
with a "Don't show again" button.

## 1. The API

```ts
import { toast } from "./toast";
const h = toast({ kind, text, sticky, timeout, actions, dismissKey });
h.dismiss(); h.update("new text"); h.shown;
```

| Field | Meaning |
|---|---|
| `kind` | Color + ARIA role only (`error` → `role="alert"`, the rest `role="status"`). Default `info`. |
| `text` | The message. **Callers own their copy**; the module ships none. |
| `sticky` | No timer; stays until a button is pressed. **Default: `true` for `error`, `false` otherwise.** A sticky toast always ends with a Dismiss button. |
| `timeout` | ms for timed toasts. Default 3200. Hover pauses the bar and the timer together. |
| `actions` | `[{ label, run? }]`. Any press runs `run`, then dismisses. |
| `dismissKey` | Makes a **notice**: sticky, admitted under the `failures` tier whatever its kind, a "Don't show again" button writes `"off"` to that localStorage key, and the call is inert once that is written. `noticeOff(key)` reads the flag. |
| `onceKey` | Makes a **once-notice** (2026-09-14): sticky, shows under every tier, ends with **Got it** instead of Dismiss, and **any** button press writes `"off"` to the key — it has been seen. Used where the notice also points to Settings (a **[Settings]** action → `requestSetting`). |

`shown` is `false` when the tier or a silenced notice swallowed the call. The call site's
console/diag logging is untouched either way — **diag stays the source of truth** (every
call logs `toast` or `toast:muted` with the reason).

## 2. The sticky rule (decided 2026-09-13)

The kind is severity; sticky-or-timed is *what the user must do*:

- **`error` = sticky.** Something the user must know or act on, and the moment may have
  passed (a 5-minute sign-in timed out while the flyout was closed; no token at launch).
- **`warn` = timed.** A routine failure with nothing to do: the click did nothing, here is
  why. Lives 3.2 s (6–8 s when it names songs or explains a cause).
- **`success` / `info` = timed.** Confirmations and unlocks. `info` with a `dismissKey` is
  a notice and sticky.

A caller may override `sticky` either way; none does today.

## 3. Where it differs from the site

| | Deets.Solutions | DeetsMusic |
|---|---|---|
| Position | top-right column under the header | **top-right, newest on top**, on every surface. **mini/midi:** under the Now Playing card, so the song stays readable (`--toast-top`, the card's bottom edge measured by `toast.ts`) · **max:** under the titlebar, since the stage is on the left. Changed 2026-09-13 from bottom-centred in mini/midi. |
| Fly-in | from the right | from the right (`--toast-shift`) |
| Cap | 4 | **3** — the oldest *timed* toast yields first; sticky ones only when nothing timed is left |
| Setting | none | `toasts`: `all` (default, 2026-09-13) · `failures` — Settings › Look and feel › **Show notices** (no `off` since 2026-09-14, §4) |
| Notices | none | `dismissKey` + `noticeOff()` |
| Sticky default | caller's choice | `error` sticky by default (§2) |
| z-index | 50, above menus | **90, below** the context menu / pickers (100): an open menu is live intent, a toast waits |
| Buttons | the `tb-pill` kit | `.toast__btn`, the context-menu row idiom |

Everything else is a straight port: menu material (`--menu-surface` + `--menu-backdrop`,
so Glass frosts it), `--radius-panel`, `--shadow-panel`, `--border`; the kind stripe from
the theme's traffic lights (`--go` / `--pause` / `--stop`, info `--panel-border`) so the
monochrome themes express severity in-family; `--dur-med` / `--ease-ui`; reduced motion
snaps. Skin tokens added: `--toast-w` (304px), `--toast-stripe`, `--toast-bar`,
`--toast-shift`. The **duration is a module constant**, not a skin token: a skin reshapes
the app, it does not decide how long a message stays.

## 4. The tiers

| Tier | Shows |
|---|---|
| `all` (default) | every kind — confirmations (`success`) and unlocks (`info`) too |
| `failures` | `warn` + `error` + every notice |

**No `off` (removed 2026-09-14).** A failure must always reach the user; a saved `"off"`
migrates to `failures` (`settings-store.ts`). **A question always shows:** a sticky toast
with the caller's own `actions` is admitted under every tier, because a muted question would
stop the action it gates (the export confirm, PLAYLISTS.md §6). A question is not a failure:
it writes only its `toast` diag line, never the `warn`/`error` line (2026-09-14, for the red
delete confirm). A question with its own **Cancel** button gets no extra Dismiss.

## 5. The call sites (all built 2026-09-13)

| Where | Kind | Text | Notes |
|---|---|---|---|
| `start-station.ts` — seed with no station | warn | Apple Music has no station for this song / artist. | The motivating case (2026-07-03). Artist tiles: "Couldn't find *Name* on Apple Music." when the artist id doesn't resolve. A throw in the seed or artist lookup: "Couldn't start the station." A failed play is `playStation`'s toast (next row), so it never shows twice. |
| `player.ts` `playStation` — any station play fails | warn | Couldn't start *Station name*. | Radio, Search, Start Station, the agent, and the launch-time station resume. |
| `copy-link.ts` — clipboard | success / warn | Link copied. / Couldn't copy the link. | Success is `all`-tier: the clipboard shows nothing otherwise. A library album with no catalog page: "This album has no Apple Music page to link." |
| `library-add.ts` — the write | warn | Couldn't add the song/album to your library. | Every add path (menus, the NP square, the Search row square, the tray "+" via `addTrackToLibrary`). |
| `library-add.ts` — first add ever | once-notice `info` | Added. DeetsMusic can't remove it; use the Music app. Turn this off in Settings › Apple Music. **[Settings] [Got it]** | `deets.notice.addOneWay` (`onceKey`; a key already silenced stays silenced). [Settings] opens the Add to Library and ♥ row. Later adds: a `success` "Added to your library." (`all`). Revised 2026-09-14: was once per session until Don't show again. |
| `player.ts` `noteDeadSongs` — ids first found dead | warn, 6 s | Skipped "Title" — Apple Music no longer offers it. / Skipped N songs …: "A", "B" and N more. | Trigger: `dead_ids_mark`'s `fresh`. Names collect for 1 s (a feed rejection, its retry and `healDeadNext` can each mark within a second) and raise once. Names **songs, not ids**, and only handles with no play target left (`playId` undefined) — a dead catalog id whose library id still plays is not skipped, so it is not named. Known-dead ids skip silently. |
| `player.ts` `onPlaybackError` — the first non-dead-song playback error after a sign-in, before any audio has played | warn, 8 s | Playback failed after sign-in. DeetsMusic needs an Apple Music subscription on this Apple ID. | `noteSignedIn()` from `main.ts` arms it once. MusicKit reports a missing subscription only as a playback error, never at sign-in — this is the one moment the cause is likely. **Unverified against a real no-subscription account**; the log's `player:playbackError` msg will say what MusicKit actually sent. |
| `main.ts` — boot | error (sticky) | Can't reach the token service. Check your connection and restart DeetsMusic. | `apple_developer_token` rejects when `ensure_developer_token()` failed at setup (offline first run, or the mint's `KILL` — RELEASE.md §7). Zero-cost: it reads the static. |
| `main.ts` — Account sign-in (`signInFailed`) | error / warn, each with **Try again** | Sign-in didn't finish in time. / Apple Music didn't accept the sign-in. Try again in a few minutes. / Another sign-in page is still open. Close it, then try again. / Sign-in didn't finish. Try again. · sign-out: Couldn't sign out. Try again. | Revised 2026-09-13. `connect()` now polls `apple_auth_status`, so a failure the browser page reports (Apple's "Unauthorized", a closed Apple window) arrives at once as a `SignInError` code instead of after the 5-min timeout. `unavailable` / `offline` (the pre-check in `apple_begin_auth`) hand over to Apple health below. The raw reason stays in the console and the log; the row shows "Sign-in didn't finish". Revised again that evening (hosted page, DATA-ARCHITECTURE §2a): the timeout toast adds **Use local sign-in** (a link that never comes back — not followed, or a scheme that is not really registered, DATA-ARCHITECTURE §2a "RESOLVED" — ends in a timeout); the user's own cancel (a second click on the Account button) shows NO toast; the local page's own close arrives as `page closed` → the "didn't finish" toast. |
| `main.ts` — Account sign-in succeeds | success | Sign-in complete! Enjoy! | Added 2026-09-13 on the user's request. `all` tier (the user's choice): the user is usually still in the browser, but the Account row shows Connected, so the `failures` tier stays quiet per §6 (the default is `all` since 2026-09-13, so it shows by default). Only the newest sign-in toasts (`signInSeq`). |
| `apple-health.ts` — **Apple health** (one toast per cause, sticky) | error | Apple Music isn't responding to DeetsMusic right now. Your account is fine. DeetsMusic keeps trying. **[Try now]** | The developer token is refused even after the bounded heal (`apple_check` app=`rejected`/`missing`). Not the user's to fix, so the copy says so. Rechecks every 5 min while it lasts; on recovery the toast goes and "Apple Music is working again." shows (`all` tier). Account row: "Connected · Apple Music isn't responding". |
| `apple-health.ts` | warn | DeetsMusic can't reach Apple Music. Check your internet connection. **[Try again]** | app=`unreachable`. Same 5-min recheck. Row: "Connected · Offline". **Resume (2026-09-14):** when a playback error found this cause (a network drop kills MusicKit's audio player with `loadSegmentError`), the song and last heard position are held; the next check that finds Apple healthy reloads that song and seeks back — once, queue mode only, skipped if anything played or the song changed (`player:resumeArmed` / `resumeAfterReconnect` / `resumeSkip` in the log). |
| `apple-health.ts` | error | Apple Music signed you out. Sign in again to keep listening. **[Sign in]** | The Music User Token is refused (`/v1/me/storefront` 401/403). The Account row reads signed out ("Sign-in expired") and its button signs in. **Sign in** starts the browser sign-in directly (`deets:sign-in`). |
| `player.ts` `requireSignIn` → `apple-health.ts` | warn | Sign in to Apple Music to play songs. **[Sign in]** | Any play with no sign-in (a list click, Up Next jump, a station, the play button) — before MusicKit is touched, so its "Unable to prepare for playback." dialog never appears. No Apple call. |
| `player.ts` `onMusicKitTrouble` | warn | Playback stopped. Try the song again. | MusicKit's own dialog (`index.html` now routes EVERY non-benign `alert()` to player.ts, never a native dialog) or a non-dead playback error, when the health check finds no cause. One recovery per 30 s however many dialogs arrive. **MusicKit's in-page error box** (`#musickit-dialog`, `MKDialog.presentError` on every playback error — it showed "loadSegmentError" on a network drop, 2026-09-13) is off since 2026-09-14: `suppressErrorDialog: true` in both `MusicKit.configure` calls. |
| `main.ts` — boot, remote notice | notice `info` | The Worker's `CONFIG.deetsmusic.notice` text **[Open]** | Rides `/token` (refreshes with the token, about weekly). `dismissKey` is `deets.notice.remote.<hash of the text>`, so a new text shows even after "Don't show again" on an old one. **Open** only when `CONFIG.deetsmusic.noticeUrl` is an https link (2026-09-14) — the lost-updater-key runbook (RELEASE.md §6.6). |
| `updater.ts` — Ask mode, a newer version | sticky info **question** | DeetsMusic X is available. **[Download] [Later] [Skip this version]** | RELEASE.md §6.3. One offer on screen at a time. Later = until the next launch; Skip = `updateSkip` until a newer version. |
| `updater.ts` — an update or rollback is downloaded | sticky info **question** | DeetsMusic X is ready. Restart to update. / …Restart to roll back. / This version of DeetsMusic is no longer supported. Restart to update to X. **[Restart now] [Later] [Skip this version]** | Automatic mode lands here directly. No Skip for a rollback or a required version (under `minVersion`). "Later" counts as the close, so no Dismiss (toast.ts). |
| `updater.ts` — download or install fails | warn | Couldn't download the update. DeetsMusic will try again later. / Couldn't download that version. Try again later. / Couldn't get DeetsMusic X. Try again later. / Couldn't start the installer. Try again. / A dev build doesn't install updates. | A failed scheduled **check** has no toast: the log and the Settings › Updates status line carry it. |

**Recovery bounds (2026-09-13).** Failures arrive without bound, so every layer caps itself:
Rust `refetch_after_401` fetches from the mint at most once per 10 min and never when the
rejected token is no longer the live one; `apple_check` answers from a 60 s cache (forced checks
≥ 10 s apart); `recoverFromFailure` coalesces concurrent failures into one check and allows one
retry per 30 s; `onMusicKitTrouble` starts one recovery per 30 s. A play click that fails runs
the check, re-configures MusicKit if the token was swapped (`syncDeveloperToken`, once per new
token), and retries once; a named cause suppresses "Couldn't play".

**Sign-in routes closed the same day.** A `/v1/me` 403 in Rust emits `apple-signin-rejected`
(once a minute) → `apple-health` runs the cached check → "Apple Music signed you out", and the
library sync's own toast stays quiet whenever the check names a cause. A token the sign-in page
delivers is checked before it is saved (403 twice → "Apple Music didn't accept the sign-in";
the page clears its storage first, so a retry really signs in). The authorization restore
re-injects only when the check says the sign-in works. Sign-out clears MusicKit's in-memory
token without MusicKit's logout call.
| `player.ts` `playTracks` — a play click fails | warn | Couldn't play “Title”. / Apple Music no longer offers “Title”. (or "these songs") | Every card and the agent go through it; the callers only log. Raised 1.4 s after the failure, and skipped when the dead-song toast has named the same song (desk-forced 2026-09-13: a dead id used to show both). The second text is for a play whose songs are all **already known dead**: `playContext` now refuses it before the model changes (`nothing to play: …`, a 400 for the agent). Before, it returned quietly, left the dead song as Now, and reported success. |
| `player.ts` `queueTracksNext` / `Later` | warn | Couldn't add to the queue. | |
| `favorites.ts` `setLoved` — the Apple write fails | warn | Couldn't update Favorites for “Title”. | The ♥ has already flipped back; the toast says why. |
| `track-store.ts` — a sync `error` event | warn, 6 s | Library sync stopped at N of M songs. Try Refresh in Library. / Couldn't sync your library. Check your connection. | One listener for every sync (startup and the Library ⟳). The spinner alone just stops. |
| `playlists.ts` Add to Playlist ▸ | warn | Couldn't add to the playlist. / Couldn't create the playlist. | The shared menu entry, including its "New Playlist…" field. |
| `playlists-card.ts` — cover, create, edit | warn | “file” is not an image DeetsMusic can read. / Couldn't save the cover. / Couldn't create the playlist. / Couldn't create the folder. / Couldn't rename “X”. / Couldn't move the song in “X”. / Couldn't delete “X”. | The file picker and a file dropped on the hero cover share the path. A failed move puts the stored order back. |
| `playlists-card.ts` — Delete Playlist with songs | sticky error **question** | Delete “X” and its N songs? This can't be undone. (+ Its copy on Apple Music stays and will show in your list.) **[Delete] [Cancel]** | PLAYLISTS.md §10.3. An empty playlist is deleted with no question. The second sentence only when the playlist has a live Apple copy. |
| `playlist-export.ts` — Export to Apple Music / Make a New Copy | once-notice `info` → `success` / warn | Made “X” on Apple Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app. Turn this off in Settings › Apple Music. **[Settings] [Got it]** / Made a new “X” on Apple Music. The old copy is still there. / Couldn't export “X” to Apple Music. | `deets.notice.exportOneWay` (`onceKey`) the first time; [Settings] opens the Export playlists row. Skipped uploads are named (" 2 songs skipped: “A” and “B” aren't in the Apple Music catalog.", §10.5) and, like a partial append failure, turn it into a `warn`. PLAYLISTS.md §6. |
| `playlist-export.ts` — Send New Songs | success / sticky warn **question** | Added N songs to “X” on Apple Music. / The Apple copy of “X” is up to date. / Apple Music can't copy every change to “X”. DeetsMusic can add N songs (…) at the end, but it can't remove “A” and “B” or change the order. **[Add N songs] [Make a New Copy]** / The Apple copy of “X” is gone. **[Make a New Copy]** | Was "Add New Songs to Apple Copy". The question comes BEFORE any write and shows under every tier (§4). |
| `playlist-export.ts` — Get New Songs | success / warn | Added N songs from Apple Music to “X”. / “X” already has every song from its Apple copy. / Couldn't read the Apple copy of “X”. / The Apple copy of “X” is gone. **[Make a New Copy]** | PLAYLISTS.md §10.4. No question: nothing local is lost. |
| `playlists.ts` — Add to Playlist ▸ an Apple playlist | sticky info **question** (first add only) / success / warn | Add to “X” on Apple Music? DeetsMusic can't remove songs from it afterwards. **[Add] [Cancel]** / Added N songs to “X” on Apple Music. / …Couldn't add N songs. / (the named-skips line) / Couldn't add to “X” on Apple Music. | PLAYLISTS.md §10.9. [Add] writes `off` to `deets.notice.appleAdd`; after that the add goes at once. |
| `playlists-card.ts` — Import to Edit | success / warn | Imported “X”. You can edit it here. Apple Music ▸ Send New Songs adds its new songs to the original. / Imported “X” as a copy you can edit. The copy doesn't change when Apple Music changes the original. / Couldn't import “X”. | PLAYLISTS.md §10.9. The Send New Songs sentence shows only while Export playlists is on. |
| `drop-actions.ts` — a drop on the Queue card | success / warn | Added “Song” to Up Next. / Added N songs to Up Next. / Couldn't add to the queue. | DRAG-DROP.md §3. No success when nothing was playing (the songs start). The warn covers a failed Search fetch; `queueTracksAt` raises its own. |
| `drop-actions.ts` — a drop on a local playlist | success / warn | Added “Song” to “X”. / Added N songs to “X”. / Couldn't add to the playlist. | A drop on an editable Apple playlist rides the Add to Playlist ▸ Apple row above (its question, its texts). |
| `drop-actions.ts` — a drop on the Library card | info | Those songs are already in your library. | Only when nothing was left to add. The add itself uses the `library-add.ts` rows above. |
| `drop-actions.ts` — a drop on Now Playing | — | (none) | The song starting is the feedback; a failed play is `playTracks`'s toast. |
| `replay.ts` — the weekly make | success | Replay updated: N songs from this week. | `all` tier. |
| `settings-card.ts` — Settings › Bugs › Send | sticky success **with an action** | Bug sent. Copy the link to find it again. / Suggestion sent. Copy the link to find it again. **[Copy link] [Dismiss]** | Added 2026-09-15 (LOGGING.md §The report form). Sticky with its own action, so it shows under every tier and never times out: the link is the only way back to the post. **The link is never in the text** — toast text reaches the diag ring and the log, and the code is a credential. [Copy link] uses `copy-link.ts` ("Link copied."). The report also appears under My reports. |
| `settings-card.ts` — My reports › Refresh / Close | warn | Couldn't reach the support server. Check the connection and try again. / Too many requests in a short time. Wait a minute and try again. / Reports are switched off for now. Try again later. / The support server didn't close the report. Try again later. | Added 2026-09-15. The text is `report.rs`'s error. Refresh warns only when no report could be checked; a partial failure keeps the last known tags. |
| `stats.ts` — Rewind unlock at 50 starts | info | Rewind unlocked: your listening, ranked. Pick it from any slot's title. | `all` tier (the card also just appears in the pickers, as before). |

**Investigated, not built — a library playlist Apple no longer has** (FUTURE-SETTINGS §18
candidate 3). The mirror sync `DELETE`s and re-inserts `apple_playlists` from Apple's own
list, so a playlist Apple has dropped never survives a sync; and the count backfill already
persists a tracks-endpoint 404 as `track_count = 0` (Apple's empty-playlist quirk,
`provider.rs`), so it never re-asks. The 404 that repeats per launch is an *empty* playlist
being opened, not a gone one. Nothing to toast; if a real "gone" case shows up in the log,
it needs one extra `GET /v1/me/library/playlists/{id}` to tell the two apart first.

**Still waiting on its own feature:** the AirPlay firewall preface (AIRPLAY.md §9 item 5).
The planned playlist-cover notice (`deets.notice.coverLocal`) is dropped (2026-09-14): a
custom cover never reaches Apple, and PLAYLISTS.md §6 says so. Add it to the export notice
text if desk testing shows users expect the cover on the Apple copy.

**The mint's remote config (built).** Rust keeps the config from the token response
(`remote_config()`, `apple_remote_config`). `main.ts` shows its `notice` (row above, with
`noticeUrl` as an Open button), and `updater.ts` reads `minVersion` to make an update required
(the updater rows above, 2026-09-14).

## 6. Rules for new call sites

- Keep the console/diag line. The toast is the user's copy; the log is ours.
- A failure the user can do nothing about is a `warn`. Reserve `error` for "act or know".
- Silent success stays the doctrine (FAVORITES.md); a `success` toast is for actions with
  **no other visible result** (a clipboard write) and rides the `all` tier.
- Name things, never ids. Resolve through `trackById` / the playlist name before calling.
- **Put every name in curly quotes** (`“${p.name}”`). `toast.ts` logs the text with each
  quoted span replaced by `“…”`, because a bug report sends the log (LOGGING.md §The report
  form, privacy pass). An unquoted name reaches the log. Never put a link or a code in the text.
- Main window only. The tray panel and the extension popup keep the console.
- No copy in `toast.ts`. If a string will be reused, it lives with its caller.
- Write the text so an agent can act on it too. Every `warn` / `error` raised during an
  agent request goes back in its reply as `notices`, under any tier (`onToast` observer,
  `np-bus.ts`; AGENT.md §3). Say what failed and name the song.
