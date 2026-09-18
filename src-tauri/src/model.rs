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
    /// Apple's `composerName`: the writers as ONE flat string, with no roles
    /// ("JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli & Saya Gray").
    /// It rides every catalog song read at no extra call (docs/CREDITS.md).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composer: Option<String>,
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
    /// Catalog genre names (the Search artist hero's meta line; ARTIST-VIEW.md §1).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
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
    /// Manual folder membership (playlist_folder_members) — stamped fresh by
    /// `playlists_cached` on every read, never persisted into cached json.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<i64>,
    /// Up to four distinct track-cover templates for the derived 2×2 mosaic
    /// (NEXT-VERSION §2), stamped by `playlists_cached` when `artwork` is absent and
    /// the tracks are cached locally. Never persisted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_urls: Option<Vec<String>>,
    /// A LOCAL playlist's latest Apple Music copy (PLAYLISTS.md §6) and when it was
    /// last written (ms). Stamped by `playlists_cached`; never persisted in mirror json.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_apple_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<i64>,
    /// A LOCAL playlist's role: `"replay"` = made from listening (PLAYLISTS.md §10.8), not
    /// an add target and not editable by hand. None = a hand-made playlist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// A temporary web playlist's days (PLAYLIST-WEB.md §10). None = kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expire_days: Option<u32>,
    /// When a temporary playlist goes (epoch-ms): the later of its creation and its last play,
    /// plus its days.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
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

/// A minimal `{id, name}` handle for a resolved catalog entity — the payload of the
/// search card's drill-in hops ("Go to Artist" / "Go to Album"). `name` lets the
/// target pane title itself accurately (the resolved artist, not the song's display
/// artist string which may carry features).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NamedRef {
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
    /// Apple's playlists that feature the artist (`views=featured-playlists`).
    pub featured_playlists: Vec<Playlist>,
}

/// What the Library artist view knows about a library artist NAME (ARTIST-VIEW.md §4):
/// the catalog id + photo (resolved once from one of their songs) and the featured
/// playlists (refreshed after 7 days or the Library ⟳). Read from `artist_catalog`.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryArtistInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub featured_playlists: Option<Vec<Playlist>>,
    /// Apple's top songs for the artist, most popular first (the Library "Popular" sort).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_songs: Option<Vec<Track>>,
}

/// Every stored playlist's songs, for "Your Playlists" matching — zero Apple calls.
/// `unchecked` = Apple mirror playlists whose songs were never fetched.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSongIndex {
    pub lists: Vec<PlaylistSongs>,
    pub unchecked: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSongs {
    /// The playlist's front-end key: `local:{rowid}` or the Apple library id.
    pub key: String,
    pub tracks: Vec<Track>,
}

/// Normalized catalog search results, one bucket per category.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<Track>,
    pub albums: Vec<Album>,
    pub artists: Vec<Artist>,
    pub playlists: Vec<Playlist>,
    /// Catalog stations (`ra.…`) — the Radio card's model; a tap plays (STATIONS.md §1).
    pub stations: Vec<Station>,
}

/// A page of results from a paged provider call.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u32,
    pub next_offset: Option<u32>,
}

/// What Apple says this account added last, across every device (HOME.md §9.2).
/// Albums and playlists both carry a real `dateAdded`, so the two lists merge onto
/// one true order in the front end. Songs are absent on purpose: Apple groups them
/// into their albums before it answers.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentAdded {
    pub albums: Vec<Album>,
    pub playlists: Vec<Playlist>,
}
