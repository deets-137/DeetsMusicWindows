# DeetsMusic — DeetsOTD (Song of the Day)

> **Status (2026-09-17): designed, not built. Build 1 is ready to start: §8 is the spec, and
> no fork blocks it.** A Song of the Day
> journal already exists and runs every night, but it lives outside the app: the
> [DeetsOTD](../../../DeetsOTD) repo reads a Discord channel, and
> [deets.solutions/sotd](../../../DeetsSolutions/sotd) shows it. This doc records the state of
> all three places, then the room for DeetsMusic in that chain, then the forks.
> Status marks: ✅ decided · 🔵 open (predicted pick noted) · ⬜ later.

**Terms used in this doc**
- **Pick** — one song a person chose for one day.
- **Journal day** — the calendar day a pick belongs to. DeetsOTD uses America/Los_Angeles
  with a 5 AM grace: a post at 2 AM counts for the day before.
- **The journal** — DeetsOTD's `storage.db` (`posts` + `songs`). It is the source of truth.
- **`songs.json`** — the public, display-only export of the journal on deets.solutions.
- **Local diary** — the original idea of this doc: picks marked inside DeetsMusic and kept in
  its own database.

---

## 1. State of play — the three places

### 1a. DeetsOTD (Python repo, `Documents/DeetsOTD`)

What it is: a Discord bot + CLI that reads every link in the `#song-of-the-day` channel of a
friends' server, stores each song link as a post, and resolves each post to a real track.

| Part | File | State |
|---|---|---|
| Link scan (Discord history) | `linkscan.py`, `scan.py`, `bot.py` (`/links`), `harness.py` (FastAPI stub, `127.0.0.1:8077`) | working |
| Journal store | `storage.py` → `storage.db` (`scans`, `posts`, `songs`) | working; idempotent on `(message_id, url)` |
| Enrich | `enrich.py`, `applemusic.py` | iTunes lookup by Apple id → oEmbed + iTunes search for Spotify/YouTube → Apple Music API (own `.p8` in `secrets/`, gitignored) |
| Correct a bad match | `review.py` | working |
| Exports | `scan.py --export csv/tsv/xlsx`, `--web` (`songs.json`) | working |
| Notion mirror | `notion_sync.py` | **retired 2026-07-14** (code kept) |
| Film journal | `letterboxd_store.py`, `letterboxd_web.py` (`films`, `film_watches`, `film_syncs`) | working; added 2026-07-08 → 08-19 |

The journal on 2026-09-17 (read from `storage.db`):
- **412 posts**, 2026-01-21 → 2026-09-16, **8 posters**. Deets has 196 posts.
- 411 posts link to a song; 408 songs. Match mix: 259 `direct`, 83 `search`, 48 `apple`,
  13 `spotify`, 3 `manual`, **2 `review`** (flagged, waiting for `review.py`).
- Services: 301 Apple Music, 99 Spotify, 12 YouTube.
- Deets posted on 190 journal days; 6 of those days have two posts. So "one pick per day"
  is the habit, not a rule the channel enforces.

The journal day rule is in `storage.py` (`JOURNAL_TZ`, `GRACE_HOURS = 5`). It changed twice:
raw UTC → Chicago + 4 AM (2026-07-17) → Los Angeles + 5 AM (2026-07-27).

**Stale docs in that repo** (not fixed here; that repo is out of scope for this session):
- `docs/HANDOFF.md` is dated 2026-06-28. It says 292 posts, 100% resolved, Notion is the
  presentation layer. All three facts are now wrong.
- `vision.md` gives the path `~/Documents/GitHub/DeetsOTD`; the repo is `~/Documents/DeetsOTD`.

### 1b. deets.solutions (`Documents/DeetsSolutions`)

- **`/sotd/`** — `sotd.js` (608 lines) fetches `sotd/songs.json` and draws a card grid.
  Sort (added, release, artist, uploader, length), View (Full / Small / Line), Filter
  (uploader / genre / month facets, AND/OR), live search, a 30-second preview play button.
  A soft "vanity gate": locked shows only Deets' picks; a word unlocks everyone.
- **Home page SOTD hub** (`js/home.js`) — latest pick as the hero, stat chips (pick count,
  streak, top genre), a cover calendar, and "liner notes" (journal-wide facts, longest
  streak). Next to it: the Movies strip and the DeetsMusic release card.
- **Nightly job** — `scripts/nightly-sotd.ps1`, Windows task "DeetsOTD Nightly SOTD"
  (21:00, catches up on wake). It runs `scan.py <channel> --enrich --web --web-out
  sotd/songs.json`, the Letterboxd RSS ingest, and project dates. When a JSON changed, it
  rebuilds `sotd/og.jpg` (link preview of the newest song), commits only those files, and
  **pushes** (fast-forward only). Cloudflare Pages redeploys. Last run: 2026-09-16 19:11,
  412 songs, pushed `bdb15cc`.
- **`songs.json` shape** — `{generated_at, channel, count, songs[]}`. Each song: `post_id`,
  `posted_at`, `date` (journal day), `track_name`, `artist_name`, `album`, `genre`,
  `duration_sec`, `release_date`, `author` (display name only), `url`, `apple_music_url`,
  `preview_url`, `artwork_url`. Private Discord ids are dropped.
  **409 of 412 rows carry an `apple_music_url` with `?i=<catalog id>`.**
- **`docs/bluesky.md`** — a proposal, not built: `@deets.solutions` handle, post each pick to
  Bluesky, show replies as comments. Stale line there: it says the nightly job "commits but
  never pushes". The job pushes now.

### 1c. DeetsMusic (this repo)

Nothing for Song of the Day exists. No table, no command, no UI, no Discord code. Since this
doc was first written, the app gained parts that a Song of the Day feature would ride:

| Part | Where | Why it matters here |
|---|---|---|
| `play_events` (per-play log, `started_ts`, `ms_listened`) | `library.rs`, DEETS-REWIND §5a | Can name the song you listened to most on a journal day. Zero Apple calls. |
| History card | `src/history-card.ts` | A dated, reverse-chronological list already exists. A diary can be a mode of it, not a new card. |
| Home card shelves | `src/home-card.ts`, HOME.md | A "Songs of the Day" shelf fits the sideways-shelf shape. |
| Local playlists + temporary playlists | `playlists.rs`, PLAYLIST-WEB §10 | An auto-playlist of picks rides the existing store; Apple export stays gated. |
| Context menu, row pick, copy link | `context-menu.ts`, `row-pick.ts`, `copy-link.ts` | "Mark as Song of the Day" and "Copy link for Song of the Day" need no new primitive. |
| Look schedule (time zone from the system) | `look-schedule.ts`, LOOK-SCHEDULE.md | The journal day can use the system time zone + a grace hour. |
| Agent routes, read-only SQL | AGENT.md, LOCAL-DATA.md | An agent (or the nightly job) can read picks and plays without new routes. |
| Deep-link scheme `deetsmusic://` | `lib.rs` (`auth`, `lastfm` only) | A `play` route would be new; see fork 5. |
| Browser extension + loopback bridge | EXTENSION.md | Rejects web-page origins on purpose; a site page cannot drive the app through it. |

---

## 2. What changed in the thinking

The first version of this doc assumed the diary starts empty inside the app. That is not the
real situation. **The owner already keeps a Song of the Day journal, with friends, in
Discord, with 8 months of history and a public page.** So the question is no longer "build a
diary". It is "what does DeetsMusic add to a journal that already works?"

Two constraints shape every answer:

1. **Stranger parity.** DeetsMusic is a public app. A stranger has no Discord channel and no
   `storage.db`. A feature that only works for the owner does not ship as-is
   (see the stranger-parity rule in RELEASE.md §1a).
2. **Discord is the place where the pick happens.** The friends post there. The app must not
   become a second, competing place to post, or the two journals drift apart.

---

## 3. The room for DeetsMusic — options

Each option is independent. Costs are Apple calls per use.

### A. Read the journal into the app ("Songs of the Day" in DeetsMusic)
Fetch a `songs.json`-shaped feed and show it: a card mode, a Home shelf, or a local playlist
per month / per poster. Play by the catalog id from `?i=` — **no search call** for 409 of
412 rows. Artwork URLs are Apple's own (`mzstatic`), so no cover fetch through our key.
- Cost: 0 Apple calls to show; the normal playback calls to play.
- Parity: the feed URL is a setting (empty by default). A stranger can point it at any
  file of the same shape. The owner points it at `deets.solutions/sotd/songs.json`.
- Risk: the feed shape is owned by another repo. Pin the fields we read and fail soft.

### A-1. The feed, in detail (fork 4)
**What the user does.** Settings › Song of the Day › "Journal feed": paste a URL. The owner
pastes `https://deets.solutions/sotd/songs.json`. Empty by default; with no URL, nothing is
fetched.

**What the app does.**
- Rust fetches the URL with `reqwest` (the app already uses it), not the WebView. The front
  end sees only normalized picks, as the Conventions rule asks.
- Rust keeps a copy in SQLite (a `picks` table, `source = 'feed'`). The shelf and Rewind read
  the copy, so they work offline and start fast.
- Refresh: at launch, then once a day. The request sends `If-None-Match` (Cloudflare Pages
  answers with an ETag), so an unchanged file costs one small reply.
- **Apple calls: zero.** The feed carries title, artist, album, length and artwork. The
  catalog id comes from `?i=` in `apple_music_url` (409 of 412 rows). Play uses the normal
  playback path. A song not in the user's storefront goes through the existing `dead_ids`
  handling.

**The shape the app reads ("DeetsOTD feed v1").** The app needs only a subset of
`songs.json`, so the site needs no change:

| Field | Required | Use |
|---|---|---|
| `songs[].date` | yes | the journal day, as the feed wrote it |
| `songs[].track_name`, `artist_name` | yes | the row |
| `songs[].apple_music_url` (with `?i=`) | yes to play | the catalog id |
| `songs[].author` | no | the poster filter |
| `album`, `duration_sec`, `artwork_url`, `genre`, `posted_at` | no | row detail, Rewind groups |

A row without a catalog id shows, but greys out Play. An unknown field is ignored. A file
that is not this shape logs one `diag.log` line and leaves the last good copy.

**Sub-forks**
- 4a ✅ **Whose picks.** The feed has 8 posters. Predicted: a "Show picks from" row,
  **Everyone | Only me**, where "me" is a name the user types once (the owner types
  "Deets"). Matches the site's gate.
- 4b ✅ **Feed day vs the app's day rule.** The feed already has a `date` (Los Angeles + 5 AM).
  Predicted: **trust the feed's date**; the "Day starts at" row applies only to picks made in
  the app. Re-computing would move old picks between days.
- 4c ✅ **Mirror or copy.** Predicted: **mirror**. Feed rows are read-only in the app;
  Discord stays the source of truth. A post removed from the journal leaves the app at the
  next refresh. No user data is lost, because the app never owned those rows.
- 4d ✅ **A playlist too?** Predicted: **yes, on request**: "Make playlist" on the shelf builds
  a local playlist (all picks, or one month) through the existing store; Apple export stays
  gated. Not automatic.

### A-2. Who has a feed? (owner's question, 2026-09-17)
Almost nobody. Today only the owner (and anyone who runs DeetsOTD) has a `songs.json`. For a
stranger the starting point is zero picks. So:
- **B is the core for everyone.** The app starts the journal on the day the user turns it on.
- **The feed is an import, and it is small**: one fetch, one parse, one table the shelf
  already reads. Its value is mostly the owner's 8 months of history.
- Other starting points a stranger may have, for later (⬜): a CSV/JSON file (a spreadsheet
  they kept; DeetsOTD's own CSV export has the same fields), or an Apple Music playlist they
  keep as a Song of the Day list. The playlist has no per-song dates from Apple, so it
  imports as undated picks or needs the user to set the days.
- Build order (updated 2026-09-17): **one build** — B, the feed (A), Discord, Bluesky, Mastodon.

### B. Mark picks inside the app (the original local diary)
One `song_of_day` table, one pick per journal day, NP star + right-click. §5 keeps the
earlier design, updated. Works for strangers with no setup.
- Risk: for the owner, this is a second journal next to Discord (constraint 2).

### C. Suggest today's pick from listening
From `play_events`: the song with the most `ms_listened` in the current journal day (or the
last 24 hours). Show it as "Most played today" with **Copy link** and **Mark**. Local, zero
calls. Helps both A-style and B-style users.

### D. Hand the pick to Discord
- **D1 — Copy link (safe).** A menu action copies the `music.apple.com` song link. The user
  pastes it in Discord. DeetsOTD resolves it as `direct`. Zero risk, zero calls,
  `copy-link.ts` already does most of it.
- **D2 — Post for the user.** Posting **as** the user needs a user token (a "self-bot"),
  which Discord's terms forbid. Ruled out. The allowed ways are a webhook or the user's own
  bot; see §3G. Both post under a non-user author id, so DeetsOTD must map that id to a
  poster (§3G, "Discord").

### E. From the site into the app
A "Play in DeetsMusic" button on `/sotd/` cards, through a new `deetsmusic://play?song=<id>`
route. Any web page could then start playback on a visitor's PC, so the route would need a
confirm step in the app. The plain `music.apple.com` link already opens Apple's own player.
Low value for the risk; ⬜ later.

### F. The app's data into the journal
The nightly job could read DeetsMusic's plays through the read-only SQL route and add
"minutes listened that day" or "plays since the pick" to `songs.json` for the owner's
picks. This is DeetsOTD + DeetsSolutions work, not app work, and it publishes listening data
on a public page. **Owner wants this (2026-09-17).** It stays opt-in and previewed (§3G rules).

### G. Share the journal from the app (outlets)
A **pick** is one record in the app, from either source: imported from a journal feed (A) or
marked in the app (B). An **outlet** sends a pick (and, if the user allows it, the listening
line) to a place outside the app. Each outlet is its own settings row, **off by default**.

| Outlet | How the app sends | User setup | Stranger fit | Checks before build |
|---|---|---|---|---|
| **Discord webhook** | `POST` the webhook URL with the song link; `username` + `avatar_url` can be set per message | Server settings → Integrations → Webhooks → copy URL | Good: one paste, no bot, no token | Author id = webhook id; DeetsOTD must map it to a poster. The URL is a secret: store it like the Last.fm session key. |
| **Own Discord bot** | Bot token + channel id, REST `POST /channels/{id}/messages` | Developer portal app, bot, invite, token | Poor: many steps | Only needed to **read** a channel; DeetsOTD already does that. For posting, the webhook is simpler. |
| **Bluesky** | AT Protocol `createRecord` of `app.bsky.feed.post` with the link as an external embed | Handle + browser sign-in (OAuth, §8.14) | Good: handle only | Do not upload Apple artwork as the embed thumb (it re-hosts Apple art); let the link stand alone or check Apple's artwork rules first. |
| **Mastodon (Fediverse)** | `POST /api/v1/statuses` on the user's server | Server address + browser sign-in | Good | Threads users can follow it (ActivityPub). Build 1, §8.4c. |
| **RSS / Atom feed** | A feed file of picks | Needs a public URL | Poor: the app has no host | Owner: add `sotd/feed.xml` next to `songs.json` in the nightly job (DeetsOTD work, no app code). Strangers: would need a hosted service (a deploy stop rule). |
| **Apple Music playlist** | The existing gated export of a local "Songs of the Day" playlist | None beyond sign-in | Good | The user makes it public and shares it in Apple Music; the API does not set that flag. |
| **Last.fm** | Already built (LASTFM.md) | Already there | Good | This already shares listening data. A pick outlet adds nothing new here. |

Rules for every outlet (from VALUES.md stop rules: outward-facing, personal data):
- The first post through an outlet shows a preview with the exact text. The user confirms.
- After that, per outlet: **Ask each time** | **Post my picks** (listening line is a separate
  switch, off by default).
- A failed post stays queued, like `play_events.lastfm`. It never retries in a loop.
- `diag.log` each post (outlet, pick day, result), never the webhook URL or password.

---

## 4. Forks

Predicted picks follow VALUES.md (stewardship, stranger parity, no second place to post).

1. ✅ **Which direction first?** (2026-09-17) **C + D1, behind a settings row**, plus **A**
   with a feed in the same shape as `songs.json`, so the existing journal comes in and the
   app builds on it. The suggestion row is **off by default**: people prefer to find what
   they like themselves (owner's words).
2. ✅ **Journal day rule** (2026-09-17). **A settings row: "Day starts at" Midnight | 5 AM**,
   in the system time zone. Many people take 12 AM as the new day; the owner does not.
   Alone-decision, flag for desk test: default **Midnight** (the common reading); the owner
   sets 5 AM once.
3. ✅ **Where picks show** (2026-09-17). **A Home shelf: a song list with the day on each
   row**, and **Rewind** (it is about your habits; History is the reverse queue).
   Alone-decision, flag for desk test: Rewind gets **Picks** as a fifth stat in its stat pill,
   under the same time-window pill.
4. ✅ **The feed** (2026-09-17) — §3A-1, sub-forks 4a–4d as predicted. **Owner's question:**
   most users have no feed, so the feed serves mostly the owner. Answer in §3A-2: build B +
   the webhook first (every user starts there), the feed reader second (small).
5. ⬜ **E (site → app play route).** Predicted: not now.
6. ✅ **D2 as a user token.** Ruled out (Discord terms). Posting goes through §3G outlets.
7. ✅ **F (listening data shared).** Owner wants it (2026-09-17). Opt-in, previewed, per outlet.
8. ✅ **Outlets** (2026-09-17). **Discord webhook**, **Bluesky** and **Mastodon-compatible**
   (the Fediverse, which Threads joins), all in build 1. RSS stays site-side for the owner.
9. ✅ **Marking in the app (B)** — §5 sub-forks, §8 spec.

---

## 5. Option B detail — marking picks in the app (fork 9)

**What it is.** Right-click any song row → "Mark as Song of the Day". The pick goes in the
same `picks` table as feed rows (`source = 'app'`), shows on the Home shelf and in Rewind, and
goes out through each outlet the user turned on (Discord and Bluesky, §8).

**Why it matters for both kinds of user.**
- A stranger with no feed: B is the whole journal.
- The owner: B replaces "open Discord, paste the link". The webhook posts it; DeetsOTD reads
  it that night; the feed brings it back.

### Data
Superseded by §8.1 (`picks` + `pick_posts`).

### Sub-forks
- 9a ✅ **Picks per day** (2026-09-17). **One by default**; a settings row "Picks per day"
  **1 | 2 | No limit** for users who want more (alone-decision on the choices: flag for desk
  test). At the limit, Mark becomes "Replace today's pick". The owner's journal has 6 days
  with two posts: 5 are a daytime post plus a late-night post (10:39 PM–1:29 AM Pacific),
  1 is two posts an hour apart. Feed rows are not limited; they show what the journal has.
- 9b ✅ **When an outlet posts** (2026-09-17; default Ask each time). A per-outlet row, "Post my picks":
  **Ask each time | Right away | At a set time** (time picker, default 8 PM).
  - *At a set time* = set it and reconsider: the pick waits; the user can replace or unmark
    it until then; the shelf row shows "Posts at 8:00 PM". At that time the app posts the
    day's picks (one, or all of them if the limit is higher).
  - **The day rule limits the time.** DeetsOTD dates a post by when Discord got it. A post
    sent after the day ends lands on the next day. So the set time must fall inside the
    journal day, and a missed time (app closed, PC asleep) posts at next start **only if the
    day has not ended**; otherwise the app asks "Post yesterday's pick now? It will count for
    today." No weekly batch, for the same reason.
  - The app must be running (the tray keeps it running). `diag.log` arm / fire / skip.
  - For the owner: the nightly job runs at 9 PM. A set time before 9 PM puts the pick on the
    site the same night.
  - Default: **Ask each time** (outward-facing: the first post never goes out unseen).
- 9c ⬜ **The round trip.** Still valid, but only for a user who has a feed AND posts into
  the channel that makes the feed: today only the owner. It is not needed for B + webhook.
  Build it with A, not before.
- 9d ✅ **Unmark after it posted** asks "Also delete the Discord post?", default yes.
- 9e ✅ **Note:** optional, posted as the message text; the app row keeps it.
- 9f ✅ **Where to mark:** right-click on song rows; Mark on the suggestion row; no new Now
  Playing button in v1. Owner's note: card buttons could become user-configurable (hide the
  Search button, add Mark) — a separate idea, not part of this doc.
- 9g ✅ **What changes in DeetsOTD: nothing** (2026-09-17, owner: leave it untouched). DeetsOTD is the bot + Python scripts that read the
  channel. It needs no change to *read* webhook posts: `linkscan.py` does not skip bot or
  webhook messages. The only effect is on *who* the post belongs to:
  - For a webhook message, Discord sets the author to the webhook. `author` = the name the
    app sends (the app sends the user's name, for example "Deets"). `author_id` = the
    webhook's id, not the user's.
  - **The site keys on the name** (`author === "Deets"` in `home.js` and the `sotd.js` gate;
    `songs.json` has no ids). So the site looks right with no change.
  - **DeetsOTD keys on `author_id`** (the by-user export, the poster count, `journal` grouping).
    There, Deets splits in two: 8 posters become 9.
  - Accepted: DeetsOTD's own by-user exports count the owner twice. The site is right.
    (Rejected: an alias map in DeetsOTD's `config.py`, which would touch the repo.)
  - Friends see the post in Discord with an APP tag next to the name.

### Build checklist (CLAUDE.md › Working style)
Motion through `pop.ts` / `enterRows`; tokens only; every `title` in the ONBOARDING ledger;
toasts in TOASTS.md; settings keys with defaults + agent spec; `diag.log` for each fetch,
post and delete (never the webhook URL: `log::register_secret` it, as Last.fm does);
`app-scroll` on lists; `dataset.frames` on animated parts; `tsc` + `vite build`.
The webhook URL lives in `<app_data>`, like `lastfm-session.json`, never in the renderer.

### Risks
- **Day boundary** — test the "Day starts at" row at 11:59 PM, 12:01 AM, 4:59 AM, 5:01 AM.
- **Id churn** — a library-only id that gains a catalog id must still match (9c).
- **Feed shape drift** — the site repo owns `songs.json`; keep the v1 subset small.

---

## 7. DeetsOTD's future — rewrite or keep? (✅ decided 2026-09-17: keep it, untouched)

DeetsOTD's development is done: it runs every night with no hand work. The question is
whether to rewrite it (Rust, or inside DeetsMusic) now that DeetsMusic will post picks.

**What DeetsOTD does, and where each part would go**

| Part | Size | Needed by DeetsMusic? |
|---|---|---|
| Read a Discord channel (`discord.py`, bot token, Message Content intent) | `linkscan.py`, `scan.py` | Not for B + webhook. Only for "import a friends' channel" (⬜). |
| Resolve Spotify / YouTube links to Apple songs (og tags, oEmbed, validated iTunes search, `review.py`) | `enrich.py` 330 lines, `review.py` | Not for picks made in the app (they already have a catalog id). Only for a channel import. |
| Journal store + day rule | `storage.py` | Replaced by the app's `picks` table + "Day starts at" row. |
| `songs.json`, xlsx, CSV exports | `storage.py` | The app would write its own feed file (§3A-2). |
| Film journal (Letterboxd RSS, TMDB posters) | `letterboxd_*.py` ~890 lines | No. Not music. |
| Nightly job | DeetsSolutions `scripts/nightly-sotd.ps1` | Stays until the site gets picks another way. |

**Decided: keep the Python, untouched.** A rewrite gives no user anything new; it moves
working code. DeetsMusic needs new parts (webhook post, feed reader, picks table), not a port.
The friends' picks still arrive through Discord, so a channel reader stays needed until every
poster uses DeetsMusic. The film journal has no home in a music app.

**Not a port.** The Song of the Day feature in DeetsMusic is new Rust code (picks table,
outlets, feed reader). It covers the user's own picks. It does not translate DeetsOTD's
Discord reader, link matching or exports. The DeetsOTD repo stays as it is. No exception: the
9g alias map was rejected (2026-09-17), so DeetsOTD's by-user exports split the owner in two.

**What to carry into DeetsMusic later (ideas, not ports):**
- ⬜ **Import a Discord channel** with the user's own bot token. It brings a friends' journal
  in. Costs: a many-step setup for a stranger; one Apple search per Spotify/YouTube link
  (DeetsOTD's 99 Spotify + 12 YouTube posts would be ~111 searches, once). Check Discord's
  developer policy on storing other users' messages in a desktop app before building.
- ⬜ **The link-matching rules** from `enrich.py` (trust Spotify's og tags, validate the
  search, a review state for guesses). They also help the browser extension's YouTube match.

**The end state the owner named: DeetsMusic posts to deets.solutions.** That needs a write
endpoint on the site (a Worker route with auth). It is a deploy: stop rule, own design pass.
When it exists, the nightly job reads the owner's picks from there, and DeetsOTD reads only
the friends' Discord posts, or retires if the friends move too.

## 8. Paper design — build 1 (picks + webhook) (2026-09-17)

**Scope of build 1 (owner, 2026-09-17: one build):** the feature switch, marking picks (B),
the outlet layer with **three outlets — Discord webhook, Bluesky (OAuth), Mastodon-compatible
(Fediverse)**, the Home shelf, the Rewind Picks view, the suggestion (C), the settings section,
and **a one-time import of the owner's journal** (§8.13). There is no build 2 or 3.

**The feed reader is dropped (owner, 2026-09-17).** A feed is a personal tool: only the owner
has one. So no feed code ships in the app. The owner's 8 months come in once, by a script
(§8.13), and every other user starts from zero. The round trip (9c) goes with it. §3A, §3A-1
and forks 4a–4d stay as a record only.

**Owner decisions 2026-09-17:** S1, R1, G2, Bluesky from the start, a feature On | Off switch.
Marks: ✅ decided by the owner · ☑ decided alone by VALUES.md, **flag for desk test** ·
🔵 fork for the owner.

### 8.1 Data (Rust, the `library.rs` database)
```sql
CREATE TABLE IF NOT EXISTS picks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,          -- 'app' | 'import' (the owner's journal, §8.13)
    day         TEXT NOT NULL,          -- journal day 'YYYY-MM-DD', computed by the front end
    track_id    TEXT NOT NULL,          -- catalog-first key, as play_events uses
    meta        TEXT NOT NULL,          -- the Track JSON at mark time (title, artist, art)
    note        TEXT,
    marked_at   INTEGER NOT NULL        -- epoch-ms (import: the post's posted_at)
);
CREATE INDEX IF NOT EXISTS idx_picks_day ON picks(day);
CREATE TABLE IF NOT EXISTS pick_posts (
    pick_id     INTEGER NOT NULL,
    outlet      TEXT NOT NULL,          -- 'discord' | 'bluesky' | 'mastodon'
    state       TEXT NOT NULL,          -- 'waiting' | 'sent' | 'failed' | 'skipped'
    due_ts      INTEGER,                -- set-time mode: when to send
    remote_id   TEXT,                   -- Discord message id (?wait=true) | Bluesky at:// URI | Mastodon status id
    error       TEXT,
    PRIMARY KEY (pick_id, outlet)
);
```
- ☑ Posts live in their own table, so a later outlet is a new row, not a migration.
- ☑ `meta` keeps the Track at mark time: a song that leaves the library still renders.

### 8.2 Commands (Rust)
`picks_list(from?, to?)` · `pick_mark(day, track, note?)` · `pick_note(id, note)` ·
`pick_unmark(id, delete_post)` · `pick_post(id)` (the Ask answer, and Post Now) ·
`outlet_connect(outlet, input)` · `outlet_disconnect(outlet)` · `outlet_set_on(outlet, on)` ·
`outlet_status()`.
- ☑ **One Rust trait per outlet** (`sotd/outlet.rs`): `check()`, `post(pick) -> remote_id`,
  `delete(remote_id)`, `status()`. Discord, Bluesky and Mastodon implement it. The outbox,
  the modes, the retries and the toasts know only the trait.
- ☑ **The outbox is in Rust**, like `lastfm.rs`: the send, the retry at start, and the set-time
  timer (a tokio sleep to the next `due_ts`, re-armed on change). The front end never holds
  the webhook URL.
- ☑ **Secrets** (the webhook URL; the Bluesky and Mastodon tokens; the DPoP key) live in
  `<app_data>/sotd-outlets.json`, encrypted with DPAPI, and go through `log::register_secret`.
  The renderer never receives them. Full rules: §8.15.
- ☑ **Rust checks the per-day limit** in `pick_mark`, so the agent path cannot skip it.

### 8.3 The message (Discord)
- ☑ The text is the song link from `copy-link.ts` (`music.apple.com/…/song/<id>`), then the
  note on a second line if there is one. Discord draws its own preview of the link. We upload
  no artwork.
- DeetsOTD's `_apple_track_id` already reads the `/song/<id>` form, so the post resolves as
  `direct` with no DeetsOTD change (checked in `enrich.py`).
- ☑ `username` = the "Post as" field; empty = the webhook's own name. No avatar override.

### 8.4 Settings › Song of the Day (a new section, after Rewind)
| Row | Kind | Options (default first) | Stored in |
|---|---|---|---|
| **Song of the Day** | choice | **On** ☑ · Off ✅ (owner: the first row) | `sotd` |
| Suggest today's pick | toggle | **Off** ✅ | `sotdSuggest` |
| Day starts at | choice | **Midnight** ☑ · 5 AM ✅ | `sotdDayStart` (Rust reads it for missed times) |
| Picks per day | choice | **1** ✅ · 2 · No limit ☑ | Rust settings (Rust checks it) |
| Post my picks | choice | **Ask each time** ✅ · Right away · At a set time | Rust settings |
| Post at | the sleep timer's − time + stepper (`sleep.ts` `shiftTime`) | **8:00 PM** ☑ | Rust settings; shows only for At a set time |
| **Discord** (group head) | split: Set up · toggle | off, not set up | `<app_data>` + Rust settings |
| ↳ Post as | html field | empty = the webhook's own name | Rust settings |
| **Bluesky** (group head) | split: Connect · toggle | off, not connected | `<app_data>` + Rust settings |
| **Mastodon** (group head) | split: Connect · toggle | off, not connected | `<app_data>` + Rust settings |

Status lines under the rows, one per outlet: "Discord: posts to #song-of-the-day in <server>"
· "Bluesky: posts as @handle" · "… not set up" · "… last post failed: <reason>" ·
"Discord: the webhook no longer exists" · "Bluesky: connect again".

**The switch (owner, 2026-09-17).** The first row turns the whole feature on or off.
- ☑ Default **On**: with no outlet set up, the feature is local only (a menu item and a shelf
  once you mark), so On posts nothing. Flag for desk test.
- **Off** hides: the rows under it, the three menu items, the Home shelf, the suggestion,
  Rewind's Picks choice (Rewind falls back to Songs if Picks was chosen). The outbox stops
  its timer.
- **Off keeps**: every pick, every outlet connection, every `waiting` post (it stays waiting
  and is handled by the missed-time rule when On comes back). No data is lost.
- `diag.log` `sotd:on` / `sotd:off`.

- ☑ **One post mode and one time for all outlets**, and one On toggle per outlet. The Ask
  toast names every outlet that is on: `Post “Song” to Discord and Bluesky?`.
- ☑ Every clock time falls inside one journal day under both day rules, so "Post at" needs no
  error state. At 5 AM, a 2:00 AM time belongs to the day before it.
- ☑ Agent specs: every row except the secrets. `sotd` and each outlet toggle are **off only**
  for agents (AGENT.md §settings: an agent can take power away, never give it).

### 8.4a Discord intake — what the user does
What we need from the user: **one webhook URL for the channel.** Nothing else — no bot, no
token, no developer portal, no sign-in.

1. Settings › Song of the Day › Discord › **Set up**. A field opens in the row with two lines
   of steps under it (an html row, `enterRows`):
   *"In Discord: the channel's gear › Integrations › Webhooks › New Webhook › Copy Webhook URL.
   You need the Manage Webhooks permission. If you do not have it, ask a server admin to
   send you the URL."*
2. The user pastes. The app runs **Check** (`GET` the webhook: Discord returns its name,
   channel and server) and **posts nothing**.
   - OK → the field closes, the status line reads "Discord: posts to #channel in Server", the
     toggle turns on, and "Post as" appears with the webhook's name as its placeholder.
   - Not a Discord webhook URL → the field stays, with "This is not a Discord webhook link".
   - 401/404 → "Discord does not know this webhook. Copy it again".
3. The row's split now reads **Change · Remove** + the toggle.

What the user must know (the hint on the group row, and ONBOARDING ledger):
- Anyone with the URL can post in that channel. Remove it in Discord (Webhooks › Delete) to
  revoke; the app then shows "the webhook no longer exists".
- Posts show under the "Post as" name with Discord's **APP** tag.
- DeetsOTD records the webhook's id as the poster id (9g); the site shows the name.

### 8.4b Bluesky intake — what the user does (OAuth, B-auth-2)
What we need from the user: **their handle** (for example `deets.bsky.social`). No password.

1. Settings › Song of the Day › Bluesky › **Connect**. A field: "Your Bluesky handle".
2. The app resolves the handle to the account's server, starts the sign-in (PAR + PKCE +
   DPoP, §8.14) and opens Bluesky's sign-in page in the browser. The user signs in and
   presses **Allow**.
3. Bluesky sends the browser to the redirect page on deets.solutions, which hands the code to
   the app (§8.14). The app finishes the sign-in and verifies the account.
4. Status: "Bluesky: posts as @handle". The split reads **Disconnect** + the toggle.
- **The 2-week limit:** a desktop client's session ends 2 weeks after sign-in, however often
  it posts. The status line reads "Bluesky: sign in again" 2 days before, and a waiting post
  stays waiting (never lost) until the user signs in.

**The Bluesky post:**
- Text: `“Song” — Artist` + the note, trimmed to Bluesky's 300-character limit, then the link.
- ☑ The link needs a **facet** (byte range + URI), or it is not clickable. And Bluesky does
  not draw link cards itself: the client sends an `app.bsky.embed.external` with title and
  description. We send title `Song — Artist`, description the album, **no thumbnail** (a thumb
  is an uploaded blob, which re-hosts Apple's artwork: ⬜ check Apple's artwork rules first).
- Unmark / Undo → `com.atproto.repo.deleteRecord` with the post's rkey.
- Check before build: the current `createRecord` shape, rate limits, and whether a granular
  scope for posts exists yet (use it if so; else `transition:generic`).

### 8.4c Mastodon (Fediverse) intake — what the user does
What we need from the user: **the address of their server** (for example `mastodon.social`).
1. Settings › Song of the Day › Mastodon › **Connect**. A field: "Your server, for example
   mastodon.social".
2. The app registers itself on that server (`POST /api/v1/apps`; no approval, no key from us),
   opens the server's sign-in page in the browser, and receives the code at
   `deetsmusic://mastodon` (dev app: the loopback bridge, debug builds only) ☑. Scope:
   `write:statuses` only. Rules: §8.15.
3. Status: "Mastodon: posts as @user@server". The split reads **Disconnect** + the toggle.
- Post = `POST /api/v1/statuses` (text: `“Song” — Artist`, the note, the link; 500 characters);
  the server draws the link card. Delete = `DELETE /api/v1/statuses/:id`.
- **Works with** servers that speak the Mastodon client API: Mastodon, GoToSocial,
  Pleroma/Akkoma and most forks. **Not** Misskey (own API) and **not Threads** (Meta's own
  API): a Threads user follows the Mastodon account instead (§8.12).
- A server that refuses app registration → "This server does not allow new apps".

### 8.5 Marking
- `trackMenu` (shared by every card) gains one item for one song with a catalog id:
  **Mark as Song of the Day** · at the limit: **Replace Today's Pick** · already today's
  pick: **Unmark Song of the Day**. ☑ A song with no catalog id gets no item (nothing to post).
- ☑ **The note** is a menu field (the playlist Rename field, `MenuItem.input`) on the shelf
  tile and the Rewind row: "Add a note". Mark itself stays one click.
- **After Mark, by "Post my picks":**
  - *Ask each time* → a sticky toast naming every outlet that is on:
    `Post “Song” to Discord and Bluesky?` **[Post] [Not now]**. Not now = `skipped`; the tile
    menu then offers **Post Now**.
  - *Right away* → sends; toast `Posted to #song-of-the-day` **[Undo]** (Undo deletes the
    message and unmarks).
  - *At a set time* → toast `Posts at 8:00 PM` **[Undo]**.
  - No outlet on → toast `Today's Song of the Day` **[Undo]**.
- **Replace** at the limit: the old pick goes. If it was `sent`, a toast asks
  `Also delete the posts?` **[Delete] [Keep]** (9d; Delete is the first button; every outlet
  where it was `sent`).
- **Missed set time** (the app was closed): at start, if the pick's day is still today, it
  sends. If the day ended: sticky toast `Post yesterday's pick now? It will count for today.`
  **[Post] [Skip]**.
- **Failure:** `failed` + a warn toast with Discord's reason; one retry at the next start,
  never a loop.

### 8.6 Home shelf — "Songs of the Day"
- Built in `home.ts` like the other shelves, placed **first**. Left out when there are no
  picks and no suggestion (Home's empty-shelf rule).
- ✅ **S1 (owner, 2026-09-17): tiles**, the day as the sub line. Home keeps its tile rule.
- Newest first, up to 12 (`SHELF`). The day on each item: "Today" · "Yesterday" ·
  "Tue, Sep 16". A waiting post adds "· 8:00 PM"; a skipped or failed one "· Not posted".
- Click = play the song (context `picks`). Right-click = `trackMenu` + **Add a note** +
  **Post Now** (when not sent) + **Unmark**. No **Hide**: Unmark is the way off.
- **The suggestion (C)**, when its row is on and today has room: one item before the picks,
  "Most played today", with a dashed rim (`--empty-slot-rim-style`, the empty-playlist drop slot's token).
  Source: `play_events` inside the current journal day, most `ms_listened`, not already
  picked. ☑ Under 10 minutes listened today → no suggestion. Right-click puts **Mark** first.

### 8.7 Rewind › Picks
- `STAT_LABELS` gains `picks: "Picks"`. The window pill filters by `day`.
- ✅ **R1 (owner, 2026-09-17): newest first, the day as meta.** Owner's reason: Rewind is
  about habits; Song of the Day is about revisiting the past as a timeline ("how did a week
  already fly by!").
- ☑ The board keeps Rewind's shape: the newest pick in the window is the hero; the rest are
  rows. The label over the rows is **"Earlier"**, not "Runners-up" (there is no ranking).
  Meta: "Tue, Sep 16", plus " · note" when there is a note (one line, cut with an ellipsis).
- **Make playlist** on Picks = the window's picks, oldest first, a local playlist
  "Songs of the Day · <window>" in the Replay folder (4d; zero Apple calls).
- ☑ The Rewind gate (50 plays) stays. Picks alone do not unhide Rewind.

### 8.8 Agent
- ☑ Every settings row except the webhook URL gets a spec.
- ✅ **G2 (owner, 2026-09-17): an agent can mark, and posts follow the post mode.**
- The owner asked whether a settings row already limits agent writes. Checked in AGENT.md §5:
  there is **no general write limit**. There are three parts, and a mark uses them like the
  other writes do:
  1. **Agent control** (on/off) gates every agent route.
  2. **The feature's own setting** gates the write: Song of the Day Off → `403` with the
     Settings path (like Add to Library → `libraryAdd`).
  3. **A "done before" flag** (`deets.notice.sotdAgentMark`): the first agent mark asks in the
     window (**Allow** / **Not now**, reply `pending: "user"`); Allow sets the flag.
  ("Agent changes settings" Allow/Ask/Off governs settings changes only, not marks.)
- After that, an agent mark follows "Post my picks" exactly like a hand mark. Under Right away
  it posts without a question: the user allowed it once, and the mode is the user's choice.
- An info toast: `An agent marked “Song” as today's Song of the Day.` (Show notices ›
  Everything, AGENT.md §5 3A).
- MCP: `picks` tool — `list` (window), `mark` (id, note?), `unmark` (id). CLI: `deetsmusic
  pick …`. AGENT.md gets the rows.

### 8.9 Log lines, toasts, hints
- `diag.log`: `sotd:mark` (day, id) · `sotd:unmark` · `sotd:post:arm` (due) · `sotd:post:fire` ·
  `sotd:post:sent` (message id) · `sotd:post:fail` (status, reason) · `sotd:post:skip` ·
  `sotd:webhook:check` (ok). Never the URL; titles only in quotes (the toast log rule).
- TOASTS.md §5: the toasts in 8.5.
- ONBOARDING.md: every row hint in 8.4, the menu items, the shelf item shape (SHAPES table).
  Settings › Tips: "Right-click a song › Mark as Song of the Day".

### 8.10 Forks — all decided 2026-09-17
- **S1** tiles on Home · **R1** newest-first timeline in Rewind · **G2** agent marks follow the
  post mode behind the first-time Allow · **all three outlets in build 1** · **no feed reader;
  a one-time import of the owner's journal** · **B-auth-2 (OAuth)** · **Song of the Day On |
  Off** as the first row. No open fork blocks build 1. One deploy needs the owner's go at
  build time: the two Bluesky files on deets.solutions (§8.14).

### 8.11 Desk test (after build 1)
1. Right-click a song › Mark. Home shows the shelf with "Today". Right-click another song:
   the item reads Replace Today's Pick.
2. Day starts at 5 AM, then mark at 12:30 AM: the item shows the previous day's date.
3. Discord › Set up, paste a webhook: the status line names the channel. Nothing posts.
   Paste a random link: the error line shows. Bluesky: see 7c.
4. Ask each time, both outlets on: Mark → toast names both → Post. Discord shows the link
   preview; Bluesky shows the post with a clickable link and a card with no image.
   Unmark → Delete: both posts go.
5. At a set time 2 minutes ahead: toast "Posts at …"; the message arrives on time. Close the
   app across a set time in the same day: it posts at the next start.
6. Rewind › Picks, then Make playlist.
7. The log has the `sotd:*` lines and no webhook URL or password. A bug report preview
   carries neither.
7a. Mastodon › Connect `mastodon.social`: the browser signs in, the status shows the account.
   Mark with all three outlets on: all three posts arrive; Unmark → Delete removes all three.
7b. Run the import (§8.13) on the dev app's data: Home shows the past picks with their days;
   Rewind › Picks › This Year shows them from Jan 21. Run it again: nothing doubles.
7c. Bluesky › Connect: the browser opens Bluesky, Allow returns to the app through the
   deets.solutions page, and the status shows the handle (dev app: the localhost client).
8. Song of the Day › Off: the menu items, the shelf and Rewind's Picks go; a waiting post
   stays waiting. On again: all come back, and the waiting post follows the missed-time rule.
9. An agent `mark` the first time: the window asks. Allow; the next mark needs no question.
   Song of the Day Off → the agent gets `403`.

### 8.12 Bluesky, Threads and the Fediverse (owner's question, 2026-09-17)
- **Threads federates through ActivityPub**, the protocol of **the Fediverse** (Mastodon is
  its best-known app). A Threads user can follow a Fediverse account, and the reverse.
- **Bluesky is a different network**: AT Protocol, not ActivityPub. Bluesky and Threads do not
  federate with each other directly. A bridge (Bridgy Fed) connects the two, per account,
  when that account opts in.
- So "a post Threads users can see" means a **Mastodon (Fediverse) outlet**, not Bluesky.
- ✅ **Mastodon outlet in build 1** (§8.4c).
- **Both are open protocols.** ActivityPub is a W3C Recommendation (2018). AT Protocol is an
  open specification from Bluesky PBC with open-source reference code. Neither needs an API
  key, a partner agreement or an app review from us: the user's own account and server are
  enough.
- **The catch with ActivityPub:** its client-to-server part is almost never implemented.
  Apps post through **the Mastodon client API**, which most Fediverse servers copy. So the
  outlet is "Mastodon-compatible", not "any ActivityPub server".
- **Being our own Fediverse account** (a DeetsMusic actor on deets.solutions that users need
  no account for) would need a server that stores and delivers posts: a deploy and a running
  cost. Not planned.
- ⬜ **Posting to Threads** (owner asked 2026-09-17). Possible through Meta's **Threads API**,
  not through ActivityPub. What it needs (read from developers.facebook.com/docs/threads,
  2026-09-17; the ⚠ lines are not yet checked):
  - **From us:** a Meta developer app with the Threads use case; the permissions
    `threads_basic` and `threads_content_publish` (and ⚠ a delete permission for Unmark);
    **App Review** for each permission and a published app before any non-tester can connect
    (quote: "each permission must first be approved through the App Review process, and your
    app must be published"); ⚠ likely business verification, a privacy policy URL and a data
    deletion URL for the review.
  - **A server:** the token exchange uses the Meta app secret, which must not ship in the
    desktop app. So a Worker route (like the Apple token mint) swaps the code for a token and
    refreshes it (short-lived 1 hour, long-lived 60 days, refreshable). A deploy.
  - **The post:** two calls — create a container `POST /{user-id}/threads` with
    `media_type=TEXT`, `text` (500 characters) and `link_attachment` (the song link, drawn as a
    preview), then `POST /{user-id}/threads_publish`. Limit: 250 posts a day per profile.
  - **From the user:** a Threads account and a browser sign-in. Nothing else.
  - **Cost to us:** Meta's review (weeks, and it can refuse), a Worker, and ongoing Meta
    Platform Terms compliance. **Parked (owner, 2026-09-17).**

### 8.13 The owner's journal — a one-time import (owner, 2026-09-17)
The feed is personal, so the owner's history comes in once, and no import code ships.
- ☑ **`scripts/import-sotd-journal.mjs`** (not bundled; Node 24's built-in `node:sqlite`, no new
  dependency). Arguments: `--from <path to songs.json>` (default
  `../DeetsSolutions/sotd/songs.json`), `--app installed|dev` (`com.deetsmusic.app` or
  `com.deetsmusic.dev`), `--author Deets` (default), `--dry-run`.
- ☑ **Source: `songs.json`, not `storage.db`.** It is already the display shape, it has the
  journal day in `date` (Los Angeles + 5 AM), and it carries no private Discord ids. Both repos
  stay untouched: the script only reads.
- **What it writes:** one `picks` row per post by `--author` with a catalog id from `?i=`
  (Deets: 196 posts; the 3 without an Apple link are listed and skipped). `source = 'import'`,
  `day = date`, `track_id = <catalog id>`, `meta` = a Track built from the row (title, artist,
  album, duration, artwork, catalog id; the build session copies the Track shape from
  `model.rs`), `marked_at = posted_at`. No `pick_posts` rows: imported picks were already
  posted by hand.
- **Rules:** the per-day limit does not apply (the 6 two-pick days come in as they are);
  **idempotent** — a row with the same `day` + `track_id` is skipped, so a re-run after new
  hand posts in Discord adds only the new ones; the app must be closed (the script checks the
  WAL lock and stops with a message); it prints "added N, skipped M, no link K".
- **Stranger parity:** no app code knows about the import. The Home shelf and Rewind show
  `import` rows like `app` rows. Unmark on an imported pick removes it from the app only
  (nothing was posted from the app); the menu says "Remove from Songs of the Day".
- `picks` must exist before the script runs: run the app once after build 1.





### 8.14 Bluesky sign-in — OAuth (✅ B-auth-2, owner 2026-09-17)
Read from the AT Protocol OAuth spec (atproto.com/specs/oauth, 2026-09-17).

**Why OAuth:** the user types only a handle (no app password to make and paste), and the spec
plans to "deprecate and eventually remove" the scopes that app passwords use. **Costs:** the
work below, a 2-week session for desktop clients (access tokens under 30 minutes), and two
static files on deets.solutions.

**What the app does:**
1. Resolve the handle to a DID, the DID document to the PDS, the PDS to its authorization
   server; verify the handle both ways; after sign-in, verify `sub` and `issuer`.
2. **PAR** (pushed authorization request) for every sign-in.
3. **PKCE** S256, new each time.
4. **DPoP** on every request: an ES256 key pair in `<app_data>`, a signed proof JWT per request
   with a unique `jti`, and the server's **DPoP nonce** (rotates at most every 5 minutes: retry
   once on a nonce error).
5. ✅ **Hand-rolled, no OAuth library** (owner, 2026-09-17). See "Hand-rolled OAuth" below.

**The redirect — what the spec allows a native client** (verbatim rules): a custom scheme that
"must match the `client_id` hostname in reverse-domain order" (for us `solutions.deets:`), or
"an HTTPS URL … the URL origin must be the same as the `client_id`". A loopback address is
allowed only for the development `http://localhost` client.
- ☑ **Release: an HTTPS redirect page on deets.solutions** that forwards the query to the app's
  own scheme: `/auth/bluesky/` → `deetsmusic://bluesky?code=…&state=…&iss=…`. It reuses the
  deep-link path the app already has (Last.fm, Apple). No new URL scheme to register, and no
  MSIX registry trap. The page carries no secret: the code is useless without the app's PKCE
  verifier and DPoP key.
- ☑ **Dev app: the `http://localhost` development client** (no metadata file; redirect to the
  loopback bridge). The dev app then never needs the site, and never steals the installed
  app's links (`deetsmusic-dev` vs `deetsmusic`). Its short dev-client limits are fine for a
  desk test.

**Hand-rolled OAuth (why, and what it takes)**
- **atrium** is the community Rust library set for AT Protocol (github.com/atrium-rs/atrium):
  `atrium-api` (the generated types for every Bluesky record and call, 0.25.8), `atrium-identity`
  (handle and DID lookup, 0.1.9) and `atrium-oauth` (the OAuth client, 0.1.7, ~27k downloads;
  all three last released 2026-03-26, crates.io checked 2026-09-17). It is pre-1.0, it brings
  its own HTTP and storage traits, and `atrium-api` is a large generated crate. We need two
  record calls (create and delete a post) and one sign-in.
- **No new crate is needed.** The app already has every part:
  - ES256 JWT signing: `jsonwebtoken` 9 (the Apple developer token, `apple.rs`), whose
    `Header` carries the `jwk` a DPoP proof needs.
  - A P-256 key pair: `ring` 0.17 (already in `Cargo.lock` through rustls) —
    `EcdsaKeyPair::generate_pkcs8`; the public key's 65 bytes give the JWK `x` and `y`.
  - SHA-256 for PKCE and the DPoP `ath` claim: `sha2` 0.10 (in the tree).
  - `base64` (URL-safe, no padding), `getrandom`, `reqwest`, `url`, `serde_json`, `chrono`.
  - Making `ring` and `sha2` direct dependencies at their locked versions adds no download.
- **`src-tauri/src/sotd/bluesky_auth.rs`, about 700 lines with tests**, in these parts:
  1. **Identity** (~150): handle → DID by `https://<handle>/.well-known/atproto-did`, then by DNS
     TXT `_atproto.<handle>` through DNS-over-HTTPS (☑ Cloudflare's JSON endpoint; no DNS
     crate); DID → document (`plc.directory` for `did:plc`, `/.well-known/did.json` for
     `did:web`); the document's PDS and its handle (the both-ways check).
  2. **Discovery** (~60): PDS `/.well-known/oauth-protected-resource` → authorization server →
     its `/.well-known/oauth-authorization-server` metadata; check `issuer`.
  3. **DPoP** (~120): the key pair in `<app_data>`; a proof per request (`htm`, `htu`, `iat`,
     `jti`, `nonce`, and `ath` when a token is sent); one retry on `use_dpop_nonce`, keeping
     the newest nonce per server.
  4. **Sign-in** (~150): PKCE verifier + S256 challenge + `state`; PAR; open the browser;
     take the redirect (installed: `deetsmusic://bluesky`; dev: the loopback bridge); match
     `state` and `iss`; swap the code for tokens; check `sub` equals the DID.
  5. **Session** (~100): store tokens, refresh before expiry, "sign in again" when the
     2-week session ends, sign out (revoke).
  6. **Calls** (~60): `createRecord` and `deleteRecord` with the access token + DPoP.
- **Tests** (`cargo test --lib bluesky_auth`): PKCE against the RFC 7636 appendix B example;
  a DPoP proof verifies with its own JWK and carries the right claims; the nonce retry runs
  once, never twice; the both-ways handle check refuses a DID whose document names another
  handle; a redirect with a wrong `state` or `iss` is refused; secrets never reach a log line
  (`log::register_secret` on tokens).
- **Risk:** this is security code written by us. It stays small by doing only what the spec
  requires for one public client, and every rule above has a test.

**The client metadata file** — `https://deets.solutions/deetsmusic/bluesky-client.json`:
```json
{
  "client_id": "https://deets.solutions/deetsmusic/bluesky-client.json",
  "application_type": "native",
  "client_name": "DeetsMusic",
  "client_uri": "https://deets.solutions/deetsmusic/",
  "logo_uri": "https://deets.solutions/deetsmusic/<the app icon>.png",
  "policy_uri": "https://deets.solutions/privacy/",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "atproto transition:generic",
  "redirect_uris": ["https://deets.solutions/auth/bluesky/"],
  "token_endpoint_auth_method": "none",
  "dpop_bound_access_tokens": true
}
```
- Required by the spec: `client_id` (must equal the file's own URL exactly), `grant_types`
  (with `authorization_code`), `scope` (with `atproto`), `response_types` (with `code`),
  `redirect_uris`, `dpop_bound_access_tokens: true`. The rest is shown on Bluesky's Allow page
  (name, logo, links). No keys: a public client has no `jwks`.
- `scope`: use a narrower post-only scope if Bluesky has one at build time.
- The privacy page gains a line: DeetsMusic posts to Bluesky only what the user marks.

**Does Cloudflare Pages work?** Yes, checked 2026-09-17:
- The spec needs "HTTP status … 200 (not another 2xx or a redirect)" and `Content-Type:
  application/json`. Pages serves `/sotd/songs.json` with `200` and `Content-Type:
  application/json` today, with no redirect. A `.json` file needs no `_headers` rule (the site
  notes `_headers` does not apply as of 2026-09-15).
- Pages caches assets for 4 hours (`max-age=14400`). Bluesky's servers fetch the file
  server-side and may cache it too, so a change to the file takes hours to be seen: get it
  right before the first publish.
- `/auth/bluesky/index.html`: a static page with a few lines of script that reads
  `location.search` and sets `location.href = "deetsmusic://bluesky" + location.search`, plus
  a "Return to DeetsMusic" link for browsers that block the jump (the `auth/done.html` idea).
- **Stop rule:** publishing these two files is a site deploy. The owner says go at build time.

### 8.15 Security checklist (owner, 2026-09-17: "as long as security is nailed down")
Build 1 is not done until every line here holds and has its test or desk-test step.

**What an attacker would want:** the Discord webhook URL (post anything into the channel),
the Bluesky or Mastodon tokens and the DPoP key (post as the user), or a way to make the app
post without the user.

**Secrets at rest**
- ☑ All outlet secrets (webhook URL, Bluesky tokens, Bluesky DPoP private key, Mastodon client
  secret and token) live in one file, `<app_data>/sotd-outlets.json`, **encrypted with Windows
  DPAPI** (`CryptProtectData`, current-user scope). It adds the `Win32_Security_Cryptography`
  feature to the `windows` crate the app already uses; no new crate. A copied file is useless
  on another account or PC. (Last.fm's session file is plain today: note it, do not change it
  in this build.)
- Disconnect / Remove deletes that outlet's entries and, where the service allows, revokes
  first (Bluesky revoke, Mastodon `POST /oauth/revoke`). Song of the Day Off keeps them (§8.4).
- A file that fails to decrypt = "not connected", one `diag.warn`, never a crash, never a
  retry loop.

**Secrets in motion**
- Only Rust holds them. No command returns a secret to the renderer; `outlet_status()` returns
  names and states only (channel name, handle, server).
- Every secret goes through `log::register_secret` when it is read or received, so the log file
  and bug reports mask it. Test: a log line with each secret prints masked.
- The agent bridge never reads or sets a secret (no spec, no route). Test: the settings spec
  list has no secret key.
- HTTPS only, through `reqwest` with rustls. No plain-HTTP fallback anywhere (the dev loopback
  redirect is the one local exception, dev build only).

**Input checks (what a pasted value may be)**
- **Webhook URL:** scheme `https`, host exactly `discord.com` or `discordapp.com` (also `canary.`
  and `ptb.`), path `/api/webhooks/<digits>/<token>`. Anything else is refused before any
  request. The app never sends a request to a host the user pasted for Discord.
- **Mastodon server:** a bare host name; the app builds `https://<host>`. Refuse IP addresses,
  `localhost`, and names with a port or path. Test each.
- **Bluesky handle:** the AT Protocol handle syntax; a DID document's service endpoint must be
  `https`.
- Replies from every service are parsed with size limits (reqwest body cap, for example 1 MB);
  a bad reply is an error, never a panic.

**Bluesky OAuth (§8.14)**
- PKCE S256, a new verifier per sign-in; `state` random (32 bytes), single use, expires after
  10 minutes; one sign-in in flight at a time (a second one cancels the first).
- The redirect is refused unless `state` matches the pending sign-in AND `iss` equals the
  authorization server we started with. Then the token reply's `sub` must equal the DID we
  resolved. Tests for all three.
- The handle is checked both ways (DID document names the handle).
- DPoP: a new `jti` per proof; `htu` without query or fragment; `ath` on every resource call;
  the nonce retry at most once. The private key never leaves `<app_data>` and is not exported
  through any command.
- Tokens refresh through Rust only; a refresh failure ends the session ("sign in again") and
  keeps waiting posts.

**The redirect page on deets.solutions (`/auth/bluesky/`)**
- Static, no third-party script, no analytics, no fonts from another host.
- `<meta name="referrer" content="no-referrer">` (the site's `_headers` does not apply).
- It forwards only `code`, `state`, `iss` (and `error` fields) to `deetsmusic://bluesky`, then
  clears the address bar (`history.replaceState`), so the code does not stay in browser history
  longer than needed.
- The code alone is useless: it needs the app's PKCE verifier and DPoP key.

**Mastodon OAuth**
- The same `state` rules; scope `write:statuses` only (no read, no follow); PKCE S256 when the
  server announces it.
- The installed app takes the code through `deetsmusic://mastodon`; the dev app through the
  loopback bridge. The bridge's OAuth route exists only in debug builds, accepts only
  `GET /oauth/<outlet>` with a matching pending `state`, and closes after one use.

**Posting only when the user means it**
- A post goes out only from: the user's Post on the Ask toast; Right away / At a set time after
  a mark by the user; an agent mark after the first-time Allow (G2). Nothing else can create a
  `pick_posts` row. Test: no command other than `pick_mark` and `pick_post` writes one.
- The imported journal writes no `pick_posts` rows (§8.13).
- Deleting: only the app's own posts (by the stored `remote_id`).

**Deep links**
- `deetsmusic://bluesky` and `deetsmusic://mastodon` do nothing unless a sign-in for that outlet
  is pending in this process (the Apple hosted sign-in rule, `apple.rs`). A link from any web
  page without a pending sign-in is ignored and logged once.

**Desk-test additions**
- Open `sotd-outlets.json` in a text editor: no readable URL or token.
- Paste `https://example.com/api/webhooks/1/x`: refused with no request (check the log).
- Open `deetsmusic://bluesky?code=x&state=y` from a browser with no sign-in pending: nothing
  happens; one log line.
- Bug report preview after connecting all three: no secret appears.

## 9. Cross-links
[DEETS-REWIND.md](../DEETS-REWIND.md) (plays) · [HOME.md](../HOME.md) (shelves) ·
[PLAYLISTS.md](../PLAYLISTS.md) · [PLAYLIST-WEB.md](../PLAYLIST-WEB.md) §10 (temporary
playlists) · [LOCAL-DATA.md](../LOCAL-DATA.md) · [EXTENSION.md](../EXTENSION.md) (why web
pages cannot reach the bridge) · [STATIONS.md](../STATIONS.md) (picks as a curated signal) ·
DeetsSolutions `docs/architecture.md` §SOTD, `docs/bluesky.md`.
