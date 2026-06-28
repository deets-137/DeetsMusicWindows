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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// When the user added this song to their library (ISO 8601). Drives the
    /// "Added Date" sort. Library-only — absent on pure-catalog tracks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
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
    pub library_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<Artwork>,
    pub can_edit: bool,
    pub is_public: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
}

/// A page of results from a paged provider call.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u32,
    pub next_offset: Option<u32>,
}
