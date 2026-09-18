# DeetsMusic — writer credits

How the app gets the people who **wrote** a song, what Apple's data really looks like, and
the producer-web idea it could feed.

Status: **the collection is built (2026-09-17, §3). The producer web is designed, not built
(§5).** Code: `src-tauri/src/credits.rs`.
Siblings: [PLAYLIST-WEB](PLAYLIST-WEB.md) (the feature web, built from performers),
[ideas/DeetsRecommends](ideas/DeetsRecommends.md) (the MusicBrainz credit graph, paused),
[ideas/AppleData](ideas/AppleData.md) (Apple data we do not use yet).

Terms used in this doc:
- **Credit** — a person's link to a song, with a role (writer, producer, engineer).
- **Composer string** — Apple's `composerName`: one flat text line of names, with no roles.
- **Performer edge** — two artists on the same song's artist line or "feat." part. This is
  what the playlist web already uses.
- **Writer edge** — two names in the same composer string. This doc's subject.

---

## 1. Why this doc exists

The playlist web (PLAYLIST-WEB.md) builds from **performer edges**. That reaches artists who
sing together. It cannot see the people behind the song: the producer, the writer, the
engineer. Those people are often the real link between two songs you like.

DeetsRecommends §2.1 recorded that "Apple cannot supply the credits". That is true for
**producer credits and typed roles**. It is not true for writers. Apple gives
`composerName` on every song, and we were throwing it away.

## 2. What Apple returns (measured 2026-09-17, 10 calls)

Probed with the app's own developer token, against `catalog/us`.

### 2.1 The field is there, and it is richer than "writers"

`FALLEN ANGEL` — JENNIE (`6804046959`, ISRC `USQX92604648`):

```
composerName: "JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli & Saya Gray"
```

| Song | `composerName` |
|---|---|
| FALLEN ANGEL | JENNIE, Daniel Aged, Deb Never, **Romil Hemnani**, **Jelli** & Saya Gray |
| HEAVEN | JENNIE, Dave Hamelin, **Jelli**, Raul Cubina, Tyler Spry, Mark Williams & James Essien |
| Less than a Lover | JENNIE, Bibi Bourelly, Tyler Spry, Deb Never, **Jelli** & **Magnus August Høiberg** |
| like JENNIE | JENNIE, Tayla Parx, Amanda "Kiddo A.I." Ibanez, ZICO, **Thomas Wesley Pentz** & Jorge Antonio Alfonzo Sr |

Producers appear, because a producer usually takes a writing split. Romil Hemnani produces
for BROCKHAMPTON. Magnus August Høiberg is **Cashmere Cat**. Thomas Wesley Pentz is **Diplo**.
None of them perform on these songs, so no performer edge can find them.

**Jelli** is on all three EP tracks and performs on none. That is an edge the playlist web
can never see.

### 2.2 It rides reads the app already makes

Both of the shapes the app reads carry the field. Each was checked:

| Read | Carries `composerName` |
|---|---|
| `search?types=songs` | yes |
| `songs?ids=…` (the enrichment batch) | yes |
| `artists?ids=…&views=top-songs` | yes |
| `albums?ids=…&include=tracks` | yes (all three JENNIE EP tracks) |

So collecting the field costs **no extra Apple call, ever**. §3 is built on this.

### 2.3 Apple's search does index the composer, but it does not replace an index

"Thomas Wesley Pentz", 25 results: **23 credit him**. High precision.

But all 25 are songs where **Diplo is also the artist**. Search never reached the songs he
wrote for other people. For a writer who does not perform, it falls apart:

| Name searched | What came back |
|---|---|
| Tyler Spry (a producer) | piano covers and string-quartet versions of "I Ain't Worried"; **not** the original |
| Ilsey Juber (a writer) | two of her own songs, then a piano arrangement |
| Jelli | five unrelated songs by artists named Jelli |

**Conclusion:** there is no "songs by composer X" endpoint, and search is not one. Any reverse
index must be **ours**, built from what we have read. §3.

## 3. The collection (BUILT 2026-09-17)

One rule: **every catalog song the app reads is recorded, with its composer string if Apple
sent one.** No new Apple call. No user-facing change yet.

### 3.1 Parts

| Part | What |
|---|---|
| `Track.composer` (`model.rs`) | `Option<String>`, the raw composer string |
| `track_from_catalog_song`, `track_from_library_song` (`apple.rs`) | parse `composerName`. Library payloads usually omit it; the catalog read fills it in |
| `credits.rs` | the table, `note_rows` / `note_tracks`, `split_composer`, `credits_stats` |
| `song_credits` (SQLite) | `catalog_id` PK, `composer` (nullable), `title`, `artist_name`, `seen_at` |
| `enrich.rs` `write_song` | writes a row for every enriched song and for every track piggybacked by `cache_tracks` |
| `web.rs` `Build::note_credits` | writes a row for every song a web build reads (artist top-songs, album tracklists) |
| `Track.composer` (`src/library.ts`) | the front end can show it; nothing does yet |

### 3.2 Where the rows come from

| Path | Covers |
|---|---|
| `enrich::cache_tracks` | catalog search results, album and playlist tracklists, artist top songs, the Library artist view |
| `enrich::catalog_enrich` | the demand-driven library enrichment — your own songs, as you use the app |
| `web::read_artists`, `web::read_album` | every web build. The richest source: one reach-2 build reads dozens of artists |

The web's own saved reads (`web_artists`) expire after 7 days. `song_credits` does not: the
credits outlive the read that found them.

### 3.3 Decided alone (VALUES.md §3)

| Fork | Options | Pick | The value that chose it |
|---|---|---|---|
| Where the credits live | A) a column on `track_catalog` · B) their own table | **B, `song_credits`** | Attention to fine detail: a table that carries its own denominator answers "what is the coverage", and it is one file to delete if the idea dies |
| A song with no composer | A) skip the row · B) write the row with NULL | **B** | The same. Coverage is the share of rows with a composer; without the NULL rows there is no share |
| A row read again | A) replace · B) keep, fill a NULL only | **B** | Credits never change. A library payload with no composer must never erase a catalog read that had one |
| A write that fails | A) fail the read · B) ignore | **B, silent** | Altruism: a background collection must never break the read it rides on |
| Splitting the names | A) now, into a names table · B) later, keep the raw string | **B** | The split is imperfect (§4). Keep Apple's own text; split when something reads it |

### 3.4 Reading it back

`credits_stats` (a Tauri command, no Apple call) returns: songs seen, songs with a composer,
distinct names, names credited on more than one song (**the edges a producer web would
have**), the 25 most-credited names, and the first and newest `seen_at`.

From the app's devtools console:

```js
await window.__TAURI__.core.invoke("credits_stats")
```

## 4. What stays broken

Neither of these is fixable from Apple's public data.

1. **No roles.** "JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli & Saya Gray" is one
   flat list. You cannot tell the producer from the lyricist, so you cannot weight them the
   way DeetsRecommends §2.4 wanted (producer > writer > feature).
2. **One person, several strings.** Diplo came back as "Thomas Wesley Pentz", "Thomas Pentz,
   Jr." and "Diplo" across five songs. One result printed "JUBER ILSEY", reversed.
   Exact-string matching splits one person into several nodes.

`split_composer` handles what it safely can: it splits on "," and "&", and it keeps a suffix
with its name ("Manuel Seal, Jr."). It does not try to merge aliases. See its unit test
(`cargo test --lib credits`).

## 5. The producer web (DESIGNED, NOT BUILT)

The idea that started this: a web whose nodes are **writers**, not performers.

**The key point:** we do not need to know who Diplo is. The name string itself is the node.
"Thomas Wesley Pentz" links FALLEN ANGEL to Heartbroken to Electricity whether or not we ever
map it to an Apple artist id. Identity resolution is only needed to *show* the person (a
photo, their artist page). That removes the hardest problem in DeetsRecommends §2.5.

### 5.1 Why the current web engine cannot do it today

The web engine's node is an **Apple artist id**:
- `Stored.links` is id → songs shared (`web.rs`).
- A degree is read as `artists?ids=…` in batches of 25.
- `credited_names` reads only the artist line and the "feat." part.

A composer is a bare string with no artist id, so no `top-songs` view, so no next degree. The
engine can **record** a writer (§3 does that now). It cannot **walk** to one.

### 5.2 What a first version would be

A SQL join over `song_credits` — no Apple call, the `LOCAL-DATA.md` pattern:

- **Node:** a normalized composer string.
- **Edge:** two names in the same composer string.
- **Reach:** whatever the collection holds. Dense where you listen. Empty outside it.
- **Songs:** the `catalog_id` rows are already playable.

### 5.3 Open forks

1. **Seed:** A) a writer name picked from a song · B) a song, as the web's §9 seed does
2. **Where it surfaces:** A) a second mode in the web panel · B) its own thing · C) autoplay only
3. **Names:** A) exact string · B) a hand-kept alias table for the names that matter
4. **The floor:** how many songs a name needs before it is offered as a seed

None of these can be answered until the collection has run for a while. That is the point.

## 6. What MusicBrainz still holds

Read with ideas/DeetsRecommends.md, which stays a record, not a plan.

| Data | Apple | MusicBrainz |
|---|---|---|
| Writers | yes, flat | yes, typed |
| Producers | only when they also write | yes, typed |
| Engineer, mixer, remixer | no | yes |
| Band membership | no | yes |
| Samples, covers, remix-of | no | yes |
| One person, one id | no | yes (and it often links to the Apple artist page) |

If the §5 web works and its limits bite, MusicBrainz is the fix for roles and aliases — as a
gap-filler on top of a working feature, not as the base. The 100 GB mirror stays paused.

## 7. The song pane (BUILT 2026-09-17)

### 7.1 Where you start it

| Way in | Where |
|---|---|
| Right-click a song → **Song Credits** | Library, Playlists, Search, Queue, History, Now Playing (one song only; a multi-row pick has none) |
| **Ctrl+Space** → "Song credits" | the song playing now; aliases "writers", "composer", "who wrote" |
| The hover hint | not a way in — it shows the writers where you already are (§7.3) |

The verb is `songCreditsItem` in `go-to.ts`, next to Go to Artist and Go to Album. It
returns null without a catalog id, so an uploaded track never offers it.

### 7.2 Two surfaces, one feature

The app has **two drill systems**, and a song belongs to both (go-to.ts, "the rule and its
limit"):

| | Library, Playlists, Radio | Search |
|---|---|---|
| Engine | the collection-card engine: a stack of `Context` levels | its own `.spane` pane stack |
| The song level | `songDetail(t)` → `writerDetail(name)`, in place | a `song` and a `writer` pane kind |
| Reached by | `LibNav.drillSong` | the `requestSongPane` bus |
| Back | the card's own Back | the pane's Back |
| Memory | `song:<catalogId>`, `writer:<name>` keys + `resolve` | `PaneOpen` in the snapshot |

**Which one a verb uses is decided by the menu, not by the pane.** `goToItems` branches on
`nav`: a card that drills locally keeps Song Credits local, exactly as it keeps Go to Artist
and Go to Album. A card with no nav (Search, Queue, History, Now Playing) hands the intent to
the Search card.

This was wrong for half a day (2026-09-17): every Song Credits summoned the Search card, so a
Library menu had two verbs that stayed and one that jumped. The rule it came from — "catalog
detail panes live in one place" — is about targets that need an Apple **id hop**. A song
level needs none.

Neither surface makes an Apple call. The caller already holds the `Track`.

### 7.2a What each level shows

| Level | Hero | Under it | Rows |
|---|---|---|---|
| **Song** | cover, title, the artist (a tap drills to them), album · year · length | the Details table, then a note | one per **writer** |
| **Writer** | round initials, the name, "N songs collected" | a note on what the list is | the songs, yours first |

The engine wants a list at every level, and a song's natural list is its writers. So the song
level is not a detail card wedged into a list engine: the writers **are** the list.

| Part | What |
|---|---|
| Hero | the cover, the title, the artist line |
| **Writers** | one chip per name, each clickable (§7.4) |
| A note | "Apple lists these as one line, with no roles. A producer appears when they also take a writing credit." |
| **Details** | album, genre (without "Music"), released, length, ISRC — all from the Track we already had |

With no credits yet, the Writers section says why (§8) instead of being empty.

### 7.3 The hover hint

A song row's hint grows a **third line**: the writers, after a blank line. The song and the
artist answer "what is this"; the writers answer something else, and the gap is what says so
(`--hint-credit-gap`, `.hint__credit`).

The line is read synchronously from a memory map (`src/credits.ts`), because a hover cannot
wait for a round trip. A miss shows no third line and quietly asks Rust for that id, so the
next hover over the same row has it. Ids are batched per animation frame: a pointer crossing
a list does not fire one call per row.

Rows carry the id in `data-cid`: `.lib-row` (Library, Playlists, album and playlist lists),
`.qrow` (Queue, History, Rewind), `.search__song` and `.search__row`, and `.np`.

A row with credits shows its hint **even under "Song names: only when the name is cut off"**
— being cut off is no longer the only reason to hover a row.

### 7.4 A writer is clickable

A chip opens the **writer pane**: every song the app has collected that credits that name,
yours first (`songs_by_writer`, one local join, no Apple call).

This is the producer web at its smallest (§5.2): the name string is the node, and the answer
is a join over what the app has already read.

| Part | What |
|---|---|
| Hero | the name, "Writer", and "N songs collected" |
| A line | `WRITER_REACH` — what the list is and is not |
| The songs | yours first. A row the app holds a track for plays, drags and takes a menu like any song row |
| The rest | a song the collection knows of but holds no track for (§7.4a) |
| The button | "Search Apple Music for “name”" — one call, which **fills this level in place** |

The ranking is 3 loved, 2 played, 1 in your library, 0 seen only — the same `mine` ladder the
playlist web uses.

The Apple search does **not** navigate away (the user's call 2026-09-17). An earlier version
put the term in the search field and showed normal results, which threw away the page you
asked the question from. Now the button reads "Searching…", the call runs, every result is
collected on its way back through `cache_tracks`, and the level redraws with what it found.

### 7.4a Where the "credited" mark shows

A row carries it when `song_credits` has the song but the `tracks` table does not — the app
knows it exists and who wrote it, and holds nothing to play.

That happens because the two tables fill from different events:

| Table | Written when |
|---|---|
| `song_credits` | **any** catalog song is read — a search, an album tracklist, an artist's top songs, a web build |
| `tracks` | a song is *materialized* — played, loved, added, synced from your library, or put in a playlist |

So a **web build** is the big producer of these rows: one reach-2 build reads dozens of
artists' top songs and never plays one of them. Browsing an album you did not play does the
same. On a fresh database there are almost none, and after a few webs there are many.

The two surfaces show it differently, because their lists differ:

- **Library** — one list, in `mine` order, and the row takes a quiet trailing "credited"
  (`FLAT_MARK`). The list keeps one weight.
- **Search** — two sections, "In your app" and "Also credited", the second dimmed
  (`.search__row--flat`). The pane has no sort control, so the split does that job.

Neither one plays. Pressing it does nothing, which the mark's hover text says.

### 7.5 Can Apple find more songs by a writer? (measured 2026-09-17)

Yes, partly. That is why the button is there and why it is not automatic.

Apple's search **does** index `composerName`. "Thomas Wesley Pentz", 25 results: 23 credit
him. But all 25 are songs where Diplo is also the **artist** — it never reached what he wrote
for other people. For a writer who does not perform it degrades badly (§2.3): Tyler Spry
returns piano covers, Ilsey Juber returns her own songs, "Jelli" returns unrelated artists.

So the button is worth one call, and the line under it says what the call covers:
**"Searches write credit and artist credit"** — which is exactly what Apple matches on, and
why a performing writer comes back rich and a studio-only one comes back thin.

It also feeds the collection: a catalog search runs through `cache_tracks`, so every result
is recorded with its credits (§3.2). One press therefore does two things — it answers the
question, and it makes the next question cheaper.

### 7.6 Decided alone (VALUES.md §3)

| Fork | Options | Pick | The value that chose it |
|---|---|---|---|
| Apple search for a writer | A) automatic on opening the pane · B) one explicit button | **B** | Stewardship of providers, and the web panel's own "Search Apple Music for …" row is the same idiom |
| A song we hold no track for | A) hide it · B) a flat, dimmed row | **B** | Power to the users: the credit is real data, and hiding it would understate what the app knows |
| The hint under "only when cut off" | A) obey it · B) show a row that has credits | **B** | The setting is about names being readable; the writers are a new reason to hover |
| Where the pane lives | A) a new card · B) a Search pane kind · C) B **and** a Library level | **C** (corrected 2026-09-17, §7.2) | A card would duplicate a stack twice over. B alone made the Library menu inconsistent with its own two other drill verbs |
| The Search pane's memory | A) keep the Track in the snapshot · B) re-resolve on restore | **A** | No Apple call on a restore, and the caller already held the Track |
| The Library level's memory | A) keep the Track · B) key it and re-resolve over the store | **B**, `song:<catalogId>` | Every other Library level does this, and a song removed from the library must end the restore, not come back as a ghost |
| A writer's songs in the Library | A) only the ones we hold a track for · B) all of them, with the rest marked | **B**, a quiet "credited" mark | Power to the users: the credit is real data. Hiding it would understate what the app knows |
| The copy | A) written at each call site · B) one exported set of strings | **B**, `src/credits.ts` (§7.7) | Two surfaces must not drift into saying different things about the same data |
| A song we have never read (2026-09-17, the user's call) | A) say "not collected yet" · B) read it now, one call | **B** | Altruism: the work is ours. A message that explains our own gap to the user is not an answer to it |
| Apple having no credits | A) the same message as "not read" · B) its own, naming Apple | **B** | Report outcomes faithfully. The two states have different causes and only one is fixable |
| The note when credits ARE present (the user's call) | A) keep it · B) drop it | **B** | The names are the answer. The field's shape is ours to know |
| The Apple search's landing (the user's call) | A) the card's normal results · B) fill this level in place | **B** | Leaving throws away the page that asked the question |

### 7.7 The copy

Every line these levels can show is exported from `src/credits.ts`, so the Library level and
the Search pane say the same thing. Change it once.

| Constant | When it shows | Text |
|---|---|---|
| `CREDITS_LABEL` | the section title, always | "Writers, Producers, & Composers" |
| `CREDITS_NONE` | **Apple was asked and had none** | "Apple Music returned no credits for this song." |
| `CREDITS_READING` | **we have never read this song**, and the read is running | "Reading credits from Apple Music…" |
| `CREDITS_READ_FAILED` | that read failed | "Couldn't read credits from Apple Music. Try again later." |
| `WRITER_REACH` | on a writer level, once its songs are in | "Songs DeetsMusic has read so far. The list grows as you listen and build webs — it is not everything they wrote." |
| `WRITER_SEARCH_NOTE` | under the Apple search button | "Searches write credit and artist credit" |
| `WRITER_EMPTY` | a writer level with no songs at all | "Nothing collected for this writer yet." |
| `FLAT_MARK` | the trailing mark on a credited song we hold no track for (§7.4a) | "credited" (hover: "Credited, but DeetsMusic holds no track for it yet") |

Two more lines are state, not copy: the writer hero reads **"Reading…"** until the join
lands, then **"N songs collected"**.

**There is no note when the credits ARE there** (changed 2026-09-17). The old line explained
Apple's field to a reader who did not ask. The names are the answer; an essay about the data
model underneath is ours to know, not theirs to read. The section title carries what matters:
the field holds writers, producers and composers together.

**The empty state names whose gap it is.** Three states, and only one is ours:

| State | What the pane does |
|---|---|
| We hold credits | shows them, and says nothing else |
| We read the song, Apple sent none | "Apple Music returned no credits for this song." Settled — we never ask again |
| We have never read the song | says it is reading, **spends one Apple call**, then lands on one of the two above |

The third state used to say "not collected yet", which read like a shrug and left the user
holding our gap. Now the pane closes it. `credits_fetch` (enrich.rs) always asks, because
`catalog_enrich` is cache-first and would skip a song enriched before this feature existed.
Apple's "none" is written down as a NULL row, so the call happens at most once per song.

## 8. When a song has no credits yet

Five real cases. The pane says the short version of this.

1. **The app has not read that song from the catalog yet.** Enrichment is demand-driven
   (`enrich.rs`: "never a batch pre-pass"), so a library song you have never opened or played
   has no catalog read behind it.
2. **The song has no catalog id.** An uploaded file, or a library track Apple cannot match.
   There is nothing to read and no credits to have. The menu verb hides itself here.
3. **Apple sent none.** Coverage is uneven. Four of five BROCKHAMPTON search results came
   back with no `composerName` at all (§2.3), while a 2026 K-pop release gave six names.
4. **The song was read before this shipped (2026-09-17).** Rows only accumulate from the
   first read after the collection existed. Old reads left nothing behind.
5. **A library payload, not a catalog one.** `library/songs` usually omits the field; the
   catalog read fills it in later, and the row is upgraded then, never downgraded (§3.3).

**Cases 1, 4 and 5 are ours, and the pane now closes them itself** (2026-09-17): opening a
song we have never read spends one Apple call (`credits_fetch`) and lands on a real answer.
Cases 2 and 3 are not ours: no catalog id means there is nothing to ask about, and Apple
having no credits is recorded as a NULL row and stated plainly — "Apple Music returned no
credits for this song."

Nothing here is an error, so nothing toasts.

## 9. Desk test

Restart the dev runner (new Rust code).

1. Play or open anything that reads catalog songs: a search, an album, an artist.
2. In the devtools console: `await window.__TAURI__.core.invoke("credits_stats")`.
   `songs` is above 0 and `withComposer` is above 0.
3. Build a web (Playlists › the web button) from any artist. Run `credits_stats` again:
   `songs` has grown by a lot, and `top` names people who are not performers.
4. Check a known song: search for JENNIE and open "Fallen Angel - EP". Run `credits_stats`
   again: "Jelli" is in `top` with 3 songs. (`deetsmusic sql` cannot reach this table —
   it exposes only the five export tables, LOCAL-DATA.md §2. Whether `song_credits` joins
   them is an open fork.)
5. Restart the app. `credits_stats` keeps its numbers: the rows are durable.
6. `cargo test --lib credits` passes.

The song pane (§7):

7. Search for JENNIE, open "Fallen Angel - EP", right-click **FALLEN ANGEL** → **Song
   Credits**. The Search card takes the pane: hero, the section **Writers, Producers, &
   Composers** with six chips, then Details. **No note under the chips.**
7a. Open a song the app has never read. The section says "Reading credits from Apple
    Music…", then either the chips appear or it says "Apple Music returned no credits for
    this song." Check the log: exactly one `credits: read 1 song(s)` line. Open it a second
    time: no new line — the answer, including "none", is remembered.
8. Hover a song row in the Library, the Queue and Now Playing. The hint has a third line
   with the writers, under a blank line. Hover a row the app has not read yet: two lines
   only, and a second hover has three (the first one warmed it).
9. Press a chip, e.g. **Jelli**. The writer pane lists the EP's three songs. Rows under
   "In your app" play; rows under "Also credited" do not.
10. Press **Search Apple Music for “Jelli”**. The button reads "Searching…", one call runs,
    and **the writer level itself fills out** — the card does not navigate to results. The
    line under the button reads "Searches write credit and artist credit".
11. Ctrl+Space → type "writers". "Song credits" appears while a song is playing, and opens
    the pane for it.
12. Right-click a song with no catalog id (an uploaded track): **Song Credits** is absent.
13. Pick two rows (Ctrl+click) and right-click: **Song Credits** is absent — it is a
    one-song verb.
14. Grow the Search card, then Collapse: the pane comes back where it was (card memory).

In the Library (§7.2 — it must never leave the card):

15. Library → a song → right-click → **Song Credits**. The Library drills **in place**, the
    header reads "Song", and Back returns to the list. The Search card does not move.
16. The rows are the writers, under the section title **Writers, Producers, & Composers**.
    Sort offers **Credit order** (default, Apple's own order) and **Name**.
17. Press a writer row: the Library drills again, header "Writer". Songs you have play on a
    click; a song the app holds no track for carries a quiet "credited" mark and does not.
18. Back twice: the song level, then the list you started from.
19. Restart the app with the song level open: it comes back (`song:<catalogId>`). Do the same
    on a writer level.
20. The same song's pane in the Library and in Search says the same words (§7.7).
21. On a writer level in the Library, the **Search Apple Music** button sits under the note,
    above the rows. Press it: it reads "Searching…", then the row list grows in place.
