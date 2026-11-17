---
status: idea
desk_test: none
sources: [src-tauri/src/web.rs, src/web.ts, src-tauri/src/lastfm.rs, docs/features/PLAYLIST-WEB.md, docs/ideas/LastfmTags.md]
updated: 2026-11-12
---
# Web vibe: Last.fm tags in the playlist web

> **An idea, opened 2026-11-11** from the owner's ask: "Can we talk theory on the web including
> last.fm tags to align the vibe of the music more?" **§2 is what he decided and is fixed.** The
> rest is Claude's proposal. He will dig in later. Nothing here is built. Do not tell a user the
> app does this.

**Terms**
- **Credit graph:** what the web walks today. Two artists have an edge when they are credited on
  the same song (PLAYLIST-WEB.md §4).
- **Tag vector:** a song's, album's or artist's Last.fm tags with their weights, for example
  *alternative rnb 100, neo-soul 62, bossa nova 18*.
- **Target:** the tag vector the web aims at (§2 item 2).
- **Vibe score:** how close a candidate's tag vector is to the target.
- **Credit song:** a song the web finds through the credit graph, as today.
- **Tag song:** a song the web finds through a Last.fm tag list, with no credit link to the seed.
- **Key:** a target tag that a tag song shares, and that passes the backup test (§4).

## 1. Why

The web answers "who made music together". It does not answer "does it sound alike". The only
sound filter today is Apple's genre chips. They are coarse ("Hip-Hop/Rap") and come from the
album, not the song. On Samara Cyn, an R&B/Soul pick still mixed rap and R&B (PLAYLIST-WEB.md
§3). Last.fm tags are a second space: how listeners describe the music.

One fact from the LastfmTags.md §3 probe shapes all of this: **single tags rarely overlap.**
*alternative rnb* and *bossa nova* share 1 album and 5 songs in the first 3,000. So a match of one
tag against another is too sparse. A weighted vector over many tags gives a score where two tag
lists give almost nothing.

## 2. His calls (2026-11-11)

1. **Tags also bring in songs** (not only judge them). A tag song can join the web with no credit
   link. **This changes a recorded decision:** PLAYLIST-WEB.md §3 says "every link is a real song
   together" and "`similar-artists` is not an edge". When this is built, that row changes, with
   his date. Not taken: tags only rank and prune.
2. **The target is automatic, and a chip overrides it.** A song seed aims at the song's tags,
   then the album's, then the artist's. An artist seed aims at the artist's tags. A tag chip that
   the user presses becomes the target. Not taken: always the seed artist's tags (a song that is
   off its artist's usual sound would lose its own vibe).
3. **His concern, the reason for §4:** "songs have weird tags sometimes, we need some sort of
   check for other songs combining multiple tags for a stronger relation."

## 3. Where the vibe score acts (proposal)

1. **Rank.** In `pickSongs`, "nearest degree first" becomes "nearest degree, then the closest
   vibe".
2. **Steer the walk.** In `web_build` step 4, the next degree is ranked by links. Add the vibe
   score, so reach 3 stops drifting. A degree-2 artist who joined through one off-sound feature is
   not read further. This also saves Apple calls: fewer far-off artists are read.
3. **Tag chips** beside the genre chips, or in their place. They are finer than Apple's genres.
   The design is his.
4. **Bring in tag songs** (§2 item 1), through the check in §4.
5. **Later: order by flow.** Arrange the playlist so each song is near the one before it. This
   aligns the flow, not only who is in the list.

## 4. The check for a tag song (proposal, from his concern)

Song tags are noisy:
- One listener can put a personal tag on a song ("gym", "my summer").
- A song often has only 1 to 3 tags, with small counts.
- Some tags name a moment, not the sound ("2018 single", "seen live").

So one shared tag is weak evidence. Two or more shared tags that agree are strong evidence.

**A tag song must pass both tests:**
1. **Two keys.** It shares at least 2 of the target's strong tags: the target's top 5, with the
   junk tags taken out (§6 item 1).
2. **Backed up.** A shared tag counts as a key only when:
   - the song's album or artist carries that tag too, **or**
   - the song's own weight for that tag is high (most of its taggers used it).

   A lone tag that nothing else on that record carries is the "weird tag". It does not count.

**The score.** Add up the keys. Each key counts as the smaller of its weight on the target and on
the song. A tag that is common in the pool weighs less than a rare one (TF-IDF over the pool). A
song with three keys beats a song with two.

**Example.** Seed: ELIZA, *A Real Romantic*. Target: *alternative rnb · bossa nova · funky*.

| Song | Tags | Result |
|---|---|---|
| X | *bossa nova*, *funky*; its artist also has *bossa nova* | two keys, backed up: **in** |
| Y | *alternative rnb*, *chill* | *chill* is not a target tag; one key: **out** |
| Z | *alternative rnb*, *bossa nova*, but *bossa nova* only on the song, at weight 3 | one backed-up key: **out** |

**Credit songs skip this gate.** A real song together is already strong evidence. Their vibe
score only ranks them. A credit song with no tags is not dropped: it gets a neutral score.

## 5. The calls (proposal)

| Step | Call | Cost |
|---|---|---|
| Artist vectors | `artist.getTopTags`, one per web artist (about 70 at reach 3) | Last.fm only; cached 30 days, as the other Last.fm facts (LISTENERS.md §3). Probe first: I believe `artist.getInfo` gives tag names without weights, so it is not enough |
| The pool | `tag.getTopTracks` for the target's top 3 tags; the **union** of the lists, not the overlap (§1) | 1 to 3 calls a tag; cached a month (LastfmTags.md §4 shares this cache) |
| Verify | `track.getTopTags` per candidate, top of the pool only, capped near 150 | Last.fm only; cached 30 days |
| Lookup | Apple lookup only for a song that passed (LastfmTags.md §1, the `resolve` path) | Apple; counted by `apple_calls.rs` |

Song vectors for credit songs are read only when they are already cached. Hundreds of
`track.getTopTags` calls per web would be slow.

## 6. Things that follow (not forks)

1. **A junk-tag stop-list for scoring only.** LISTENERS.md §7.1 item 2 says to show tags as Last.fm
   gives them. That rule is about what the user sees. Claude's reading: a stop-list in the score
   does not break it. **Ask him to confirm.** The stop-list: years, "seen live", "favorite(s)",
   artist names, tags that name the seed.
2. **An artist or song with few or no tags gets a neutral score, not a low one.** Otherwise small
   collaborators always lose, which works against Discover.
3. **The status line names the source:** "50 songs · 18 by vibe".
4. **The trace (PLAYLIST-WEB.md §14) logs each tag song's keys,** so a bad pick can be explained.
5. **The rule is pure, with tests,** in a small file (as `layout-rules.ts`): vectors in, the score
   and the pass or fail out.

## 7. Open (his)

1. **How much of the playlist tag songs may take.** Claude's pick: **a cap of half, credit songs
   fill first.** The list stays a web, and this matches the seed-songs-at-most-half rule in
   PLAYLIST-WEB.md §4. Cost: a strong tag song can lose to a weak credit song. The other option:
   everything competes on one score. Cost: a narrow seed can turn the list into a tag station.
2. **The numbers for §4:** how many keys (2 or 3), and what "high weight" is. **Measure first:** a
   probe on 3 seeds he picks (one of them ELIZA), listing what passes at 2 keys and at 3 keys, with
   the keys of each song. He judges the lists by eye, then sets the numbers.
3. **How strong the pull is,** and where it sits in the panel (a pill such as Tight · Loose · Off,
   or no control). His UI.
4. **The tag chips:** beside the genre chips, or in their place.
5. **Order by flow** (§3 item 5): in scope, or later.
