use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::{Mutex, RwLock};

const MUSICBRAINZ_API: &str = "https://musicbrainz.org/ws/2";
const USER_AGENT: &str = "Forever/0.0.61 (https://github.com/soundtrackgeek/forever)";
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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct AlbumEdition {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub date: String,
    pub country: Option<String>,
    #[serde(default)]
    pub disambiguation: String,
    #[serde(rename(deserialize = "track-count", serialize = "trackCount"))]
    pub track_count: Option<u32>,
    #[serde(default)]
    pub media: Vec<EditionMedium>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct EditionMedium {
    pub format: Option<String>,
    #[serde(rename(deserialize = "track-count", serialize = "trackCount"))]
    pub track_count: Option<u32>,
}

type OfficialRelease = AlbumEdition;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumEditions {
    pub releases: Vec<AlbumEdition>,
    pub default_release_id: Option<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialReleaseResponse {
    #[serde(rename = "release-count")]
    count: usize,
    #[serde(rename = "release-offset", default)]
    offset: usize,
    releases: Vec<OfficialRelease>,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialTracklistResponse {
    #[serde(rename = "release-group")]
    release_group: Option<ReleaseGroupIdentity>,
    status: Option<String>,
    #[serde(default)]
    media: Vec<OfficialMedium>,
}

#[derive(Clone, Debug, Deserialize)]
struct ReleaseGroupIdentity {
    id: String,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialMedium {
    #[serde(default)]
    position: u32,
    #[serde(default)]
    tracks: Vec<OfficialTrack>,
}

#[derive(Clone, Debug, Deserialize)]
struct OfficialTrack {
    #[serde(default)]
    position: u32,
    title: String,
    #[serde(default)]
    length: Option<u32>,
}

pub use forever_matching::AlbumTrack;

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
    edition_cache: RwLock<HashMap<String, CacheEntry<AlbumEditions>>>,
    tracklist_cache: RwLock<HashMap<String, CacheEntry<Vec<AlbumTrack>>>>,
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
            edition_cache: RwLock::new(HashMap::new()),
            tracklist_cache: RwLock::new(HashMap::new()),
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

    pub async fn editions(&self, release_group_id: &str) -> Result<AlbumEditions, String> {
        let id = release_group_id.trim();
        if !is_musicbrainz_id(id) {
            return Err("Choose a valid MusicBrainz album before loading editions.".into());
        }
        if let Some(cached) = self.edition_cache.read().await.get(id) {
            if cached.stored_at.elapsed() <= CACHE_TTL {
                return Ok(cached.value.clone());
            }
        }
        let mut releases = Vec::new();
        let mut offset = 0;
        let mut total = 0;
        // Bounded browse: at most 500 official editions. Expose incomplete lists.
        for _ in 0..5 {
            self.wait_for_request_slot().await;
            let response = self
                .client()?
                .get(format!("{MUSICBRAINZ_API}/release"))
                .query(&[
                    ("release-group", id.to_owned()),
                    ("status", "official".into()),
                    ("inc", "media".into()),
                    ("fmt", "json".into()),
                    ("limit", "100".into()),
                    ("offset", offset.to_string()),
                ])
                .send()
                .await
                .map_err(request_error)?
                .error_for_status()
                .map_err(request_error)?
                .json::<OfficialReleaseResponse>()
                .await
                .map_err(request_error)?;
            total = response.count;
            let empty = response.releases.is_empty();
            offset = response.offset + response.releases.len();
            releases.extend(response.releases);
            if empty || offset >= total {
                break;
            }
        }
        let editions = prepare_editions(releases, offset < total);
        let mut cache = self.edition_cache.write().await;
        trim_cache(&mut cache, id, MAX_TRACK_COUNT_CACHE_ENTRIES);
        cache.insert(
            id.into(),
            CacheEntry {
                stored_at: Instant::now(),
                value: editions.clone(),
            },
        );
        Ok(editions)
    }

    pub async fn official_track_count(
        &self,
        release_group_id: &str,
    ) -> Result<Option<u32>, String> {
        let editions = self.editions(release_group_id).await?;
        Ok(canonical_track_count(&editions.releases))
    }

    pub async fn edition_tracklist(
        &self,
        release_group_id: &str,
        release_id: Option<&str>,
    ) -> Result<Vec<AlbumTrack>, String> {
        if !is_musicbrainz_id(release_group_id)
            || release_id.is_some_and(|id| !is_musicbrainz_id(id))
        {
            return Err("Choose a valid MusicBrainz album and edition.".into());
        }
        let selected = match release_id {
            Some(id) => id.to_owned(),
            None => self
                .editions(release_group_id)
                .await?
                .default_release_id
                .ok_or("MusicBrainz has no official tracklist for this album yet.")?,
        };
        let key = format!("{release_group_id}/{selected}");
        if let Some(cached) = self.tracklist_cache.read().await.get(&key) {
            if cached.stored_at.elapsed() <= CACHE_TTL {
                return Ok(cached.value.clone());
            }
        }
        self.wait_for_request_slot().await;
        let response = self
            .client()?
            .get(format!("{MUSICBRAINZ_API}/release/{selected}"))
            .query(&[("inc", "recordings+release-groups"), ("fmt", "json")])
            .send()
            .await
            .map_err(request_error)?
            .error_for_status()
            .map_err(request_error)?
            .json::<OfficialTracklistResponse>()
            .await
            .map_err(request_error)?;
        validate_edition(&response, release_group_id)?;
        let tracks = flatten_official_tracklist(response);
        if tracks.is_empty() {
            return Err(
                "MusicBrainz returned an empty official tracklist for this edition.".into(),
            );
        }
        let mut cache = self.tracklist_cache.write().await;
        trim_cache(&mut cache, &key, MAX_TRACK_COUNT_CACHE_ENTRIES);
        cache.insert(
            key,
            CacheEntry {
                stored_at: Instant::now(),
                value: tracks.clone(),
            },
        );
        Ok(tracks)
    }
}

fn validate_edition(response: &OfficialTracklistResponse, group: &str) -> Result<(), String> {
    if response
        .release_group
        .as_ref()
        .is_none_or(|r| !r.id.eq_ignore_ascii_case(group))
        || response.status.as_deref() != Some("Official")
    {
        return Err("This official edition does not belong to the selected album.".into());
    }
    Ok(())
}

fn prepare_editions(mut releases: Vec<AlbumEdition>, truncated: bool) -> AlbumEditions {
    for release in &mut releases {
        if release.track_count.is_none()
            && !release.media.is_empty()
            && release.media.iter().all(|m| m.track_count.is_some())
        {
            release.track_count = Some(
                release
                    .media
                    .iter()
                    .filter_map(|m| m.track_count)
                    .fold(0u32, u32::saturating_add),
            );
        }
    }
    releases.retain(|r| is_musicbrainz_id(&r.id));
    releases.sort_by(|a, b| {
        a.date
            .is_empty()
            .cmp(&b.date.is_empty())
            .then(a.date.cmp(&b.date))
            .then(a.id.cmp(&b.id))
    });
    let mut seen = std::collections::HashSet::new();
    releases.retain(|r| seen.insert(r.id.clone()));
    let count = canonical_track_count(&releases);
    let default_release_id = releases
        .iter()
        .find(|r| count.is_none() || r.track_count == count)
        .map(|r| r.id.clone());
    AlbumEditions {
        releases,
        default_release_id,
        truncated,
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

fn flatten_official_tracklist(mut response: OfficialTracklistResponse) -> Vec<AlbumTrack> {
    response.media.sort_by_key(|medium| medium.position);
    let mut position = 0_u32;
    let mut tracks = Vec::new();
    for medium in response.media {
        let disc_number = medium.position.max(1);
        let mut medium_tracks = medium.tracks;
        medium_tracks.sort_by_key(|track| track.position);
        for track in medium_tracks {
            position = position.saturating_add(1);
            tracks.push(AlbumTrack {
                position,
                disc_number,
                disc_position: track.position.max(1),
                title: track.title,
                duration_ms: track.length,
            });
        }
    }
    tracks
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

pub(crate) fn is_musicbrainz_id(value: &str) -> bool {
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

#[tauri::command]
pub async fn album_official_tracklist(
    client: State<'_, MusicBrainzClient>,
    release_group_id: String,
    release_id: Option<String>,
) -> Result<Vec<AlbumTrack>, String> {
    client
        .edition_tracklist(&release_group_id, release_id.as_deref())
        .await
}

#[tauri::command]
pub async fn album_editions(
    client: State<'_, MusicBrainzClient>,
    release_group_id: String,
) -> Result<AlbumEditions, String> {
    client.editions(&release_group_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edition_catalog_uses_media_counts_and_keeps_region_and_version_labels() {
        let response: OfficialReleaseResponse = serde_json::from_value(serde_json::json!({
            "release-count": 501, "release-offset": 100, "releases": [
                {"id":"11111111-1111-1111-1111-111111111111", "title":"Album", "date":"2001",
                 "country":"US", "disambiguation":"deluxe remaster",
                 "media":[{"format":"CD","track-count":10},{"format":"CD","track-count":5}]},
                {"id":"22222222-2222-2222-2222-222222222222", "title":"Album", "date":"1990",
                 "country":"GB", "media":[{"format":"CD","track-count":10}]}
            ]
        }))
        .unwrap();
        assert_eq!(response.offset, 100);
        assert_eq!(response.count, 501);
        let catalog = prepare_editions(response.releases, true);
        assert!(catalog.truncated);
        assert_eq!(
            catalog.default_release_id.as_deref(),
            Some("22222222-2222-2222-2222-222222222222")
        );
        assert_eq!(catalog.releases[1].track_count, Some(15));
        assert_eq!(catalog.releases[1].disambiguation, "deluxe remaster");
        assert_eq!(
            serde_json::to_value(&catalog).unwrap()["releases"][1]["trackCount"],
            15
        );
    }

    #[test]
    fn selected_edition_must_be_official_and_belong_to_the_album() {
        let mut response: OfficialTracklistResponse = serde_json::from_value(serde_json::json!({
            "status":"Official", "release-group":{"id":"group"}, "media":[]
        }))
        .unwrap();
        assert!(validate_edition(&response, "group").is_ok());
        assert!(validate_edition(&response, "another").is_err());
        response.status = Some("Bootleg".into());
        assert!(validate_edition(&response, "group").is_err());
    }

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
                id: "release-one".to_owned(),
                date: "1987-08-03".to_owned(),
                track_count: Some(12),
                ..Default::default()
            },
            OfficialRelease {
                id: "release-two".to_owned(),
                date: "1987-09-01".to_owned(),
                track_count: Some(12),
                ..Default::default()
            },
            OfficialRelease {
                id: "release-three".to_owned(),
                date: "2006-01-01".to_owned(),
                track_count: Some(16),
                ..Default::default()
            },
        ];
        assert_eq!(canonical_track_count(&releases), Some(12));
    }

    #[test]
    fn flattens_official_multidisc_tracklists_in_play_order() {
        let response = serde_json::from_str::<OfficialTracklistResponse>(
            r#"{
              "media": [
                {"position": 2, "tracks": [{"position": 1, "title": "Second disc", "length": 230000}]},
                {"position": 1, "tracks": [
                  {"position": 2, "title": "Track two", "length": 220000},
                  {"position": 1, "title": "Track one", "length": 210000}
                ]}
              ]
            }"#,
        )
        .unwrap();

        let tracks = flatten_official_tracklist(response);
        assert_eq!(
            tracks
                .iter()
                .map(|track| (
                    track.position,
                    track.disc_number,
                    track.disc_position,
                    track.title.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                (1, 1, 1, "Track one"),
                (2, 1, 2, "Track two"),
                (3, 2, 1, "Second disc"),
            ]
        );
    }
}
