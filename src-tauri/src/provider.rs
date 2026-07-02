//! The provider boundary. A `MusicProvider` knows how to talk to one service
//! (Apple Music, later Spotify) and returns our normalized model. The rest of the
//! app is provider-agnostic. Methods grow as we implement more of the library.

use crate::model::{Page, SearchResults, Track};

#[allow(async_fn_in_trait)]
pub trait MusicProvider {
    /// One page of the user's library songs, normalized to our `Track`.
    async fn songs_page(&self, offset: u32, limit: u32) -> Result<Page<Track>, String>;

    /// Catalog search across the given categories (a subset of
    /// songs/albums/artists/playlists), normalized per bucket. `sf` is the cached
    /// storefront id; `limit` applies per category.
    async fn search(
        &self,
        sf: &str,
        term: &str,
        types: &[String],
        limit: u32,
    ) -> Result<SearchResults, String>;
}
