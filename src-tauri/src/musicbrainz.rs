mod cache;
pub(crate) mod releases;
mod status;
mod transport;

use cache::{Cache, Entity};
use serde::{Deserialize, Serialize};
use status::StatusHub;
use std::{collections::HashMap, path::PathBuf};
use tauri::{Emitter, Manager, State};
use tokio::{
    sync::{Mutex, MutexGuard},
    time::{timeout_at, Instant},
};
use transport::{Transport, LOOKUP_TIMEOUT};

const MAX_CATALOG_PAGES: usize = 3;
const MAX_ARTIST_QUERY_LENGTH: usize = 180;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumArtist {
    pub id: String,
    pub name: String,
    pub disambiguation: Option<String>,
    pub country: Option<String>,
    #[serde(rename = "artistType", alias = "type")]
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
    #[serde(rename = "firstReleaseDate", alias = "first-release-date", default)]
    pub first_release_date: String,
    #[serde(rename = "primaryType", alias = "primary-type")]
    pub primary_type: Option<String>,
    #[serde(rename = "secondaryTypes", alias = "secondary-types", default)]
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
    #[serde(rename = "trackCount", alias = "track-count")]
    pub track_count: Option<u32>,
    #[serde(default)]
    pub media: Vec<EditionMedium>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct EditionMedium {
    pub format: Option<String>,
    #[serde(rename = "trackCount", alias = "track-count")]
    pub track_count: Option<u32>,
}

type OfficialRelease = AlbumEdition;

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCatalog {
    pub artist_id: String,
    pub albums: Vec<AlbumReleaseGroup>,
    pub truncated: bool,
}

#[derive(Deserialize, Serialize)]
struct CachedTracklist {
    release_group_id: String,
    tracks: Vec<AlbumTrack>,
}

pub struct MusicBrainzClient {
    transport: Transport,
    cache: Cache,
    status: StatusHub,
    // Coalesce concurrent cache misses, including foreground and Wanted work.
    // Cache hits do not wait for network traffic.
    lookup_gate: Mutex<()>,
}

impl MusicBrainzClient {
    pub async fn filing_metadata(
        &self,
        group: &str,
        release: &str,
    ) -> Result<Vec<crate::connection::filing::TrackTags>, String> {
        if !is_musicbrainz_id(group) || !is_musicbrainz_id(release) {
            return Err("Choose a valid MusicBrainz group and edition.".into());
        }
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        let response: serde_json::Value = self
            .transport
            .get(
                &format!("/release/{release}"),
                &[
                    ("inc", "recordings+artist-credits+release-groups".into()),
                    ("fmt", "json".into()),
                ],
                deadline,
            )
            .await
            .map_err(|e| e.to_string())?;
        let validation: OfficialTracklistResponse =
            serde_json::from_value(response.clone()).map_err(|e| e.to_string())?;
        validate_edition(&validation, group)?;
        filing_track_tags(&response, group, release)
    }
    pub fn initialize(app: &tauri::AppHandle) -> Self {
        let app_handle = app.clone();
        let status = StatusHub::new(move |status| {
            let _ = app_handle.emit("forever://musicbrainz-status", status);
        });
        let path = match app.path().app_cache_dir() {
            Ok(directory) => Some(directory.join("musicbrainz-cache.sqlite3")),
            Err(error) => {
                status.cache_warning(format!(
                    "MusicBrainz disk cache unavailable; using a session cache. {error}"
                ));
                None
            }
        };
        Self::with_cache(path, status)
    }

    fn with_cache(path: Option<PathBuf>, status: StatusHub) -> Self {
        Self {
            transport: Transport::new(status.clone()),
            cache: Cache::new(path, status.clone()),
            status,
            lookup_gate: Mutex::new(()),
        }
    }

    async fn lookup_slot(&self, deadline: Instant) -> Result<MutexGuard<'_, ()>, String> {
        timeout_at(deadline, self.lookup_gate.lock())
            .await
            .map_err(|_| "MusicBrainz is busy with other lookups. Try again in a moment.".into())
    }

    pub async fn search_artists(&self, query: &str) -> Result<Vec<AlbumArtist>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Err("Enter an artist name to discover albums.".into());
        }
        if query.chars().count() > MAX_ARTIST_QUERY_LENGTH || query.chars().any(char::is_control) {
            return Err("Keep the artist name under 180 visible characters.".into());
        }
        let key = query.to_lowercase();
        if let Some(value) = self.cache.get(Entity::Artists, &key).await {
            return Ok(value);
        }
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        if let Some(value) = self.cache.get(Entity::Artists, &key).await {
            return Ok(value);
        }
        let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
        let response: ArtistSearchResponse = self
            .transport
            .get(
                "/artist",
                &[
                    ("query", format!("artist:\"{escaped}\"")),
                    ("fmt", "json".into()),
                    ("limit", "8".into()),
                ],
                deadline,
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut artists = response.artists;
        artists.sort_by_key(|artist| std::cmp::Reverse(artist.score));
        self.cache.put(Entity::Artists, &key, &artists).await;
        Ok(artists)
    }

    pub async fn catalog(&self, artist_id: &str) -> Result<AlbumCatalog, String> {
        let id = artist_id.trim().to_ascii_lowercase();
        if !is_musicbrainz_id(&id) {
            return Err("Choose a valid MusicBrainz artist before loading albums.".into());
        }
        if let Some(value) = self.cache.get(Entity::Catalog, &id).await {
            return Ok(value);
        }
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        if let Some(value) = self.cache.get(Entity::Catalog, &id).await {
            return Ok(value);
        }
        let mut albums = Vec::new();
        let mut total = 0;
        let mut offset = 0;
        for _ in 0..MAX_CATALOG_PAGES {
            let response: ReleaseGroupResponse = self
                .transport
                .get(
                    "/release-group",
                    &[
                        ("artist", id.clone()),
                        ("type", "album|ep".into()),
                        ("fmt", "json".into()),
                        ("limit", "100".into()),
                        ("offset", offset.to_string()),
                    ],
                    deadline,
                )
                .await
                .map_err(|e| e.to_string())?;
            total = response.count;
            let empty = response.release_groups.is_empty();
            let next = response
                .offset
                .saturating_add(response.release_groups.len());
            albums.extend(response.release_groups);
            if empty || next <= offset || next >= total {
                break;
            }
            offset = next;
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
        let mut seen = std::collections::HashSet::new();
        albums.retain(|album| seen.insert(album.id.clone()));
        let catalog = AlbumCatalog {
            artist_id: id.clone(),
            truncated: albums.len() < total,
            albums,
        };
        self.cache.put(Entity::Catalog, &id, &catalog).await;
        Ok(catalog)
    }

    pub async fn editions(&self, release_group_id: &str) -> Result<AlbumEditions, String> {
        let id = release_group_id.trim().to_ascii_lowercase();
        if !is_musicbrainz_id(&id) {
            return Err("Choose a valid MusicBrainz album before loading editions.".into());
        }
        if let Some(value) = self.cache.get(Entity::Editions, &id).await {
            return Ok(value);
        }
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        if let Some(value) = self.cache.get(Entity::Editions, &id).await {
            return Ok(value);
        }
        let mut releases = Vec::new();
        let mut offset = 0;
        let mut total = 0;
        for _ in 0..5 {
            let response: OfficialReleaseResponse = self
                .transport
                .get(
                    "/release",
                    &[
                        ("release-group", id.clone()),
                        ("status", "official".into()),
                        ("inc", "media".into()),
                        ("fmt", "json".into()),
                        ("limit", "100".into()),
                        ("offset", offset.to_string()),
                    ],
                    deadline,
                )
                .await
                .map_err(|e| e.to_string())?;
            total = response.count;
            let next = response.offset.saturating_add(response.releases.len());
            let stalled = response.releases.is_empty() || next <= offset;
            releases.extend(response.releases);
            offset = next;
            if stalled || offset >= total {
                break;
            }
        }
        let editions = prepare_editions(releases, offset < total);
        self.cache.put(Entity::Editions, &id, &editions).await;
        Ok(editions)
    }

    pub async fn official_track_count(
        &self,
        release_group_id: &str,
    ) -> Result<Option<u32>, String> {
        Ok(canonical_track_count(
            &self.editions(release_group_id).await?.releases,
        ))
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
        let group = release_group_id.to_ascii_lowercase();
        let selected = match release_id {
            Some(id) => id.to_ascii_lowercase(),
            None => self
                .editions(&group)
                .await?
                .default_release_id
                .ok_or("MusicBrainz has no official tracklist for this album yet.")?,
        }
        .to_ascii_lowercase();
        if let Some(value) = self.cached_tracks(&selected, &group).await? {
            return Ok(value);
        }
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        if let Some(value) = self.cached_tracks(&selected, &group).await? {
            return Ok(value);
        }
        let response: OfficialTracklistResponse = self
            .transport
            .get(
                &format!("/release/{selected}"),
                &[
                    ("inc", "recordings+release-groups".into()),
                    ("fmt", "json".into()),
                ],
                deadline,
            )
            .await
            .map_err(|e| e.to_string())?;
        validate_edition(&response, &group)?;
        let tracks = flatten_official_tracklist(response);
        if tracks.is_empty() {
            return Err(
                "MusicBrainz returned an empty official tracklist for this edition.".into(),
            );
        }
        self.cache
            .put(
                Entity::Tracklist,
                &selected,
                &CachedTracklist {
                    release_group_id: group,
                    tracks: tracks.clone(),
                },
            )
            .await;
        Ok(tracks)
    }

    async fn cached_tracks(
        &self,
        release: &str,
        group: &str,
    ) -> Result<Option<Vec<AlbumTrack>>, String> {
        match self
            .cache
            .get::<CachedTracklist>(Entity::Tracklist, release)
            .await
        {
            Some(value) if !value.release_group_id.eq_ignore_ascii_case(group) => {
                Err("This official edition does not belong to the selected album.".into())
            }
            Some(value) if !value.tracks.is_empty() => Ok(Some(value.tracks)),
            _ => Ok(None),
        }
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

fn filing_track_tags(
    response: &serde_json::Value,
    group: &str,
    release: &str,
) -> Result<Vec<crate::connection::filing::TrackTags>, String> {
    fn credit(value: &serde_json::Value) -> String {
        value
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| {
                format!(
                    "{}{}",
                    c["name"]
                        .as_str()
                        .or_else(|| c["artist"]["name"].as_str())
                        .unwrap_or(""),
                    c["joinphrase"].as_str().unwrap_or("")
                )
            })
            .collect()
    }
    let album_artist = credit(&response["artist-credit"]);
    let mut result = Vec::new();
    for medium in response["media"].as_array().into_iter().flatten() {
        for track in medium["tracks"].as_array().into_iter().flatten() {
            let artist = credit(&track["artist-credit"]);
            result.push(crate::connection::filing::TrackTags {
                title: track["title"].as_str().unwrap_or("").into(),
                artist: if artist.is_empty() {
                    album_artist.clone()
                } else {
                    artist
                },
                album_artist: album_artist.clone(),
                album: response["title"].as_str().unwrap_or("").into(),
                date: response["date"].as_str().unwrap_or("").into(),
                disc: medium["position"].as_u64().unwrap_or(1) as u32,
                track: track["position"].as_u64().unwrap_or(1) as u32,
                release_group_id: Some(group.into()),
                release_id: Some(release.into()),
                recording_id: track["recording"]["id"].as_str().map(str::to_owned),
            });
        }
    }
    result.sort_by_key(|t| (t.disc, t.track));
    if result.is_empty() || result.len() > 500 {
        return Err("This edition has no usable tracklist (maximum 500 tracks).".into());
    }
    Ok(result)
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

#[tauri::command]
pub fn musicbrainz_status(client: State<'_, MusicBrainzClient>) -> status::ClientStatus {
    client.status.snapshot()
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
    fn filing_metadata_preserves_disc_positions_track_credits_and_recording_identity() {
        let response = serde_json::json!({"title":"Album", "date":"2001-02", "artist-credit":[{"name":"Album Artist"}], "media":[
            {"position":2,"tracks":[{"position":1,"title":"Second Disc", "artist-credit":[{"name":"Guest", "joinphrase":" & "},{"name":"Singer"}], "recording":{"id":"recording-two"}}]},
            {"position":1,"tracks":[{"position":1,"title":"First Disc", "recording":{"id":"recording-one"}}]}
        ]});
        let tags = filing_track_tags(&response, "group", "release").unwrap();
        assert_eq!(tags[0].disc, 1);
        assert_eq!(tags[1].disc, 2);
        assert_eq!(tags[1].track, 1);
        assert_eq!(tags[0].artist, "Album Artist");
        assert_eq!(tags[1].artist, "Guest & Singer");
        assert_eq!(tags[1].album_artist, "Album Artist");
        assert_eq!(tags[1].recording_id.as_deref(), Some("recording-two"));
        assert_eq!(tags[0].date, "2001-02");
        assert_eq!(tags[0].release_id.as_deref(), Some("release"));
    }

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
        let client = MusicBrainzClient::with_cache(None, StatusHub::default());

        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
        assert!(client.transport.is_ready());
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
