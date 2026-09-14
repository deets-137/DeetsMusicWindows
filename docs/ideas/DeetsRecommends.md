# DeetsRecommends — a credit-graph recommendation engine

> **Status: roadmap idea, not scheduled.** A possible way for DeetsRadio / DeetsMusic to make
> its own recommendations from *who made the music*, not from listening behaviour.
> Status legend: ✅ decided · 🔵 open · ⬜ later.
> Siblings: [STATIONS](../STATIONS.md) (Apple stations; the old own-station engine was dropped —
> this doc is a different engine, fed by credits, not audio features),
> [DATA-ARCHITECTURE](../DATA-ARCHITECTURE.md) (provider + SQLite cache).

---

## 1. Terms

- **Credit graph** — a table of links between artists. Each link has a type (feature,
  writer, producer, member, …) and a weight.
- **ISRC** — the standard ID for one recording. Apple, MusicBrainz, and Deezer all carry it.
- **MBID** — MusicBrainz's own ID for an artist, recording, work, release, and so on.
- **Recording vs. work** — a *recording* is one audio take. A *work* is the composition.
  Producers attach to recordings. Writers attach to works.
- **Seed** — the song or artist a recommendation starts from.

---

## 2. What we know so far

### 2.1 Apple cannot supply the credits ✅
- The public Apple Music API gives `artistName` (a display string such as "X feat. Y"), an
  `artists` relationship, and `composerName` (one flat string).
- It gives **no producer credits and no typed roles**.
- The Apple Music app shows full credits through the private `amp-api`. **Rejected** — it
  needs the web player's privileged token and cookies (see [PLAYLISTS](../PLAYLISTS.md) and the
  2026-07-01 decision). Same reasons apply here.

### 2.2 The credits come from outside; ISRC is the join key ✅
- DeetsMusic already stores the ISRC per catalog track (`track_catalog` in
  `src-tauri/src/enrich.rs`). An outside lookup by ISRC is an existing pattern (the Deezer
  BPM probe in STATIONS §4).

| Source | Roles | Limits | Verdict |
|---|---|---|---|
| **MusicBrainz** | Typed: producer, writer, composer, lyricist, feature, instrument, engineer, remixer, samples | 1 req/s API · CC0 data · full dumps | ✅ **Base source** |
| Genius | Writer, producer, feature | Token · fuzzy title+artist match · caching terms | ⬜ Gap-filler only, if a genre has holes |
| Discogs | Very detailed | 60 req/min · credits per *release*, poor ISRC match | ✗ Not a fit |
| Muso.AI / Jaxsta / Gracenote | Best coverage | Business contracts; pricing unverified | ⬜ Only if free data fails |
| Spotify | App shows credits | Not in the public API | ✗ |

### 2.3 MusicBrainz: the limit is speed, not depth ✅
- API: 1 request per second, no paid tier. About 2 calls per track (ISRC → recording, then
  recording + work relationships). A 3,895-track library ≈ 2 hours for a first pass.
- Coverage: volunteer data. Releases from the last 1–2 years and niche artists often lack
  producer/writer credits. Major pop, rock, and hip-hop are usually good.
- **Decision direction:** do not use the live API from the app. Use a **local mirror** to
  build the graph offline (§4).

### 2.4 How it plugs into DeetsMusic (sketch) 🔵
1. **Build** — ISRC → recording MBID → artist credits + relationships → rows in
   `credit_edge(artist_a, artist_b, role, weight)`. Credits almost never change: cache forever.
2. **Score** — walk 1–2 hops from the seed. Weight roles (e.g. producer > writer > feature).
   Down-weight artists already heavy in the library. Plain SQL, no ML.
3. **Resolve to songs** — the engine outputs *artists*. Apple calls (artist top songs) turn
   them into playable `Track`s. Top N artists only, cached. **This is the only Apple cost.**
4. **Surface** — a station/autoplay mode, a "connected artists" section on the artist pane,
   an MCP/bridge route, or all three.

All of it lives in Rust; the front end sees normal `Track` lists.

### 2.5 Known risks
- **Coverage gaps** — the graph is dense in some genres and empty in others.
- **Artist identity** — an MBID is not an Apple artist ID. See §3.4: MusicBrainz URL
  relationships often link straight to the Apple Music artist page, which removes most
  name-matching.
- **Reach** — a graph seeded from the library only reaches artists 1–2 hops away. The full
  mirror removes that limit.

---

## 3. Everything else MusicBrainz holds (beyond credits)

The inventory below is what the MusicBrainz schema models. It is **not yet checked against
real row counts** — do that on the mirror (§4) before relying on any one field.

### 3.1 Core entities and their fields
| Entity | Useful fields |
|---|---|
| **Artist** | type (person / group / orchestra / choir / character), gender, area (country → city), begin/end dates (birth, formed, disbanded), aliases + sort name, disambiguation, IPI / ISNI codes |
| **Release group** (the "album" idea) | primary type (album / single / EP / broadcast), secondary types (compilation, live, remix, soundtrack, mixtape, DJ-mix, demo, interview, spoken word), first release date |
| **Release** (one edition) | date, country, label + catalog number, barcode, status (official / promo / bootleg), packaging, language + script |
| **Recording** | length, ISRCs, video flag, first release date |
| **Work** | type (song, aria, symphony…), ISWC, lyrics language |
| **Label** | type (original production / imprint / distributor / reissue), area, active dates |
| **Area** | country / subdivision / city, with a parent hierarchy |
| **Place** | studios, venues, pressing plants — with coordinates |
| **Event** | concerts, festivals, tours — date, place, performers, sometimes setlists |
| **Series** | ordered lists: tours, festival editions, award lists, "best of" charts, catalog series |
| **Instrument** | a typed instrument tree (used by performer credits) |
| **Genre** | a controlled genre list, applied as voted tags |

### 3.2 Relationship types (the graph edges)
**Artist ↔ artist**
- Member of band (with dates and instruments) — also founder, subgroup, conductor position
- Collaboration / "is person" (pseudonyms, alter egos, projects)
- Supporting musician, vocal/instrument supporting, tribute/cover band
- Family (parent, sibling, spouse) — sparse but real
- Teacher / student (mostly classical and jazz)

**Artist → recording / release**
- Producer, co-producer, executive producer
- Featured artist, vocal (lead / backing / guest), instrument (with the instrument)
- Mix, mastering, recording engineer, programming, arranger, orchestrator, conductor
- Remixer, DJ-mixer, compiler
- Art direction, design, photography (release level)

**Artist → work**
- Composer, lyricist, writer, librettist, translator, arranger, publisher

**Recording ↔ recording / work ↔ work**
- **Samples** (recording → recording or → work)
- **Remix of**, edit, DJ-mix of, mashes up, compilation of
- Recording **performance of** a work — with attributes **cover**, **live**,
  **instrumental**, **karaoke**, **partial**, **medley**
- Work **based on**, arrangement of, translation / version of, parts of

**Place / label / event**
- Recorded at, mixed at, mastered at (a studio `Place`)
- Label: released on, distributed by, label ownership / imprint of, rights society
- Artist ↔ label: contract / signed to (with dates)
- Event: performer at, held at, part of series

**URL relationships (external IDs)**
- **Apple Music**, Spotify, Deezer, YouTube, Bandcamp, SoundCloud, official site, social
  networks
- Wikidata, Wikipedia, Discogs, AllMusic, Genius, lyrics sites, IMDb, streaming/purchase links

### 3.3 Community data
- **Tags and genres** with vote counts — on artists, release groups, recordings, works.
- **Ratings** (0–100 average + vote count) — on artists, release groups, recordings.
- **Annotations** — free wiki text per entity.

### 3.4 What we could use it for
| Data | Idea |
|---|---|
| **Apple Music URL rels** | Map MBID → Apple artist ID directly. Solves the identity risk (§2.5) for artists that have the link. Highest-value non-credit field. |
| **Band membership + "is person"** | Band → members' solo work and side projects; alias collapsing (one person, many names). |
| **Samples / remix of / cover** | A second edge family: "songs built on this song" and "the original of this". Strong for hip-hop and electronic. |
| **Genre tags + votes** | Keep hops inside a genre neighbourhood; penalise genre jumps unless the user wants discovery. |
| **Release-group secondary types** | Filter out compilations, karaoke, live, remixes when resolving to songs. |
| **Label + contract dates** | "Label mates in the same era" as a weak edge. |
| **Recorded-at studio + date** | "Same studio, same years" — a scene signal (sparse). |
| **Area + begin date** | Scene/era filters: same city, same decade. |
| **Events + series** | Co-billed artists at the same festival edition or tour. |
| **Ratings** | A light quality floor when picking which songs of a found artist to play. |
| **Work / ISWC** | Group every recording of one song (covers, live versions) so the engine does not recommend the same song twice. |

### 3.5 Adjacent MetaBrainz projects (not in the mirror)
- **Cover Art Archive** — release artwork by release MBID. Apple already gives us art; low value.
- **ListenBrainz** — open listening data; publishes similar-artist / similar-recording
  datasets and popularity. A behaviour-based signal to blend with the credit graph, if wanted.
- **AcousticBrainz** — audio features (BPM, key, mood, danceability) by recording MBID.
  **Shut down in 2022; frozen dumps remain.** Old catalogue only.
- **CritiqueBrainz** — user reviews. Low value.

---

## 4. The local mirror 🔵

Setup started, then paused.

- **Tool:** `metabrainz/musicbrainz-docker`, **database-only** profile (`alt-db-only-mirror`).
- **Stated requirements (README):** 2 CPU threads, 4 GB RAM, **100 GB disk**.
  Windows is "not documented" — expected to run through Docker Desktop's WSL 2 backend.
- **Blocker to check first:** drive C: had ~96 GB free, and Docker Desktop keeps its data
  on C: by default. Free space, move Docker's disk image to another drive, or confirm the real
  imported size before `createdb.sh -fetch`.
- **Steps** (Git Bash, in a folder outside this repo):
  ```
  git clone https://github.com/metabrainz/musicbrainz-docker.git
  cd musicbrainz-docker
  admin/configure with alt-db-only-mirror
  admin/configure add publishing-db-port      # expose Postgres to the host
  docker compose build
  docker compose run --rm musicbrainz createdb.sh -fetch   # download + import (hours)
  docker compose up -d
  ```
  Replication (to keep it current) needs a MetaBrainz token:
  `admin/set-replication-token` → `admin/configure add replication-token` →
  `admin/configure add replication-cron`. For an offline graph build, a one-time snapshot is
  enough; replication is ⬜.

### 4.1 The hybrid shape 🔵
The mirror is a **build tool**, not something the app ships.
1. Run the mirror locally.
2. A build script queries it and exports a small graph (`credit_edge`, MBID → Apple ID map,
   genre tags).
3. Ship that export — either bundled/downloaded into the app's SQLite, or hosted on a
   Deets worker (DeetsRadio already runs on Cloudflare with D1). The app then makes **zero**
   MusicBrainz calls.

---

## 5. Open forks (for the design session)
1. **Graph scope:** A) the user's library only · B) library + 1 hop · C) the whole mirror
2. **Edge families:** A) credits only · B) credits + band membership · C) + samples/covers
   · D) + label/studio/event "scene" edges
3. **Where the graph lives:** A) in the app's SQLite · B) on a DeetsRadio worker (D1)
4. **Surface:** A) station/autoplay mode · B) artist-pane "connected artists" · C) both
5. **Behaviour blend:** A) pure credit graph · B) blend in ListenBrainz similarity
