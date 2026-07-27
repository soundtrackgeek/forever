use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::{Mutex, RwLock};

const MUSICBRAINZ_API: &str = "https://musicbrainz.org/ws/2";
const USER_AGENT: &str = "Forever/0.0.43 (https://github.com/soundtrackgeek/forever)";
const REQUEST_INTERVAL: Duration = Duration::from_millis(1_050);
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_CATALOG_PAGES: usize = 3;
const MAX_ARTIST_CACHE_ENTRIES: usize = 64;
const MAX_CATALOG_CACHE_ENTRIES: usize = 32;
const MAX_TRACK_COUNT_CACHE_ENTRIES: usize = 128;
const MAX_ARTIST_QUERY_LENGTH: usize = 180;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumArtist {
    pub id: String,
    pub name: String,
    pub disambiguation: Option<String>,
    pub country: Option<String>,
    #[serde(rename(deserialize = "type", serialize = "artistType"))]
    pub artist_type: Option<String>,
    pub score: u8,
}

#[derive(Clone, Debug, Deserialize)]
struct ArtistSearchResponse {
    artists: Vec<AlbumArtist>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumReleaseGroup {
    pub id: String,
    pub title: String,
    #[serde(
        rename(deserialize = "first-release-date", serialize = "firstReleaseDate"),
        default
    )]
    pub first_release_date: String,
    #[serde(rename(deserialize = "primary-type", serialize = "primaryType"))]
    pub primary_type: Option<String>,
    #[serde(
        rename(deserialize = "secondary-types", serialize = "secondaryTypes"),
        default
    )]
    pub secondary_types: Vec<String>,
    #[serde(default)]
    pub cover_art_url: String,
}

#[derive(Clone, Debug, Deserialize)]
struct ReleaseGroupResponse {
    #[serde(rename = "release-group-count")]
    count: usize,
    #[serde(rename = "release-group-offset")]
    offset: usize,
    #[serde(rename = "release-groups")]
    release_groups: Vec<AlbumReleaseGroup>,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialRelease {
    #[serde(default)]
    date: String,
    #[serde(rename = "track-count")]
    track_count: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialReleaseResponse {
    releases: Vec<OfficialRelease>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCatalog {
    pub artist_id: String,
    pub albums: Vec<AlbumReleaseGroup>,
    pub truncated: bool,
}

#[derive(Clone)]
struct CacheEntry<T> {
    stored_at: Instant,
    value: T,
}

pub struct MusicBrainzClient {
    client: Result<reqwest::Client, String>,
    request_gate: Arc<Mutex<Instant>>,
    artist_cache: RwLock<HashMap<String, CacheEntry<Vec<AlbumArtist>>>>,
    catalog_cache: RwLock<HashMap<String, CacheEntry<AlbumCatalog>>>,
    track_count_cache: RwLock<HashMap<String, CacheEntry<Option<u32>>>>,
}

impl MusicBrainzClient {
    pub fn new() -> Self {
        // Reqwest's rustls-no-provider feature deliberately panics while building a
        // client unless the host application installs a provider first. Keep that
        // requirement beside the only client that needs it so startup ordering
        // cannot accidentally regress again.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| format!("Could not prepare album discovery: {error}"));
        Self {
            client,
            request_gate: Arc::new(Mutex::new(
                Instant::now()
                    .checked_sub(REQUEST_INTERVAL)
                    .unwrap_or_else(Instant::now),
            )),
            artist_cache: RwLock::new(HashMap::new()),
            catalog_cache: RwLock::new(HashMap::new()),
            track_count_cache: RwLock::new(HashMap::new()),
        }
    }

    fn client(&self) -> Result<&reqwest::Client, String> {
        self.client.as_ref().map_err(Clone::clone)
    }

    async fn wait_for_request_slot(&self) {
        let mut previous = self.request_gate.lock().await;
        let remaining = REQUEST_INTERVAL.saturating_sub(previous.elapsed());
        if !remaining.is_zero() {
            tokio::time::sleep(remaining).await;
        }
        *previous = Instant::now();
    }

    pub async fn search_artists(&self, query: &str) -> Result<Vec<AlbumArtist>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Err("Enter an artist name to discover albums.".to_owned());
        }
        if query.chars().count() > MAX_ARTIST_QUERY_LENGTH || query.chars().any(char::is_control) {
            return Err("Keep the artist name under 180 visible characters.".to_owned());
        }
        let cache_key = query.to_lowercase();
        if let Some(cached) = self.artist_cache.read().await.get(&cache_key) {
            if cached.stored_at.elapsed() <= CACHE_TTL {
                return Ok(cached.value.clone());
            }
        }

        self.wait_for_request_slot().await;
        let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
        let response = self
            .client()?
            .get(format!("{MUSICBRAINZ_API}/artist"))
            .query(&[
                ("query", format!("artist:\"{escaped}\"")),
                ("fmt", "json".to_owned()),
                ("limit", "8".to_owned()),
            ])
            .send()
            .await
            .map_err(request_error)?
            .error_for_status()
            .map_err(request_error)?
            .json::<ArtistSearchResponse>()
            .await
            .map_err(request_error)?;
        let mut artists = response.artists;
        artists.sort_by_key(|artist| std::cmp::Reverse(artist.score));
        let mut cache = self.artist_cache.write().await;
        trim_cache(&mut cache, &cache_key, MAX_ARTIST_CACHE_ENTRIES);
        cache.insert(
            cache_key,
            CacheEntry {
                stored_at: Instant::now(),
                value: artists.clone(),
            },
        );
        Ok(artists)
    }

    pub async fn catalog(&self, artist_id: &str) -> Result<AlbumCatalog, String> {
        let artist_id = artist_id.trim();
        if !is_musicbrainz_id(artist_id) {
            return Err("Choose a valid MusicBrainz artist before loading albums.".to_owned());
        }
        if let Some(cached) = self.catalog_cache.read().await.get(artist_id) {
            if cached.stored_at.elapsed() <= CACHE_TTL {
                return Ok(cached.value.clone());
            }
        }

        let mut albums = Vec::new();
        let mut total = 0_usize;
        let mut offset = 0_usize;
        for _ in 0..MAX_CATALOG_PAGES {
            self.wait_for_request_slot().await;
            let response = self
                .client()?
                .get(format!("{MUSICBRAINZ_API}/release-group"))
                .query(&[
                    ("artist", artist_id.to_owned()),
                    ("type", "album|ep".to_owned()),
                    ("fmt", "json".to_owned()),
                    ("limit", "100".to_owned()),
                    ("offset", offset.to_string()),
                ])
                .send()
                .await
                .map_err(request_error)?
                .error_for_status()
                .map_err(request_error)?
                .json::<ReleaseGroupResponse>()
                .await
                .map_err(request_error)?;
            total = response.count;
            offset = response.offset + response.release_groups.len();
            albums.extend(response.release_groups);
            if offset >= total {
                break;
            }
        }

        for album in &mut albums {
            album.cover_art_url = format!(
                "https://coverartarchive.org/release-group/{}/front-250",
                album.id
            );
        }
        albums.sort_by(|left, right| {
            left.first_release_date
                .is_empty()
                .cmp(&right.first_release_date.is_empty())
                .then_with(|| left.first_release_date.cmp(&right.first_release_date))
                .then_with(|| left.title.cmp(&right.title))
        });
        albums.dedup_by(|left, right| left.id == right.id);
        let catalog = AlbumCatalog {
            artist_id: artist_id.to_owned(),
            truncated: albums.len() < total,
            albums,
        };
        let mut cache = self.catalog_cache.write().await;
        trim_cache(&mut cache, artist_id, MAX_CATALOG_CACHE_ENTRIES);
        cache.insert(
            artist_id.to_owned(),
            CacheEntry {
                stored_at: Instant::now(),
                value: catalog.clone(),
            },
        );
        Ok(catalog)
    }

    pub async fn official_track_count(
        &self,
        release_group_id: &str,
    ) -> Result<Option<u32>, String> {
        let release_group_id = release_group_id.trim();
        if !is_musicbrainz_id(release_group_id) {
            return Err(
                "Choose a valid MusicBrainz album before loading its track count.".to_owned(),
            );
        }
        if let Some(cached) = self.track_count_cache.read().await.get(release_group_id) {
            if cached.stored_at.elapsed() <= CACHE_TTL {
                return Ok(cached.value);
            }
        }

        self.wait_for_request_slot().await;
        let response = self
            .client()?
            .get(format!("{MUSICBRAINZ_API}/release"))
            .query(&[
                ("release-group", release_group_id.to_owned()),
                ("status", "official".to_owned()),
                ("fmt", "json".to_owned()),
                ("limit", "100".to_owned()),
            ])
            .send()
            .await
            .map_err(request_error)?
            .error_for_status()
            .map_err(request_error)?
            .json::<OfficialReleaseResponse>()
            .await
            .map_err(request_error)?;
        let track_count = canonical_track_count(&response.releases);
        let mut cache = self.track_count_cache.write().await;
        trim_cache(&mut cache, release_group_id, MAX_TRACK_COUNT_CACHE_ENTRIES);
        cache.insert(
            release_group_id.to_owned(),
            CacheEntry {
                stored_at: Instant::now(),
                value: track_count,
            },
        );
        Ok(track_count)
    }
}

fn canonical_track_count(releases: &[OfficialRelease]) -> Option<u32> {
    let earliest_date = releases
        .iter()
        .filter(|release| release.track_count.is_some() && !release.date.is_empty())
        .map(|release| release.date.as_str())
        .min();
    let mut counts = HashMap::<u32, usize>::new();
    for release in releases.iter().filter(|release| {
        release.track_count.is_some()
            && earliest_date.is_none_or(|date| release.date.starts_with(&date[..date.len().min(4)]))
    }) {
        *counts
            .entry(release.track_count.unwrap_or_default())
            .or_default() += 1;
    }
    counts
        .into_iter()
        .max_by(
            |(left_count, left_frequency), (right_count, right_frequency)| {
                left_frequency
                    .cmp(right_frequency)
                    .then_with(|| right_count.cmp(left_count))
            },
        )
        .map(|(count, _)| count)
}

fn trim_cache<T>(cache: &mut HashMap<String, CacheEntry<T>>, incoming: &str, limit: usize) {
    if cache.len() < limit || cache.contains_key(incoming) {
        return;
    }
    let oldest = cache
        .iter()
        .max_by_key(|(_, entry)| entry.stored_at.elapsed())
        .map(|(key, _)| key.clone());
    if let Some(key) = oldest {
        cache.remove(&key);
    }
}

fn is_musicbrainz_id(value: &str) -> bool {
    let sections: Vec<_> = value.split('-').collect();
    sections.len() == 5
        && sections
            .iter()
            .zip([8_usize, 4, 4, 4, 12])
            .all(|(section, length)| {
                section.len() == length
                    && section
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            })
}

fn request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "MusicBrainz took too long to answer. Try again in a moment.".to_owned()
    } else if error.is_connect() {
        "Forever could not reach MusicBrainz. Check your internet connection.".to_owned()
    } else {
        format!("MusicBrainz could not complete album discovery: {error}")
    }
}

#[tauri::command]
pub async fn album_artists_search(
    client: State<'_, MusicBrainzClient>,
    query: String,
) -> Result<Vec<AlbumArtist>, String> {
    client.search_artists(&query).await
}

#[tauri::command]
pub async fn album_catalog(
    client: State<'_, MusicBrainzClient>,
    artist_id: String,
) -> Result<AlbumCatalog, String> {
    client.catalog(&artist_id).await
}

#[tauri::command]
pub async fn album_official_track_count(
    client: State<'_, MusicBrainzClient>,
    release_group_id: String,
) -> Result<Option<u32>, String> {
    client.official_track_count(&release_group_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_musicbrainz_release_groups() {
        let response: ReleaseGroupResponse = serde_json::from_str(
            r#"{
              "release-group-count": 1,
              "release-group-offset": 0,
              "release-groups": [{
                "id": "album-id",
                "title": "Hysteria",
                "first-release-date": "1987-08-03",
                "primary-type": "Album",
                "secondary-types": []
              }]
            }"#,
        )
        .unwrap();
        assert_eq!(response.count, 1);
        assert_eq!(response.offset, 0);
        assert_eq!(response.release_groups[0].title, "Hysteria");
        assert_eq!(
            response.release_groups[0].primary_type.as_deref(),
            Some("Album")
        );
    }

    #[test]
    fn parses_artist_disambiguation_fields() {
        let response: ArtistSearchResponse = serde_json::from_str(
            r#"{"artists":[{"id":"artist-id","name":"Forever","score":100,"type":"Group","country":"NO"}]}"#,
        )
        .unwrap();
        assert_eq!(response.artists[0].country.as_deref(), Some("NO"));
        assert_eq!(response.artists[0].artist_type.as_deref(), Some("Group"));
    }

    #[test]
    fn validates_musicbrainz_ids_before_network_requests() {
        assert!(is_musicbrainz_id("7249b899-8db8-43e7-9e6e-22f1e736024e"));
        assert!(!is_musicbrainz_id("../../not-an-artist"));
        assert!(!is_musicbrainz_id("7249b899-8db8-43e7-9e6e"));
    }

    #[test]
    fn constructs_the_album_client_with_a_tls_provider() {
        let client = MusicBrainzClient::new();

        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
        assert!(client.client.is_ok());
    }

    #[test]
    fn chooses_the_common_track_count_from_the_earliest_official_year() {
        let releases = vec![
            OfficialRelease {
                date: "1987-08-03".to_owned(),
                track_count: Some(12),
            },
            OfficialRelease {
                date: "1987-09-01".to_owned(),
                track_count: Some(12),
            },
            OfficialRelease {
                date: "2006-01-01".to_owned(),
                track_count: Some(16),
            },
        ];
        assert_eq!(canonical_track_count(&releases), Some(12));
    }
}
