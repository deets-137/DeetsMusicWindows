//! The provider boundary. A `MusicProvider` knows how to talk to one service
//! (Apple Music, later Spotify) and returns our normalized model. The rest of the
//! app is provider-agnostic. Methods grow as we implement more of the library.

use crate::model::{Page, Track};

#[allow(async_fn_in_trait)]
pub trait MusicProvider {
    /// One page of the user's library songs, normalized to our `Track`.
    async fn songs_page(&self, offset: u32, limit: u32) -> Result<Page<Track>, String>;
}
