---
status: idea
desk_test: none
sources: [src/artist-view.ts, docs/ops/checks/mb-support-probe.mjs, src-tauri/src/apple.rs, docs/ideas/DeetsRecommends.md, docs/integrations/ROOMS.md]
updated: 2026-10-13
---
# Support an artist — a link to where the money reaches them

> **An idea, opened 2026-10-12** from the owner's ask: "tie a Kickstarter campaign to artists
> as a way to donate?" Kickstarter was weighed and set aside (§2); the idea became **one
> "Support" link on the artist view** to the artist's crowdfunding page, Bandcamp page and
> official site (his call, §8.1). Nothing is built. He designs the UI himself (§6). A probe of
> his library decides the real numbers first (§5). Do not tell a user the app does this.

## 0. Terms

- **The artist view:** the card the app opens on an artist name: the round hero, the shelves
  (ARTIST-VIEW.md).
- **Crowdfunding page:** a page where a listener gives money to the artist directly:
  Kickstarter, Patreon, IndieGoGo, Ko-fi, Buy Me a Coffee. Kickstarter is one project with a goal
  and a deadline; Patreon and Ko-fi run with no end.
- **Bandcamp:** a store where the listener buys the record from the artist. Bandcamp keeps
  10–15 % of a sale; the artist gets the rest. Most independent acts have a page.
- **MusicBrainz (MB):** the open music database (CC0 data, a free API). An artist record there
  carries **URL relationships**: typed links out, among them the artist's official site,
  Bandcamp, Patreon, crowdfunding and purchase pages, and the artist's Apple Music page
  (DeetsRecommends.md §3.4).
- **MBID:** MusicBrainz's own ID for an artist. It is not an Apple artist ID.

## 1. What the user sees (the shape, not the UI)

One link on the artist view, named **Support**, that opens in the browser the page where the
money reaches the artist. When the artist has more than one, a small choice: the crowdfunding
page, then Bandcamp, then the official site, in that order. When the artist has none, nothing
shows. The app never takes a payment and never earns from the link (§4 c).

The UI is his, designed 2026-10-13 after the probe (§6). This doc holds the mechanics, the
source, the terms and the forks.

## 2. Why not Kickstarter itself

- A Kickstarter campaign is one project, started by the artist, open for weeks. Most artists have
  none running at any given time, so a Kickstarter button would be empty almost always.
- Kickstarter closed its public API years ago. "Does this artist have a campaign running" has no
  lawful lookup; scraping is against their terms.
- What his ask is really after, a way to give money to the artist from the app, is reachable:
  a link to the artist's page where giving money works today. A running Kickstarter is one of
  the pages MusicBrainz's `crowdfunding` relationship can point at, so it is covered when it
  exists, and the link does not go dark when it ends.

## 3. The source: MusicBrainz URL relationships

Apple's API gives no outside links for an artist. MusicBrainz does, typed. What the artist record
holds (the type names as MB uses them, to be confirmed by the probe, §5):

| MB relationship type | What it points at | Use |
|---|---|---|
| `crowdfunding` | Kickstarter, IndieGoGo, Ko-fi, Buy Me a Coffee… (none in his library, §5a) | Support, first |
| `patronage` | the Patreon page (the probe found this name, not `patreon`, §5a) | Support, first |
| `bandcamp` | the Bandcamp artist page | Support, second |
| `official homepage` | the artist's own site | Support, third |
| `purchase for download` / `purchase for mail-order` | a store page | not shown (fork §8.3) |
| `streaming` / `free streaming` with `music.apple.com` | **the Apple Music artist page** | the match, §3.1 |

### 3.1 Matching an Apple artist to an MB artist

Two paths. The probe measures how often each one lands.

1. **By the Apple URL (preferred).** MB stores many artists' Apple Music page as a URL
   relationship. The URL endpoint looks it up directly:
   `GET https://musicbrainz.org/ws/2/url?resource=https://music.apple.com/us/artist/<slug>/<id>&inc=artist-rels&fmt=json`.
   One call, no name matching, no wrong-artist risk. The unknowns the probe answers: the
   storefront in the stored URL (`us`, `gb`, none) and whether the slug must match, since MB
   stores the URL as an editor pasted it. If MB normalizes Apple URLs to one form, this is the
   whole match.
2. **By name plus one album (fallback).** `GET /ws/2/artist?query=artist:"<name>"&fmt=json`,
   take the top hit only when its score is high and one of its release groups matches an album
   title in the user's library; then `GET /ws/2/artist/<mbid>?inc=url-rels&fmt=json`. Two calls.
   Names collide ("Nirvana" is three artists on MB), so a low-score match shows nothing rather
   than a wrong page.

### 3.2 The rules of the API

- **One request per second**, per client. A queue in Rust with a 1 s spacing, like the Apple
  call queue (APPLE-CALLS.md); a burst (opening ten artists fast) waits in line, and the chip
  arrives late rather than the app being blocked. MB blocks clients that exceed it.
- **A real `User-Agent`** with the app name, version and a contact: `DeetsMusic/<version>
  (<contact address>)`. MB refuses the generic reqwest one. Which address is his call (§8.4).
- **The data is CC0.** Storing the links in the SQLite cache is free of any terms question.
- **No key, no sign-in.**

### 3.3 Cost and the cache

- **Apple calls: zero.** The artist name and Apple id are already on the artist view.
- **MB calls: one per artist first opened** (path 1) or two (path 2), then none for that artist
  until the cache entry ages out. A refresh after 30 days is the suggested shape (fork §8.5).
- **A miss is cached too** ("no MB artist", "MB artist, no links"), so a second open costs
  nothing and the chip never flickers in late on an artist that has nothing.
- **Latency:** an MB call is 200–800 ms from here. The artist view opens at once; the chip
  enters when the answer lands, through `enterRows`, like a late shelf. The whole thing is
  background work, never on the UI thread (a `#[tauri::command]` that is `async` plus
  `spawn_blocking`, the CLAUDE.md rule).
- **Offline:** no call, no chip; the cached link still shows.

## 4. Apple's terms — read 2026-10-12

Read from the Apple Developer Program License Agreement §3.3.6 D (MusicKit), the English page on
developer.apple.com, and the Apple Music Identity Guidelines (marketing.services.apple, © 2023, no
update date shown), the same way as ROOMS.md §12. **No clause names a link to another store or a
donation page. One clause carries a real risk, the same weight as the §7.6 risk accepted for the
Rooms worker. His call, on the record (§8.6).**

### 4.1 The clauses, quoted

| # | Clause | Quoted text |
|---|---|---|
| a | DPLA §3.3.6 D, purpose limit | "You agree not to call the MusicKit APIs or use MusicKit JS (or otherwise attempt to gain information through the MusicKit APIs or MusicKit JS) for purposes unrelated to facilitating access to Your end users' Apple Music subscriptions." |
| b | §3.3.6 D, rendering | "You may play MusicKit Content only as rendered by the MusicKit APIs or MusicKit JS and only as permitted in the Documentation (e.g., album art and music-related text from the MusicKit API may not be used separately from music playback or managing playlists)" |
| c | §3.3.6 D, money | "You agree not to require payment for or indirectly monetize access to the Apple Music service (e.g. in-app purchase, advertising, requesting user info) through Your use of the MusicKit APIs, MusicKit JS, or otherwise in any way." |
| d | §3.3.6 D, the guidelines | "If You access the MusicKit APIs or MusicKit JS, then You must follow the Apple Music Identity Guidelines." |
| d1 | Identity Guidelines §2.3 | "Do not use an Apple Music lockup along with badges for other music services." |
| d2 | Identity Guidelines §1.3 | "place the Apple Music badge first in the lineup of badges." |
| e | DPLA §2.8 | "You agree not to create or attempt to create a substitute or similar service through use of or access to the Apple Services." |
| f | Apple Media Services Terms | "You may use the Services and Content only for personal, noncommercial purposes." |
| g | DPLA §3.3.6 F, Apple Music Feed API (**not used by the app**) | Feed content "is not used to promote any other goods or services." |

### 4.2 The reading, clause by clause

| # | Against a Support link | Verdict |
|---|---|---|
| a | The artist name and Apple id come from MusicKit. We send one of them to MusicBrainz to find a Bandcamp or Patreon page. A strict reader says that uses MusicKit information for a purpose that is not access to the subscription. | **The risk.** Not zero. |
| b | The chip sits on the artist view, in the playback context. The name is a lookup key, never shown apart from playback. | Holds. |
| c | The app earns nothing. The link carries **no affiliate code**; the app **never takes a payment**. | Clear, with those two rules kept. |
| d | The chip is **text, no Bandcamp or Patreon logo**, and no Apple Music badge sits beside it. The web page and marketing keep the same rule: no store badge in a lineup with Apple's. | Clear, with that kept. |
| e | A link out is not a service. | Clear. |
| f | The user buys for themselves. | Clear. |
| g | Does not bind MusicKit. It shows how Apple thinks about its content beside promotion of other goods: the one product where Apple's content is shown for promotion forbids exactly that. A signal, not a rule. | Noted. |

### 4.3 What lowers the risk on clause a

1. **Name the chip "Support", never "Buy".** A link to the artist's own page reads as part of
   listening to the artist, not as a store.
2. **Match through the user's library where possible.** The artist names and album titles also
   sit in the user's own library data, which clause a does not reach. This does not remove the
   risk; it makes the feature less an extract of Apple data. Path 1 (§3.1) uses the Apple URL,
   which is Apple data; path 2 can run on library names. Weigh that against path 1's accuracy
   (fork §8.2).
3. No affiliate code, no logo, the link opens in the browser through the opener plugin as the
   sign-in page does (`apple.rs`), nothing paid in the app.

Also found: the EEA has a separate Music Streaming Services Entitlement Addendum on top of
§3.3.6 D. It binds apps on Apple's EEA storefronts; a Windows desktop app ships outside them.

## 5. The probe — his library, before the UI (2026-10-13)

The UI is sized to the real numbers, so the probe comes first. A script against his library
export (LOCAL-DATA.md: the read-only SQL copy) and the MusicBrainz API, kept in
`docs/ops/checks/` afterwards (the archive rule):

1. Every distinct artist in his library with its Apple id and name, and one album title each.
2. For each: path 1 (the Apple URL lookup), with the storefront variants `us` / none / slug
   dropped, recording which form lands. Then path 2 for the misses, recording the score.
3. For each match: the URL relationships by type.
4. The numbers to report: artists in the library · matched by path 1 · matched by path 2 ·
   unmatched · with any Support link · with a crowdfunding or Patreon page · with Bandcamp ·
   with an official site only · with nothing. Split by the artist's play count, so the top 50
   count separately from the long tail.
5. Then predict the real world: his library leans one way, so weigh the same numbers on a
   second sample (the Home card's New shelf artists, or Apple's top charts) before the UI is
   drawn. A chip that shows on 15 % of artists is designed differently from one on 70 %.
6. Rate: 1 call/s, so 3,895 rows of songs collapse to a few hundred artists and the probe runs
   in minutes. Nothing is written to the app's database by the probe.

### 5a. Results — his library, 2026-10-13

Run by Claude on his installed app's database (read-only), with
[`docs/ops/checks/mb-support-probe.mjs`](../ops/checks/mb-support-probe.mjs). Steps 1–4 are
done. Step 5 (a second sample outside his library) is not run.

**The library:** 4,023 library songs, 1,711 artist names. 1,308 names (76 %) have an Apple
artist id in `artist_catalog`. 601 names (35 %) are a collaboration ("A & B", "A, B",
"A feat. B").

**How MB stores the Apple URL:** `https://music.apple.com/<country>/artist/<id>`. The slug is
removed; the country is what the editor pasted. Of the matches: `us` 600, `gb` 430, `au` 47,
`fr` 38, `ca` 36, `de` 21, then 17 more countries with 13 or fewer. So path 1 must try more than
one country. The URL endpoint takes up to 100 `resource=` values in one call: 1,308 ids × 35
countries took 409 calls (about 8 min). In the app, one artist is one call with all its country
forms.

| | All 1,711 | Top 50 by plays | Top 200 | The other 1,511 |
|---|---|---|---|---|
| Matched by the Apple URL (path 1) | 922 (54 %) | 39 (78 %) | 140 (70 %) | 782 (52 %) |
| Matched by name + album (path 2) | 176 (10 %) | 5 (10 %) | 23 (12 %) | 153 (10 %) |
| Unmatched | 613 (36 %) | 6 (12 %) | 37 (19 %) | 576 (38 %) |
| **Any Support link** | **840 (49 %)** | **36 (72 %)** | **133 (67 %)** | 705 (47 %) |
| Crowdfunding or Patreon | 5 (0.3 %) | 0 | 0 | 5 |
| Bandcamp | 346 (20 %) | 15 (30 %) | 56 (28 %) | 290 (19 %) |
| Official site only | 492 (29 %) | 21 (42 %) | 77 (39 %) | 415 (27 %) |
| Matched, no Support link | 260 (15 %) | 8 (16 %) | 30 (15 %) | 230 (15 %) |

What the numbers say:

- **Crowdfunding is nearly empty.** No `crowdfunding` relationship at all, and 6 `patronage`
  relationships (5 of them Patreon) across 1,098 matched artists. The first link in the
  §8.1 order is almost never there. In practice the Support link is Bandcamp or the official site.
- **Path 1 is safe.** 3 of 922 matches point at more than one MB artist.
- **Path 2 is strict.** 158 more names had a strong name hit (score ≥ 90) but no album title in
  common, so the probe did not count them. Some of them are real matches with a different album
  title ("Deluxe", a single's name).
- **Most misses are collaborations.** 426 of the 613 unmatched names are collaboration names.
  For 269 of them the first credited artist is also a library artist on its own; 249 of those
  are matched and 175 have a Support link. §7's rule "a song by two artists shows the first
  credited" recovers these. 161 misses are a single artist with an Apple id. They are mostly
  small and new acts that MB does not have (Chioma, Tash, Thandii, DRIIA…).
- **Wikidata adds little.** It knows 538 of the Apple ids (31 %). It adds Bandcamp for 18
  artists and Patreon for 1 beyond MB, and the "any Support" share goes from 49 % to 51 %.
  MB alone is enough.
- **Link types MB gives beside the four in §3:** `purchase for download` 2,213, `soundcloud`
  706, `purchase for mail-order` 139, `ticketing` 73. These are for fork §8.3 or a later fork.
  None is a Support link today.

## 6. The UI — his (2026-10-13)

He designs it. What the mechanics fix in advance, so the design does not fight them:

- The chip is **text** (§4.2 d). The family is the artist hero's chip row (the control-family
  rule, UI-ARCHITECTURE.md §2a), not a toast button.
- It **arrives late** on a first open (§3.3), so the hero's layout must not jump when it enters:
  reserve the slot, or enter it in a place that does not move the rest.
- **More than one link:** a choice under the chip through `openContextMenuUnder`, never a
  fourth popover primitive.
- **A hover hint** for the chip (ONBOARDING.md §1), and one **right-click row** on the artist
  (CONTEXT-MENUS.md) that goes to the same place, so a reader of the menu finds it too.
- **Compass:** a verb row ("support <artist>") is one line in `compass.ts` (COMPASS.md §9).
- **No Settings row** unless the probe shows a reason for one (fork §8.7).

## 7. Where it does not reach

- A **song** or **album** row has no link of its own; the artist's page is the target
  everywhere. A song by two artists shows the first credited.
- **Stations** and **playlists** have no artist; nothing shows there.
- The Press, the tray panel and Mini do not carry it.

## 8. The forks (his)

| # | Fork | Options | Recommendation |
|---|---|---|---|
| 8.1 | Which links | **Decided 2026-10-12:** crowdfunding (incl. Patreon), Bandcamp, official site, in that order. | — |
| 8.2 | The match | (A) Apple URL lookup first, name + album as the fallback · (B) name + album only, never the Apple URL (lower clause-a exposure, more misses) | A, if the probe shows path 1 lands often. |
| 8.3 | Purchase pages | (A) ignore `purchase for download` / `mail-order` (a store, "Buy") · (B) show them after the official site | A: a store page reads as "Buy", the word §4.3 avoids. |
| 8.4 | The `User-Agent` contact | (A) the support address on deets.solutions · (B) the repo URL | A. |
| 8.5 | Cache life | (A) 30 days, then re-ask on the next open · (B) forever, with a "refresh" in the right-click | A. |
| 8.6 | Clause a | Accept the risk on the record, as the §7.6 risk was · or drop the feature | Accept, with §4.3 kept. |
| 8.7 | A Settings row | (A) none; the chip shows when a link exists · (B) Settings › Cards › "Show Support links" off switch | A, unless the probe shows the chip on most artists. |
| 8.8 | Scope of the first build | (A) the artist view only · (B) also the Now Playing artist line | A. |

Open after the probe: the UI (§6), and anything the numbers change.
