# Last.fm scrobbling

Built 2026-09-16. **Desk-tested 2026-09-16 in the dev app: complete.** Connect, now playing and
scrobbles (two songs heard to the end) all worked. §9 has what the test covered.

**Terms**
- **Scrobble:** one play that Last.fm saves to the user's profile.
- **Now playing:** a short "listening now" line on the profile. It does not count in charts.
- **Session key:** the permanent key that Last.fm gives the app after the user clicks Allow once.
- **API key and shared secret:** the two values of the Last.fm API account "DeetsMusic". The
  secret signs every call.

## 1. Decisions (2026-09-16)

| # | Fork | Decision | Why |
|---|---|---|---|
| 1 | Where the secret lives | **In the app** (A) | Last.fm expects a desktop app to carry it. A person who extracts it can send calls as "DeetsMusic", but cannot reach an account. B (the Worker signs every call) puts every scrobble through our Worker. |
| 2 | Connect | **Browser + checks** (A), in the title menu › Account under Apple Music | Last.fm's desktop auth. The `cb` link back is added on top (§4). |
| 3 | Where waiting scrobbles live | **A column on `play_events`** (A) | A scrobble is a state of a play the app already saves. It survives a crash and a restart. |
| 4 | Album names | **Send Apple's names as they are** (B) | Last.fm: use metadata from "well-structured sources", and never apply its corrections without the user. It gives no rule to strip " - Single" / " - EP". Last.fm corrects names on its side for users who turn that on. |
| — | Price | DeetsMusic stays free. Donations are possible. | Last.fm's API terms allow non-commercial use only. They do not mention donations. Say "free, optional donations" in the API account application. |

## 2. The key

- The file is `Documents\Deets' Secrets\lastfm.json`: `{ "apiKey": "…", "sharedSecret": "…" }`.
  Its README line says where it comes from (last.fm/api/accounts).
- `src-tauri/build.rs` reads the file at compile time. It hands the two values to `lastfm.rs` as
  `option_env!("DEETS_LASTFM_KEY")` and `DEETS_LASTFM_SECRET`. `DEETSMUSIC_LASTFM` names another file.
- Only the values reach the exe. The path does not.
- With no file, or a `PASTE_…` value, the build still succeeds. Cargo prints a warning, the
  Account row says "Not in this build", and no Last.fm call is made.
- `scripts/release-check.mjs` check 7 fails a release when the file has no key, or when the
  release exe does not contain it. It never prints the key.
- **A new or reset secret:** paste it into the file, then rebuild. Cargo re-runs build.rs when
  the file changes. The dev runner does not watch it: restart `dev:app`.

## 3. The calls

All calls are POSTs to `https://ws.audioscrobbler.com/2.0/` with `format=json`, and all are
signed. `api_sig` = MD5 of every parameter except `format`, sorted by name, name then value,
then the secret (the `md-5` crate). User-Agent `DeetsMusic/<version>`.

| Call | When | Parameters |
|---|---|---|
| `auth.getToken` | Connect is clicked | — |
| `auth.getSession` | Every 3 s while a connect waits, and at once on the link back | `token` |
| `track.updateNowPlaying` | A song starts (`record_event_start`) | `artist`, `track`, `album`, `duration`, `sk` |
| `track.scrobble` | A play is queued; 20 s after launch; 5 min after a failure | up to 50 × `artist[i]`, `track[i]`, `timestamp[i]`, `album[i]`, `duration[i]`, `chosenByUser[i]`, `sk` |

Cost: one now-playing call per song and about one scrobble call per song. Zero Apple calls.

## 4. Connect (the title menu › Account › Last.fm)

1. The user clicks **Last.fm**. `lastfm_begin_auth` gets a token and opens
   `last.fm/api/auth/?api_key=…&token=…&cb=<scheme>://lastfm` in the browser.
2. The row shows a spinner and "Click Allow in your browser, or click again to cancel."
3. Rust calls `auth.getSession` every 3 s. Error 14 means "not yet". Errors 15 and 4 mean
   the token expired. After 5 minutes the connect ends with "timeout".
4. **The link back.** Last.fm's web-auth page allows a `cb` on each request, so after Allow it
   may send the browser to `<scheme>://lastfm?token=…`. The link carries no power: a token
   that matches the connect in progress only makes the next check happen now. Any other
   link is logged and ignored. The single-instance callback (`lib.rs`) routes a link by its
   host, `lastfm` or `auth`, and brings the window forward.
   **Desk test 2026-09-16:** the Allow page showed no error, and the connect finished in 10 s.
   The log has no `link back arrived` line, so the checks finished it, not the link. The link
   back is harmless, so it stays. Earlier note: whether Last.fm accepts a custom-scheme `cb` with the desktop token. If the
   Allow page shows an error, set `LINK_BACK = false` in `lastfm.rs`. The checks alone still connect.
5. On success: `lastfm-session.json` is saved in the app data folder, the key is registered with
   the log scrubber, and the row reads "Connected as *name*". The name opens the profile in the
   browser (it also credits Last.fm). A toast says "Last.fm connected."
6. **Click again while connected** = Disconnect. It deletes the session file and drops the
   rows still `queued` (they would go to the next account). Rows already sent stay `sent`.

The dev app (`dev:app`) has its own data folder, so it has its own connect. It uses
`deetsmusic-dev://lastfm` as its link back.

## 5. Scrobbling

**The rule is Last.fm's, not Rewind's.** A song over 30 s, heard for half its length or 4
minutes, whichever comes first. "Heard" is `ms_listened`: forward progress only, so a seek
does not count and a pause does not count. The Rewind row "Count a play at" does not change it.

1. **Start.** `record_event_start` writes the `play_events` row, then calls
   `lastfm::now_playing`. That reads the song from `tracks` (after 1.5 s once more, for a
   catalog song whose row is still being written), skips songs with no length or under 30 s
   (live radio), and sends. A failure is logged only.
2. **Heard.** `stats.ts` `lastfmHeard` watches each progress tick. The moment the play passes
   the rule, it calls `lastfm_heard` once for that play. The length is `currentTime / progress`.
3. **Queued.** `lastfm_heard` checks the rule again with the stored length, then sets
   `play_events.lastfm = 'queued'`. It does nothing when no account is connected or
   **Scrobble plays** is off. Last.fm allows a scrobble at any time after the rule is met, so the
   app does not wait for the song to end. The last song before a quit is not lost.
4. **Sent.** `flush` sends queued rows oldest first, 50 per call. Each row becomes:

| `lastfm` | Means |
|---|---|
| NULL | Not for Last.fm: no account, the row off, not heard long enough, or a play from before the connect (**no history is sent**) |
| `queued` | Waiting to send |
| `sent` | Last.fm accepted it |
| `ignored` | Last.fm filtered it (artist, track, timestamp, daily limit; the code is in the log), or it waited more than 14 days |
| `failed` | Last.fm refused the row (error 6), or the song has no details in `tracks` |

**Errors** (Last.fm's scrobbling page: retry only 11, 16 and 9):

| Answer | What the app does |
|---|---|
| Network failure, 11, 16, 29 (rate limit) | Rows stay `queued`. One retry in 5 minutes. |
| 9 (session refused) | Rows stay `queued`. The row reads "Last.fm needs you to connect again". One sticky toast with **Connect**. A new connect sends the rows. |
| 6 (bad parameters) in a batch | The flush sends one row per call, so only the bad row becomes `failed`. |
| Any other (10, 13, 26: the key or the signature) | Our problem, not the row's. Rows stay `queued` until the next launch, so a fixed build still sends them. Logged as an error. |

**`chosenByUser`:** 0 when the play's context starts with `station` (Apple picked the song), else 1.

**Not handled on purpose**
- A play that never finalized its row is still scrobbled, because the heard trigger comes before the end.
- A crash before a play passes the rule: nothing to send. That is correct.
- History from before the connect is not back-filled. Last.fm refuses timestamps older than
  about two weeks anyway.
- Love (♥) is not sent to Last.fm. Possible later: `track.love` rides Add to Library and ♥.

## 6. Settings

| Where | Row (hint) | Owner | Default |
|---|---|---|---|
| Settings › Last.fm | Scrobble plays (Sends each song to your Last.fm profile once you hear half of it or 4 minutes) | Rust `lastfm_scrobble`, `settings_set_lastfm_scrobble` | on |
| Settings › Last.fm | Show now playing (Your Last.fm profile shows the song while it plays) | Rust `lastfm_now_playing`, `settings_set_lastfm_now_playing` | on |

- Default on: connecting is the consent. The rows pause it without losing the account.
- In Rust (`settings.json`), because Rust reads them per play.
- The section's status line reads the account and the waiting count and repaints on `lastfm-changed`.
- Agents: `lastfmScrobble` and `lastfmNowPlaying`, **off only** (AGENT.md). They write to the
  user's Last.fm profile, like the Apple Music gates. An agent can never connect an account.
- Settings › About now says that the songs you hear go to Last.fm when you connect it.

## 7. Where things live

| What | Where |
|---|---|
| Connect, now playing, queue, flush | `src-tauri/src/lastfm.rs` |
| The key | `build.rs` ← `Documents\Deets' Secrets\lastfm.json` |
| Session | `<app data>/lastfm-session.json` (`{ name, key }`) |
| Scrobble state | `play_events.lastfm` (schema v6, `library::migrate_v6`, partial index) |
| Heard trigger | `src/stats.ts` `lastfmHeard` |
| Account row | `index.html` `#lastfm-account`, `src/lastfm.ts` `initLastfm` |
| Settings rows | `src/settings-card.ts` section "Last.fm"; `src/agent-settings.ts` |
| Link routing | `lib.rs` single-instance callback → `lastfm::handle_link` |

**Log lines** (`deetsmusic.log`): `lastfm: connected at launch`, `connect page opened`,
`link back arrived`, `connected`, `connect cancelled`, `no Allow within 5 min`, `play N queued`,
`sent N scrobble(s), M ignored`, `play N ignored by Last.fm (code …)`, `send failed (…); retrying in 5 min`,
`Last.fm refused the session`, `disconnected; N waiting scrobble(s) dropped`. Renderer:
`lastfm:queued`, `lastfm:connected`, `lastfm:connectFailed`.

## 8. Toasts

See TOASTS.md §5 (`lastfm.ts` rows): connected (success), didn't finish in time (error, Try
again), can't reach Last.fm (warn, Try again), didn't finish (warn, Try again), couldn't
disconnect (warn), session refused (warn, sticky, Connect).

## 9. Desk test

**Result 2026-09-16 (dev app):** steps 1–6 passed (connect in 10 s, now playing on Last.fm, `play 235` and
`play 236` queued and sent, 0 ignored). Steps 7–11 were not run separately.

**OPEN — re-test the connect in the first installed release that carries Last.fm.** The user
does it then (decided 2026-09-16); it is also a box in RELEASE.md §1a. The dev test left one
question: the log had no `lastfm: link back arrived` line, so the 3 s checks finished the connect,
not the `deetsmusic-dev://lastfm` link. The installed app registers `deetsmusic://` through its
installer, so it is the real test of the link back:
1. Account › Last.fm: disconnect, then connect from zero. Last.fm's Allow page shows no error.
2. After Allow, note whether the browser asks to open DeetsMusic, and whether the log shows
   `link back arrived`.
3. **Link works:** nothing to change. **No prompt and no line:** set `LINK_BACK = false` in
   `lastfm.rs` for the next release (the checks already connect), and update §4.
4. Play one song past half: `sent 1 scrobble(s)` in the installed log (Settings › Bugs › App log).

Before it: fill in `lastfm.json`, then restart `dev:app` (build.rs runs again).

1. Title menu › Account shows **Last.fm** under Apple Music with a red ×, "Not connected".
2. Click it. The browser opens Last.fm's Allow page. **Check: no error from the `cb`** (§4.4).
   Click Allow. The browser offers to open DeetsMusic (the link back), and the row turns
   "Connected as *name*" within a second. Without the link: within 3 s.
3. Click the name. Your profile opens.
4. Play a song. The profile shows it as listening now.
5. Let it play past half (or 4 min). The log shows `play N queued`, then `sent 1 scrobble(s)`.
   The profile lists the scrobble.
6. Turn off Wi-Fi, hear a song past half, then quit. The Settings › Last.fm line shows "1 waiting
   to send". Turn on Wi-Fi and start the app. About 20 s later the log shows the send.
7. Play a station song past half. On Last.fm it is a normal scrobble (chosenByUser does not show).
8. Settings › Last.fm › Scrobble plays off: a song past half logs no `queued`.
9. Click Last.fm while it waits for Allow: the spinner stops, no toast.
10. Click Last.fm while connected: it reads "Not connected"; `lastfm-session.json` is gone.
11. Remove DeetsMusic at last.fm/settings/applications, then play a song past half. One toast
    says to connect again; the row says the plays wait. Connect: the waiting row sends.
