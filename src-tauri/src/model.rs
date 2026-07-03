//! Our own normalized music model. Every provider (Apple now, Spotify later) maps
//! its raw shapes into these types, so the UI only ever sees DeetsMusic models.
//!
//! Designed from real Apple data (see dev-dumps/): the library/catalog split means
//! a Track carries BOTH ids (either may be absent), and catalog-only fields
//! (isrc, artwork colors) are optional.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    /// URL template containing `{w}` / `{h}` placeholders.
    pub url_template: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<String>,
    /// Catalog-only: up to four text colors that complement the artwork.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_colors: Option<Vec<String>>,
}

/// What a provider needs to actually start playback later.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub is_library: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    pub title: String,
    pub artist_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<u32>,
    pub genres: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_rating: Option<String>,
    pub has_lyrics: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    /// Catalog-only: 30s preview stream URL (rides search results for free).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// Position in the library when sorted oldest→newest by date added.
    /// Apple's `library/songs` doesn't expose a per-song `dateAdded`, so we fetch
    /// with `sort=dateAdded` and record each row's rank. Drives the "Added Date"
    /// sort (lower = added earlier). None on tracks not sourced from a song sync.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_rank: Option<u32>,
    /// Defaulted on deserialize: Tracks round-trip through the frontend (e.g.
    /// `materialize_track`), whose TS type doesn't re-state playParams.
    #[serde(default)]
    pub play_params: PlayParams,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    pub title: String,
    pub artist_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    pub genres: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    /// Both optional, like Track: a library playlist has a library id; a catalog
    /// (editorial/curator) playlist from search has a catalog id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub curator_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    pub can_edit: bool,
    pub is_public: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_count: Option<u32>,
    /// Where the playlist lives: `"local"` (our SQLite store, fully editable) or
    /// `"apple"` (read-only mirror). None on plain catalog search results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Mirror classification (PLAYLISTS.md §2): `"user"` (canEdit), `"catalog"`
    /// (added editorial/curator list), `"smart"` (rule-based — rules never exposed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// An Apple radio station (STATIONS.md §2 — live / Discovery / genre / seeded).
/// Stations are opaque server-fed streams: there is NO track list to normalize —
/// `play_params` is what the radio-mode player wiring will hand to MusicKit.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    /// Catalog station id (`ra.…`; personalized ones are `ra.q-…`/`ra.u-…`).
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    /// Livestream (Apple Music 1 / Hits / …) — the UI shows a LIVE badge and the
    /// transport hides seek/skip in radio mode.
    pub is_live: bool,
    /// `editorialNotes.short` (falls back to `standard`) — the row tagline.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_rating: Option<String>,
    /// The music.apple.com share link — doubles as a fallback queue descriptor
    /// for the MusicKit station probe (player.ts setStationQueue).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Defaulted on deserialize: recents round-trip through the frontend, whose
    /// TS type doesn't re-state playParams (same doctrine as `Track`).
    #[serde(default)]
    pub play_params: PlayParams,
}

/// A station genre (`station-genres` — name only; its stations arrive via the
/// genre's `stations` relationship, fetched lazily per drill).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StationGenre {
    pub id: String,
    pub name: String,
}

/// A catalog artist's detail view: the artist + their releases + top songs.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub artist: Artist,
    pub albums: Vec<Album>,
    pub top_songs: Vec<Track>,
}

/// Normalized catalog search results, one bucket per category.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub playlists: Vec<Playlist>,
}

/// A page of results from a paged provider call.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u32,
    pub next_offset: Option<u32>,
}
