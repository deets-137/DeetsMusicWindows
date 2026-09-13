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
| Setting | none | `toasts`: `failures` (default) · `all` · `off` — Settings › Window › **Show notices** |
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
| `failures` (default) | `warn` + `error` + every notice |
| `all` | every kind — confirmations (`success`) and unlocks (`info`) too |
| `off` | nothing. The console and the log still record every call (`toast:muted`). |

`off` silences the launch-time token error too; that is the user's choice.

## 5. The call sites (all built 2026-09-13)

| Where | Kind | Text | Notes |
|---|---|---|---|
| `start-station.ts` — seed with no station | warn | Apple Music has no station for this song / artist. | The motivating case (2026-07-03). Artist tiles: "Couldn't find *Name* on Apple Music." when the artist id doesn't resolve. A throw in the seed or artist lookup: "Couldn't start the station." A failed play is `playStation`'s toast (next row), so it never shows twice. |
| `player.ts` `playStation` — any station play fails | warn | Couldn't start *Station name*. | Radio, Search, Start Station, the agent, and the launch-time station resume. |
| `copy-link.ts` — clipboard | success / warn | Link copied. / Couldn't copy the link. | Success is `all`-tier: the clipboard shows nothing otherwise. A library album with no catalog page: "This album has no Apple Music page to link." |
| `library-add.ts` — the write | warn | Couldn't add the song/album to your library. | Every add path (menus, the NP square, the Search row square, the tray "+" via `addTrackToLibrary`). |
| `library-add.ts` — first add of the session | notice `info` | Added. Apple has no undo from here; remove it in the Music app. | `deets.notice.addOneWay`. Later adds: a `success` "Added to your library." (`all`). |
| `player.ts` `noteDeadSongs` — ids first found dead | warn, 6 s | Skipped "Title" — Apple Music no longer offers it. / Skipped N songs …: "A", "B" and N more. | Trigger: `dead_ids_mark`'s `fresh`. Names collect for 1 s (a feed rejection, its retry and `healDeadNext` can each mark within a second) and raise once. Names **songs, not ids**, and only handles with no play target left (`playId` undefined) — a dead catalog id whose library id still plays is not skipped, so it is not named. Known-dead ids skip silently. |
| `player.ts` `onPlaybackError` — the first non-dead-song playback error after a sign-in, before any audio has played | warn, 8 s | Playback failed after sign-in. DeetsMusic needs an Apple Music subscription on this Apple ID. | `noteSignedIn()` from `main.ts` arms it once. MusicKit reports a missing subscription only as a playback error, never at sign-in — this is the one moment the cause is likely. **Unverified against a real no-subscription account**; the log's `player:playbackError` msg will say what MusicKit actually sent. |
| `main.ts` — boot | error (sticky) | Can't reach the token service. Check your connection and restart DeetsMusic. | `apple_developer_token` rejects when `ensure_developer_token()` failed at setup (offline first run, or the mint's `KILL` — RELEASE.md §7). Zero-cost: it reads the static. |
| `main.ts` — Account | error (sticky) / warn | Sign-in did not complete. Open Account and try again. / Sign-in failed. Open Account and try again. / Couldn't disconnect. Try again. | The 5-minute `connect()` timeout; the flyout is long closed by then, so the row's error text alone is invisible. Other failures get plain copy; the raw message stays in the console and the row (fixed 2026-09-13: it used to show `Account: <raw message>`). |
| `player.ts` `playTracks` — a play click fails | warn | Couldn't play “Title”. / Apple Music no longer offers “Title”. (or "these songs") | Every card and the agent go through it; the callers only log. Raised 1.4 s after the failure, and skipped when the dead-song toast has named the same song (desk-forced 2026-09-13: a dead id used to show both). The second text is for a play whose songs are all **already known dead**: `playContext` now refuses it before the model changes (`nothing to play: …`, a 400 for the agent). Before, it returned quietly, left the dead song as Now, and reported success. |
| `player.ts` `queueTracksNext` / `Later` | warn | Couldn't add to the queue. | |
| `favorites.ts` `setLoved` — the Apple write fails | warn | Couldn't update Favorites for “Title”. | The ♥ has already flipped back; the toast says why. |
| `track-store.ts` — a sync `error` event | warn, 6 s | Library sync stopped at N of M songs. Try Refresh in Library. / Couldn't sync your library. Check your connection. | One listener for every sync (startup and the Library ⟳). The spinner alone just stops. |
| `playlists.ts` Add to Playlist ▸ | warn | Couldn't add to the playlist. / Couldn't create the playlist. | The shared menu entry, including its "New Playlist…" field. |
| `playlists-card.ts` — cover, create | warn | “file” is not an image DeetsMusic can read. / Couldn't save the cover. / Couldn't create the playlist. / Couldn't create the folder. | |
| `replay.ts` — the weekly make | success | Replay updated: N songs from this week. | `all` tier. |
| `stats.ts` — Rewind unlock at 50 starts | info | Rewind unlocked: your listening, ranked. Pick it from any slot's title. | `all` tier (the card also just appears in the pickers, as before). |

**Investigated, not built — a library playlist Apple no longer has** (FUTURE-SETTINGS §18
candidate 3). The mirror sync `DELETE`s and re-inserts `apple_playlists` from Apple's own
list, so a playlist Apple has dropped never survives a sync; and the count backfill already
persists a tracks-endpoint 404 as `track_count = 0` (Apple's empty-playlist quirk,
`provider.rs`), so it never re-asks. The 404 that repeats per launch is an *empty* playlist
being opened, not a gone one. Nothing to toast; if a real "gone" case shows up in the log,
it needs one extra `GET /v1/me/library/playlists/{id}` to tell the two apart first.

**Still waiting on their own features:** the playlist-cover notice
(`deets.notice.coverLocal`, NEXT-VERSION §2) and the AirPlay firewall preface
(AIRPLAY.md §9 item 5) — both now have the primitive to call.

**Parked with the auto-updater (2026-09-13) — the mint's remote notice.** Rust keeps the
remote config from the token response (`remote_config()`, `apple_remote_config`), and it
can carry a notice and a minimum version (support.md). No front-end code reads it, so a
server notice never reaches the user. It becomes a notice toast (a `dismissKey` per
notice) and an "update available" toast. Design it with RELEASE.md §6, because both read
the same config. Check the field names against `DeetsSolutions/docs/support.md` first.

## 6. Rules for new call sites

- Keep the console/diag line. The toast is the user's copy; the log is ours.
- A failure the user can do nothing about is a `warn`. Reserve `error` for "act or know".
- Silent success stays the doctrine (FAVORITES.md); a `success` toast is for actions with
  **no other visible result** (a clipboard write) and rides the `all` tier.
- Name things, never ids. Resolve through `trackById` / the playlist name before calling.
- Main window only. The tray panel and the extension popup keep the console.
- No copy in `toast.ts`. If a string will be reused, it lives with its caller.
- Write the text so an agent can act on it too. Every `warn` / `error` raised during an
  agent request goes back in its reply as `notices`, under any tier (`onToast` observer,
  `np-bus.ts`; AGENT.md §3). Say what failed and name the song.
