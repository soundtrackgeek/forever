use super::album_query::{next_token, AlbumIdentity, AlbumQueryPlan, QueryMemory};
use super::protocol::SearchResponse;
use super::search_governor::{SearchGovernor, SearchLane, SEARCH_SPACING};
use super::store::{self, DecodeError, JsonFile};
use crate::matching::{self, RankingSource, RankingTrack};
use crate::musicbrainz::{AlbumTrack, MusicBrainzClient};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{atomic::AtomicU32, Arc, Mutex, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

pub const WANTED_EVENT: &str = "forever://wanted";
const STORE_VERSION: u32 = 4;
const DEFAULT_INTERVAL_MINUTES: u32 = 30;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_WANTED_ALBUMS: usize = 500;
const MAX_BULK_WANTED_ALBUMS: usize = 100;
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedAlbumRequest {
    pub album_id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
    pub cover_art_url: Option<String>,
    #[serde(default)]
    pub minimum_track_count: Option<u32>,
}

#[cfg(test)]
use forever_matching::WantedFormatPreference;
pub use forever_matching::WantedPreferences;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedBestSource {
    pub username: String,
    pub folder: String,
    pub format: String,
    pub track_count: u32,
    pub size_bytes: u64,
    pub slot_free: bool,
    pub average_speed_bytes_per_second: u32,
    pub queue_length: u32,
    pub minimum_bitrate_kbps: Option<u32>,
    pub score: u32,
    #[serde(default)]
    pub tracklist_label: String,
    #[serde(default)]
    pub folders: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedFulfillmentRequest {
    pub album_id: String,
    pub owned: bool,
    pub track_count: Option<u32>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WantedFulfillmentSource {
    Archive,
    Download,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WantedDownloadSoundcheck {
    Passed,
    NotChecked,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedDownloadReceipt {
    pub release_id: String,
    pub username: String,
    pub format: String,
    pub track_count: u32,
    pub size_bytes: u64,
    pub soundcheck: WantedDownloadSoundcheck,
    pub completed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedDownloadFulfillmentRequest {
    pub album_id: String,
    pub release_id: String,
    pub username: String,
    pub format: String,
    pub track_count: u32,
    pub size_bytes: u64,
    pub soundcheck: WantedDownloadSoundcheck,
    pub completed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedAlbum {
    pub album_id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
    pub cover_art_url: Option<String>,
    pub paused: bool,
    #[serde(default)]
    pub fulfilled: bool,
    #[serde(default)]
    pub fulfilled_at_ms: Option<u64>,
    #[serde(default)]
    pub fulfillment_source: Option<WantedFulfillmentSource>,
    #[serde(default)]
    pub download_receipt: Option<WantedDownloadReceipt>,
    #[serde(default)]
    pub owned_track_count: Option<u32>,
    #[serde(default)]
    pub watch_despite_ownership: bool,
    #[serde(default)]
    pub preferences: WantedPreferences,
    #[serde(default)]
    pub selected_release_id: Option<String>,
    pub added_at_ms: u64,
    pub last_checked_at_ms: Option<u64>,
    #[serde(default)]
    pub consecutive_misses: u32,
    #[serde(default)]
    pub last_found_at_ms: Option<u64>,
    pub source_count: u32,
    #[serde(default)]
    pub matching_source_count: u32,
    pub ready_source_count: u32,
    pub complete_source_count: u32,
    pub new_source_count: u32,
    pub best_format: Option<String>,
    pub best_track_count: Option<u32>,
    pub best_size_bytes: Option<u64>,
    pub best_speed_bytes_per_second: Option<u32>,
    #[serde(default)]
    pub best_source: Option<WantedBestSource>,
    pub error: Option<String>,
    #[serde(default)]
    source_fingerprints: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedSnapshot {
    pub albums: Vec<WantedAlbum>,
    pub default_preferences: WantedPreferences,
    pub interval_minutes: u32,
    pub active_album_id: Option<String>,
    pub next_check_at_ms: Option<u64>,
    pub wishlist_interval_seconds: Option<u32>,
    pub effective_cadence_minutes: Option<u64>,
    pub check_queued: bool,
    pub active_query: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WantedStore {
    version: u32,
    interval_minutes: u32,
    #[serde(default)]
    default_preferences: WantedPreferences,
    albums: Vec<WantedAlbum>,
}

impl Default for WantedStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
            default_preferences: WantedPreferences::default(),
            albums: Vec::new(),
        }
    }
}

#[derive(Default)]
struct SourceAggregate {
    username: String,
    folder: String,
    track_count: u32,
    total_size_bytes: u64,
    slot_free: bool,
    average_speed: u32,
    queue_length: u32,
    tracks: HashMap<String, RankingTrack>,
}

impl SourceAggregate {
    fn remember_file(&mut self, file: &super::protocol::SearchFile, extension: &str) {
        if self.tracks.contains_key(&file.filename) {
            return;
        }
        self.tracks.insert(
            file.filename.clone(),
            RankingTrack {
                id: file.filename.clone(),
                name: file.filename.clone(),
                format: extension.to_ascii_uppercase(),
                bitrate: file.bitrate,
                duration_seconds: file.duration_seconds,
            },
        );
        self.track_count = self.track_count.saturating_add(1);
        self.total_size_bytes = self.total_size_bytes.saturating_add(file.size_bytes);
    }
}

async fn official_tracks_or_fallback(
    load: impl std::future::Future<Output = Result<Vec<AlbumTrack>, String>>,
    timeout: Duration,
) -> Vec<AlbumTrack> {
    tokio::time::timeout(timeout, load)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

struct ActiveSearch {
    album_id: String,
    token: u32,
    deadline: Option<Instant>,
    query: String,
    sources: HashMap<String, SourceAggregate>,
    plan: AlbumQueryPlan,
    automatic: bool,
    official_tracks: Arc<Mutex<Option<Vec<AlbumTrack>>>>,
    selected_release_id: Option<String>,
}

impl ActiveSearch {
    fn retry_empty(&mut self, tokens: &AtomicU32) -> bool {
        if !self.sources.is_empty() || !self.plan.advance() {
            return false;
        }
        self.token = next_token(tokens);
        self.query = self.plan.query().to_owned();
        self.deadline = None;
        true
    }
}

#[derive(Default)]
struct WantedRuntime {
    active: Option<ActiveSearch>,
}

impl WantedRuntime {
    fn start_pending(
        &mut self,
        store: &WantedStore,
        now: Instant,
        automatic: bool,
    ) -> Option<(u32, String)> {
        let valid = self.active.as_ref().is_some_and(|active| {
            (!active.automatic || store.interval_minutes > 0)
                && store.albums.iter().any(|album| {
                    album.album_id == active.album_id && !album.paused && !album.fulfilled
                })
        });
        if !valid {
            self.active = None;
            return None;
        }
        let active = self
            .active
            .as_mut()
            .filter(|active| active.deadline.is_none() && active.automatic == automatic)?;
        active.deadline = Some(now + SEARCH_TIMEOUT);
        Some((active.token, active.query.clone()))
    }
}

#[derive(Clone)]
pub struct WantedHub {
    app: AppHandle,
    path: JsonFile,
    store: Arc<RwLock<WantedStore>>,
    runtime: Arc<Mutex<WantedRuntime>>,
    governor: SearchGovernor,
    queries: QueryMemory,
}

impl WantedHub {
    pub fn new(
        app: AppHandle,
        path: JsonFile,
        governor: SearchGovernor,
        queries: QueryMemory,
    ) -> Result<Self, WantedError> {
        Ok(Self {
            app,
            governor,
            queries,
            path: path.clone(),
            store: Arc::new(RwLock::new(load_store(&path)?)),
            runtime: Arc::new(Mutex::new(WantedRuntime::default())),
        })
    }

    pub fn snapshot(&self) -> WantedSnapshot {
        let runtime = self.runtime.lock().unwrap_or_else(|p| p.into_inner());
        let active_album_id = runtime
            .active
            .as_ref()
            .map(|active| active.album_id.clone());
        let check_queued = runtime
            .active
            .as_ref()
            .is_some_and(|active| active.deadline.is_none());
        let active_deadline = runtime.active.as_ref().and_then(|active| active.deadline);
        let active_query = runtime.active.as_ref().map(|active| active.plan.status());
        drop(runtime);
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = timestamp_ms();
        let instant = Instant::now();
        let wishlist_interval_seconds = self.governor.wishlist_seconds();
        let slot = self.governor.next_slot(SearchLane::Wanted, instant);
        let next_check_at_ms = next_check_at(&store, now).zip(slot).map(|(due, slot)| {
            let slot = slot.max(active_deadline.unwrap_or(instant));
            due.max(now.saturating_add(slot.saturating_duration_since(instant).as_millis() as u64))
        });
        let effective_cadence_minutes = effective_cadence(&store, wishlist_interval_seconds);
        let mut albums = store.albums.clone();
        albums.sort_by(|left, right| {
            left.fulfilled
                .cmp(&right.fulfilled)
                .then(right.new_source_count.cmp(&left.new_source_count))
                .then(right.matching_source_count.cmp(&left.matching_source_count))
                .then(right.source_count.cmp(&left.source_count))
                .then(right.added_at_ms.cmp(&left.added_at_ms))
        });
        WantedSnapshot {
            albums,
            default_preferences: store.default_preferences.clone(),
            interval_minutes: store.interval_minutes,
            active_album_id,
            next_check_at_ms,
            wishlist_interval_seconds,
            effective_cadence_minutes,
            check_queued,
            active_query,
            updated_at_ms: now,
        }
    }

    pub fn add(&self, request: WantedAlbumRequest) -> Result<WantedSnapshot, WantedError> {
        let request = validate_request(request)?;
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(album) = store
            .albums
            .iter_mut()
            .find(|album| album.album_id.eq_ignore_ascii_case(&request.album_id))
        {
            let was_fulfilled = album.fulfilled;
            album.artist = request.artist;
            album.title = request.title;
            album.first_release_date = request.first_release_date;
            album.cover_art_url = request.cover_art_url;
            album.paused = false;
            if was_fulfilled {
                reset_for_watch(album, timestamp_ms());
            }
        } else {
            if store.albums.len() >= MAX_WANTED_ALBUMS {
                return Err(WantedError::TooManyAlbums);
            }
            let preferences = store.default_preferences.clone();
            store.albums.push(WantedAlbum {
                album_id: request.album_id,
                artist: request.artist,
                title: request.title,
                first_release_date: request.first_release_date,
                cover_art_url: request.cover_art_url,
                paused: false,
                fulfilled: false,
                fulfilled_at_ms: None,
                fulfillment_source: None,
                download_receipt: None,
                owned_track_count: None,
                watch_despite_ownership: false,
                preferences,
                selected_release_id: None,
                added_at_ms: timestamp_ms(),
                last_checked_at_ms: None,
                consecutive_misses: 0,
                last_found_at_ms: None,
                source_count: 0,
                matching_source_count: 0,
                ready_source_count: 0,
                complete_source_count: 0,
                new_source_count: 0,
                best_format: None,
                best_track_count: None,
                best_size_bytes: None,
                best_speed_bytes_per_second: None,
                best_source: None,
                error: None,
                source_fingerprints: Vec::new(),
            });
        }
        drop(store);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn add_many(
        &self,
        requests: Vec<WantedAlbumRequest>,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, WantedError> {
        if requests.is_empty() || requests.len() > MAX_BULK_WANTED_ALBUMS {
            return Err(WantedError::InvalidBulkCount);
        }
        validate_preferences(&preferences)?;
        let mut seen = HashSet::new();
        let requests = requests
            .into_iter()
            .map(validate_request)
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|request| seen.insert(request.album_id.to_lowercase()))
            .collect::<Vec<_>>();
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        merge_bulk_requests(&mut store, requests, &preferences, timestamp_ms())?;
        drop(store);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn remove(&self, album_id: &str) -> Result<WantedSnapshot, WantedError> {
        let album_id = valid_album_id(album_id)?;
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = store.albums.len();
        store
            .albums
            .retain(|album| !album.album_id.eq_ignore_ascii_case(album_id));
        if store.albums.len() == previous {
            return Err(WantedError::AlbumNotFound);
        }
        drop(store);
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime
            .active
            .as_ref()
            .is_some_and(|active| active.album_id.eq_ignore_ascii_case(album_id))
        {
            runtime.active = None;
        }
        drop(runtime);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn fulfill_downloaded(
        &self,
        fulfillments: Vec<WantedDownloadFulfillmentRequest>,
    ) -> Result<WantedSnapshot, WantedError> {
        if fulfillments.len() > MAX_WANTED_ALBUMS {
            return Err(WantedError::TooManyAlbums);
        }
        let fulfillments = fulfillments
            .into_iter()
            .map(validate_download_fulfillment)
            .collect::<Result<Vec<_>, _>>()?;
        if fulfillments.is_empty() {
            return Ok(self.snapshot());
        }
        let album_ids = fulfillments
            .iter()
            .map(|fulfillment| fulfillment.album_id.to_ascii_lowercase())
            .collect::<HashSet<_>>();

        let changed = {
            let mut store = self
                .store
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            fulfill_downloaded_in_store(&mut store, fulfillments) > 0
        };
        if !changed {
            return Ok(self.snapshot());
        }

        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime
            .active
            .as_ref()
            .is_some_and(|active| album_ids.contains(&active.album_id.to_ascii_lowercase()))
        {
            runtime.active = None;
        }
        drop(runtime);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn set_paused(&self, album_id: &str, paused: bool) -> Result<WantedSnapshot, WantedError> {
        let album_id = valid_album_id(album_id)?;
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let album = store
            .albums
            .iter_mut()
            .find(|album| album.album_id.eq_ignore_ascii_case(album_id))
            .ok_or(WantedError::AlbumNotFound)?;
        album.paused = paused;
        drop(store);
        if paused {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime
                .active
                .as_ref()
                .is_some_and(|active| active.album_id.eq_ignore_ascii_case(album_id))
            {
                runtime.active = None;
            }
        }
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn set_interval(&self, interval_minutes: u32) -> Result<WantedSnapshot, WantedError> {
        if !matches!(interval_minutes, 0 | 15 | 30 | 60) {
            return Err(WantedError::InvalidInterval);
        }
        self.store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .interval_minutes = interval_minutes;
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn set_preferences(
        &self,
        album_id: &str,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, WantedError> {
        let album_id = valid_album_id(album_id)?;
        validate_preferences(&preferences)?;
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let album = store
            .albums
            .iter_mut()
            .find(|album| album.album_id.eq_ignore_ascii_case(album_id))
            .ok_or(WantedError::AlbumNotFound)?;
        album.preferences = preferences;
        album.last_checked_at_ms = None;
        album.consecutive_misses = 0;
        album.last_found_at_ms = None;
        album.matching_source_count = 0;
        album.new_source_count = 0;
        album.best_format = None;
        album.best_track_count = None;
        album.best_size_bytes = None;
        album.best_speed_bytes_per_second = None;
        album.best_source = None;
        album.source_fingerprints.clear();
        drop(store);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn set_edition(
        &self,
        album_id: &str,
        release_id: Option<String>,
    ) -> Result<WantedSnapshot, WantedError> {
        let album_id = valid_album_id(album_id)?;
        if release_id
            .as_deref()
            .is_some_and(|id| !crate::musicbrainz::is_musicbrainz_id(id))
        {
            return Err(WantedError::InvalidAlbum);
        }
        let mut runtime = self.runtime.lock().unwrap_or_else(|p| p.into_inner());
        let mut store = self.store.write().unwrap_or_else(|p| p.into_inner());
        let mut next = store.clone();
        let album = next
            .albums
            .iter_mut()
            .find(|a| a.album_id.eq_ignore_ascii_case(album_id))
            .ok_or(WantedError::AlbumNotFound)?;
        if album.selected_release_id == release_id {
            drop(store);
            drop(runtime);
            return Ok(self.snapshot());
        }
        change_edition(album, release_id);
        // Persist before publishing the choice; failed saves retain the previous state.
        self.path.save(&next)?;
        *store = next;
        if runtime
            .active
            .as_ref()
            .is_some_and(|a| a.album_id.eq_ignore_ascii_case(album_id))
        {
            runtime.active = None;
        }
        drop(store);
        drop(runtime);
        self.publish();
        Ok(self.snapshot())
    }

    pub fn set_default_preferences(
        &self,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, WantedError> {
        validate_preferences(&preferences)?;
        self.store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .default_preferences = preferences;
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn sync_fulfilled(
        &self,
        fulfillments: Vec<WantedFulfillmentRequest>,
    ) -> Result<WantedSnapshot, WantedError> {
        if fulfillments.len() > MAX_WANTED_ALBUMS {
            return Err(WantedError::TooManyAlbums);
        }
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut changed = false;
        for fulfillment in fulfillments {
            let album_id = valid_album_id(&fulfillment.album_id)?;
            let Some(album) = store
                .albums
                .iter_mut()
                .find(|album| album.album_id.eq_ignore_ascii_case(album_id))
            else {
                continue;
            };
            let owned_track_count = if fulfillment.owned {
                fulfillment.track_count
            } else {
                None
            };
            if album.fulfillment_source == Some(WantedFulfillmentSource::Download) {
                continue;
            }
            if album.watch_despite_ownership {
                continue;
            }
            let fulfillment_source = fulfillment
                .owned
                .then_some(WantedFulfillmentSource::Archive);
            if album.fulfilled != fulfillment.owned
                || album.owned_track_count != owned_track_count
                || album.fulfillment_source != fulfillment_source
            {
                album.fulfilled = fulfillment.owned;
                album.fulfilled_at_ms = fulfillment.owned.then(timestamp_ms);
                album.fulfillment_source = fulfillment_source;
                album.download_receipt = None;
                album.owned_track_count = owned_track_count;
                album.watch_despite_ownership = false;
                if fulfillment.owned {
                    album.new_source_count = 0;
                } else {
                    album.last_checked_at_ms = None;
                    album.consecutive_misses = 0;
                    album.last_found_at_ms = None;
                }
                changed = true;
            }
        }
        drop(store);
        if changed {
            self.persist()?;
            self.publish();
        }
        Ok(self.snapshot())
    }

    pub fn restore(&self, album_id: &str) -> Result<WantedSnapshot, WantedError> {
        let album_id = valid_album_id(album_id)?;
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let album = store
            .albums
            .iter_mut()
            .find(|album| album.album_id.eq_ignore_ascii_case(album_id))
            .ok_or(WantedError::AlbumNotFound)?;
        reset_for_watch(album, timestamp_ms());
        drop(store);
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn start_manual(&self, album_id: &str, token: u32) -> Result<String, WantedError> {
        let album_id = valid_album_id(album_id)?;
        self.start(album_id, token, true)
    }

    pub fn start_due(&self, token: u32) -> Option<String> {
        let now = timestamp_ms();
        let album_id = {
            let store = self
                .store
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            select_due(&store, now).map(|album| album.album_id.clone())
        }?;
        self.start(&album_id, token, false).ok()
    }

    fn start(&self, album_id: &str, token: u32, force: bool) -> Result<String, WantedError> {
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime.active.is_some() {
            return Err(WantedError::CheckInProgress);
        }
        let (plan, selected_release_id) = {
            let store = self
                .store
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let album = store
                .albums
                .iter()
                .find(|album| album.album_id.eq_ignore_ascii_case(album_id))
                .ok_or(WantedError::AlbumNotFound)?;
            if album.paused {
                return Err(WantedError::AlbumPaused);
            }
            if album.fulfilled {
                return Err(WantedError::AlbumFulfilled);
            }
            let plan = self
                .queries
                .plan(&AlbumIdentity {
                    artist: album.artist.clone(),
                    title: album.title.clone(),
                })
                .map_err(|_| WantedError::InvalidAlbum)?;
            (plan, album.selected_release_id.clone())
        };
        let query = plan.query().to_owned();
        let official_tracks = Arc::new(Mutex::new(None));
        let result = official_tracks.clone();
        let app = self.app.clone();
        let id = album_id.to_owned();
        let edition = selected_release_id.clone();
        tauri::async_runtime::spawn(async move {
            let client = app.state::<MusicBrainzClient>();
            let tracks = official_tracks_or_fallback(
                client.edition_tracklist(&id, edition.as_deref()),
                Duration::from_secs(45),
            )
            .await;
            *result.lock().unwrap_or_else(|p| p.into_inner()) = Some(tracks);
        });
        runtime.active = Some(ActiveSearch {
            album_id: album_id.to_owned(),
            token,
            deadline: (!force).then(|| Instant::now() + SEARCH_TIMEOUT),
            query: query.clone(),
            sources: HashMap::new(),
            plan,
            automatic: !force,
            official_tracks,
            selected_release_id,
        });
        drop(runtime);
        self.publish();
        Ok(query)
    }

    pub fn start_pending(&self, automatic: bool) -> Option<(u32, String)> {
        let mut runtime = self.runtime.lock().unwrap_or_else(|p| p.into_inner());
        let had_active = runtime.active.is_some();
        let request = runtime.start_pending(
            &self.store.read().unwrap_or_else(|p| p.into_inner()),
            Instant::now(),
            automatic,
        );
        let changed = request.is_some() || had_active != runtime.active.is_some();
        drop(runtime);
        if changed {
            self.publish();
        }
        request
    }

    pub fn record(&self, response: &SearchResponse) {
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(active) = runtime.active.as_mut().filter(|active| {
            active.token == response.token
                && active
                    .deadline
                    .is_some_and(|deadline| Instant::now() <= deadline)
        }) else {
            return;
        };
        for file in &response.files {
            if !active.plan.accepts(&file.filename) {
                continue;
            }
            let extension = file.extension.trim_start_matches('.').to_ascii_lowercase();
            if !matching::is_audio(&extension) {
                continue;
            }
            let folder = matching::album_folder(parent_folder(&file.filename));
            if folder.is_empty() {
                continue;
            }
            let key = format!(
                "{}\u{0}{}",
                response.username.to_ascii_lowercase(),
                folder.to_ascii_lowercase()
            );
            let source = active.sources.entry(key).or_default();
            if source.track_count == 0 {
                source.username = response.username.clone();
                source.folder = folder.to_owned();
                source.queue_length = response.queue_length;
            } else {
                source.queue_length = source.queue_length.min(response.queue_length);
            }
            source.slot_free |= response.slot_free;
            source.average_speed = source.average_speed.max(response.average_speed);
            source.remember_file(file, &extension);
        }
    }

    pub fn expire_if_due(&self, tokens: &AtomicU32) {
        let mut retried = false;
        let active = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.active.as_ref().is_some_and(|active| {
                active
                    .deadline
                    .is_some_and(|deadline| Instant::now() >= deadline)
            }) {
                if runtime.active.as_mut().unwrap().retry_empty(tokens) {
                    retried = true;
                    None
                } else if runtime
                    .active
                    .as_ref()
                    .unwrap()
                    .official_tracks
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .is_some()
                {
                    runtime.active.take()
                } else {
                    None
                }
            } else {
                None
            }
        };
        if let Some(active) = active {
            self.finish(active);
        } else if retried {
            self.publish();
        }
    }

    pub fn fail_active(&self, message: &str) {
        let active = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active
            .take();
        let Some(active) = active else {
            return;
        };
        if let Some(album) = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .albums
            .iter_mut()
            .find(|album| {
                album.album_id == active.album_id
                    && album.selected_release_id == active.selected_release_id
            })
        {
            album.error = Some(message.to_owned());
        }
        let _ = self.persist();
        self.publish();
    }

    pub fn connection_lost(&self) {
        self.runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active = None;
        self.publish();
    }

    fn finish(&self, active: ActiveSearch) {
        if !active.sources.is_empty() {
            self.queries.remember(&active.plan);
        }
        let preferences = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .albums
            .iter()
            .find(|album| album.album_id == active.album_id)
            .map(|album| album.preferences.clone())
            .unwrap_or_default();
        let artist = self
            .store
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .albums
            .iter()
            .find(|a| a.album_id == active.album_id)
            .map(|a| a.artist.clone())
            .unwrap_or_default();
        let tracks = active
            .official_tracks
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .unwrap_or_default();
        let selected_unavailable = active.selected_release_id.is_some() && tracks.is_empty();
        let mut summary = summarize_ranked_sources(active.sources, &preferences, &tracks, &artist);
        if selected_unavailable {
            summary.matching_source_count = 0;
            summary.best_source = None;
            summary.best_format = None;
            summary.best_track_count = None;
            summary.best_size_bytes = None;
            summary.best_speed_bytes_per_second = None;
            summary.source_fingerprints.clear();
        }
        if let Some(album) = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .albums
            .iter_mut()
            .find(|album| {
                album.album_id == active.album_id
                    && album.selected_release_id == active.selected_release_id
            })
        {
            album.new_source_count = summary
                .source_fingerprints
                .iter()
                .filter(|fingerprint| !album.source_fingerprints.contains(fingerprint))
                .count()
                .try_into()
                .unwrap_or(u32::MAX);
            album.source_count = summary.source_count;
            album.matching_source_count = summary.matching_source_count;
            album.ready_source_count = summary.ready_source_count;
            album.complete_source_count = summary.complete_source_count;
            album.best_format = summary.best_format;
            album.best_track_count = summary.best_track_count;
            album.best_size_bytes = summary.best_size_bytes;
            album.best_speed_bytes_per_second = summary.best_speed_bytes_per_second;
            album.best_source = summary.best_source;
            record_check_outcome(album, summary.source_count, timestamp_ms());
            album.error = selected_unavailable.then(|| {
                "Selected edition tracklist unavailable; try again before reviewing.".into()
            });
            album.source_fingerprints = summary.source_fingerprints;
        }
        let _ = self.persist();
        self.publish();
    }

    fn persist(&self) -> Result<(), WantedError> {
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.path.save(&*store)?;
        Ok(())
    }

    pub fn publish(&self) {
        let _ = self.app.emit(WANTED_EVENT, self.snapshot());
    }
}

#[derive(Default)]
struct SourceSummary {
    source_count: u32,
    matching_source_count: u32,
    ready_source_count: u32,
    complete_source_count: u32,
    best_format: Option<String>,
    best_track_count: Option<u32>,
    best_size_bytes: Option<u64>,
    best_speed_bytes_per_second: Option<u32>,
    best_source: Option<WantedBestSource>,
    source_fingerprints: Vec<String>,
}

#[cfg(test)]
fn summarize_sources(
    sources: HashMap<String, SourceAggregate>,
    preferences: &WantedPreferences,
) -> SourceSummary {
    summarize_ranked_sources(sources, preferences, &[], "")
}

fn ranking_source(id: &str, source: &SourceAggregate) -> RankingSource {
    RankingSource {
        id: id.into(),
        owner: source.username.clone(),
        folder: source.folder.clone(),
        tracks: source.tracks.values().cloned().collect(),
        slot_free: source.slot_free,
        average_speed: source.average_speed,
        queue_length: source.queue_length,
    }
}

fn summarize_ranked_sources(
    sources: HashMap<String, SourceAggregate>,
    preferences: &WantedPreferences,
    official: &[AlbumTrack],
    artist: &str,
) -> SourceSummary {
    let best_track_count = sources.values().map(|source| source.track_count).max();
    let complete_source_count = best_track_count
        .map(|track_count| {
            sources
                .values()
                .filter(|source| source.track_count == track_count)
                .count()
                .try_into()
                .unwrap_or(u32::MAX)
        })
        .unwrap_or(0);
    let inputs: Vec<_> = sources
        .iter()
        .map(|(id, source)| ranking_source(id, source))
        .collect();
    let ranked = matching::rank_sources(&inputs, preferences, official, artist);
    let matching_sources: Vec<_> = ranked.iter().filter(|r| r.eligible).collect();
    let best_source = matching_sources.first().map(|rank| {
        let source = &sources[&rank.source_id];
        WantedBestSource {
            username: source.username.clone(),
            folder: source.folder.clone(),
            format: rank.format.clone(),
            track_count: source.track_count,
            size_bytes: source.total_size_bytes,
            slot_free: source.slot_free,
            average_speed_bytes_per_second: source.average_speed,
            queue_length: source.queue_length,
            minimum_bitrate_kbps: rank.minimum_bitrate_kbps,
            score: rank.score,
            tracklist_label: rank.tracklist_confidence.label.clone(),
            folders: {
                let mut folders: Vec<_> = source
                    .tracks
                    .values()
                    .map(|t| parent_folder(&t.name).to_owned())
                    .collect();
                folders.sort();
                folders.dedup();
                folders
            },
        }
    });
    let mut source_fingerprints: Vec<_> = matching_sources
        .iter()
        .map(|r| r.source_id.clone())
        .collect();
    source_fingerprints.sort();
    SourceSummary {
        source_count: sources.len().try_into().unwrap_or(u32::MAX),
        matching_source_count: matching_sources.len().try_into().unwrap_or(u32::MAX),
        ready_source_count: sources
            .values()
            .filter(|source| source.slot_free)
            .count()
            .try_into()
            .unwrap_or(u32::MAX),
        complete_source_count,
        best_format: best_source.as_ref().map(|source| source.format.clone()),
        best_track_count: best_source.as_ref().map(|source| source.track_count),
        best_size_bytes: best_source.as_ref().map(|source| source.size_bytes),
        best_speed_bytes_per_second: best_source
            .as_ref()
            .map(|source| source.average_speed_bytes_per_second)
            .filter(|speed| *speed > 0),
        best_source,
        source_fingerprints,
    }
}

#[cfg(test)]
fn source_matches(source: &SourceAggregate, preferences: &WantedPreferences) -> bool {
    matching::rank_sources(&[ranking_source("test", source)], preferences, &[], "")[0].eligible
}

fn parent_folder(filename: &str) -> &str {
    filename
        .rfind(['\\', '/'])
        .map(|index| &filename[..index])
        .unwrap_or("")
}

fn fulfill_downloaded_in_store(
    store: &mut WantedStore,
    fulfillments: Vec<WantedDownloadFulfillmentRequest>,
) -> usize {
    let by_album_id = fulfillments
        .into_iter()
        .map(|fulfillment| (fulfillment.album_id.to_ascii_lowercase(), fulfillment))
        .collect::<HashMap<_, _>>();
    let mut changed = 0;
    for album in &mut store.albums {
        let Some(fulfillment) = by_album_id.get(&album.album_id.to_ascii_lowercase()) else {
            continue;
        };
        let receipt = WantedDownloadReceipt {
            release_id: fulfillment.release_id.clone(),
            username: fulfillment.username.clone(),
            format: fulfillment.format.clone(),
            track_count: fulfillment.track_count,
            size_bytes: fulfillment.size_bytes,
            soundcheck: fulfillment.soundcheck,
            completed_at_ms: fulfillment.completed_at_ms,
        };
        if album.fulfillment_source == Some(WantedFulfillmentSource::Download)
            && album.download_receipt.as_ref() == Some(&receipt)
        {
            continue;
        }
        album.fulfilled = true;
        album.fulfilled_at_ms = Some(receipt.completed_at_ms);
        album.fulfillment_source = Some(WantedFulfillmentSource::Download);
        album.download_receipt = Some(receipt);
        album.owned_track_count = None;
        album.watch_despite_ownership = false;
        album.new_source_count = 0;
        album.error = None;
        changed += 1;
    }
    changed
}

// Quiet watches back off after completed, empty checks only. A failed send or
// interrupted session never counts as evidence that an album is unavailable.
fn record_check_outcome(album: &mut WantedAlbum, sources: u32, now: u64) {
    album.last_checked_at_ms = Some(now);
    if sources > 0 {
        album.consecutive_misses = 0;
        album.last_found_at_ms = Some(now);
    } else {
        album.consecutive_misses = album.consecutive_misses.saturating_add(1);
    }
}

fn album_interval_minutes(album: &WantedAlbum, base: u32) -> u64 {
    let backoff = match album.consecutive_misses {
        0 => u64::from(base),
        1 => 60,
        2 => 6 * 60,
        _ => 24 * 60,
    };
    u64::from(base).max(backoff)
}

fn album_due_at(album: &WantedAlbum, interval_minutes: u32) -> u64 {
    album
        .last_checked_at_ms
        .map_or(album.added_at_ms, |checked| {
            checked.saturating_add(album_interval_minutes(album, interval_minutes) * 60_000)
        })
}

fn select_due(store: &WantedStore, now: u64) -> Option<&WantedAlbum> {
    if store.interval_minutes == 0 {
        return None;
    }
    store
        .albums
        .iter()
        .filter(|album| {
            !album.paused && !album.fulfilled && album_due(album, store.interval_minutes, now)
        })
        .min_by_key(|album| {
            (
                album_due_at(album, store.interval_minutes),
                album.added_at_ms,
                album.album_id.as_str(),
            )
        })
}

fn next_check_at(store: &WantedStore, now: u64) -> Option<u64> {
    if store.interval_minutes == 0 {
        return None;
    }
    store
        .albums
        .iter()
        .filter(|album| !album.paused && !album.fulfilled)
        .map(|album| album_due_at(album, store.interval_minutes).max(now))
        .min()
}

fn album_due(album: &WantedAlbum, interval_minutes: u32, now: u64) -> bool {
    now >= album_due_at(album, interval_minutes)
}

fn effective_cadence(store: &WantedStore, server_seconds: Option<u32>) -> Option<u64> {
    if store.interval_minutes == 0 {
        return None;
    }
    let seconds = u64::from(server_seconds.filter(|seconds| *seconds > 0)?);
    let active = store
        .albums
        .iter()
        .filter(|album| !album.paused && !album.fulfilled)
        .collect::<Vec<_>>();
    if active.is_empty() {
        return None;
    }
    let rotation = (active.len() as u64
        * seconds
            .max(SEARCH_SPACING.as_secs())
            .max(SEARCH_TIMEOUT.as_secs()))
    .div_ceil(60);
    // The fastest watch's cadence is still limited by one whole-list rotation.
    Some(
        rotation.max(
            active
                .iter()
                .map(|album| album_interval_minutes(album, store.interval_minutes))
                .min()?,
        ),
    )
}

fn validate_request(mut request: WantedAlbumRequest) -> Result<WantedAlbumRequest, WantedError> {
    request.album_id = valid_album_id(&request.album_id)?.to_owned();
    request.artist = valid_text(&request.artist, 180)?;
    request.title = valid_text(&request.title, 500)?;
    AlbumQueryPlan::new(
        &AlbumIdentity {
            artist: request.artist.clone(),
            title: request.title.clone(),
        },
        None,
    )
    .map_err(|_| WantedError::InvalidAlbum)?;
    request.first_release_date = request.first_release_date.trim().chars().take(32).collect();
    request.cover_art_url = request
        .cover_art_url
        .map(|value| value.trim().chars().take(2_048).collect())
        .filter(|value: &String| value.starts_with("https://"));
    if request
        .minimum_track_count
        .is_some_and(|tracks| !(1..=250).contains(&tracks))
    {
        return Err(WantedError::InvalidPreferences);
    }
    Ok(request)
}

fn validate_download_fulfillment(
    mut fulfillment: WantedDownloadFulfillmentRequest,
) -> Result<WantedDownloadFulfillmentRequest, WantedError> {
    fulfillment.album_id = valid_album_id(&fulfillment.album_id)?.to_owned();
    fulfillment.release_id = valid_text(&fulfillment.release_id, 180)?;
    fulfillment.username = valid_text(&fulfillment.username, 180)?;
    fulfillment.format = valid_text(&fulfillment.format, 80)?;
    if fulfillment.track_count == 0
        || fulfillment.track_count > 500
        || fulfillment.size_bytes == 0
        || fulfillment.completed_at_ms == 0
    {
        return Err(WantedError::InvalidDownloadFulfillment);
    }
    Ok(fulfillment)
}

fn reset_for_watch(album: &mut WantedAlbum, added_at_ms: u64) {
    album.paused = false;
    album.fulfilled = false;
    album.fulfilled_at_ms = None;
    album.fulfillment_source = None;
    album.download_receipt = None;
    album.owned_track_count = None;
    album.watch_despite_ownership = true;
    album.added_at_ms = added_at_ms;
    album.last_checked_at_ms = None;
    album.consecutive_misses = 0;
    album.last_found_at_ms = None;
    album.source_count = 0;
    album.matching_source_count = 0;
    album.ready_source_count = 0;
    album.complete_source_count = 0;
    album.new_source_count = 0;
    album.best_format = None;
    album.best_track_count = None;
    album.best_size_bytes = None;
    album.best_speed_bytes_per_second = None;
    album.best_source = None;
    album.error = None;
    album.source_fingerprints.clear();
}

fn validate_preferences(preferences: &WantedPreferences) -> Result<(), WantedError> {
    if !matches!(
        preferences.minimum_bitrate_kbps,
        None | Some(128 | 192 | 256 | 320)
    ) || preferences
        .minimum_track_count
        .is_some_and(|tracks| !(1..=250).contains(&tracks))
    {
        return Err(WantedError::InvalidPreferences);
    }
    Ok(())
}

fn merge_bulk_requests(
    store: &mut WantedStore,
    requests: Vec<WantedAlbumRequest>,
    preferences: &WantedPreferences,
    added_at_ms: u64,
) -> Result<(), WantedError> {
    let new_count = requests
        .iter()
        .filter(|request| {
            !store
                .albums
                .iter()
                .any(|album| album.album_id.eq_ignore_ascii_case(&request.album_id))
        })
        .count();
    if store.albums.len().saturating_add(new_count) > MAX_WANTED_ALBUMS {
        return Err(WantedError::TooManyAlbums);
    }
    for request in requests {
        let mut album_preferences = preferences.clone();
        if let Some(minimum_track_count) = request.minimum_track_count {
            album_preferences.minimum_track_count = Some(minimum_track_count);
        }
        if let Some(album) = store
            .albums
            .iter_mut()
            .find(|album| album.album_id.eq_ignore_ascii_case(&request.album_id))
        {
            let was_fulfilled = album.fulfilled;
            album.artist = request.artist;
            album.title = request.title;
            album.first_release_date = request.first_release_date;
            album.cover_art_url = request.cover_art_url;
            album.paused = false;
            album.preferences = album_preferences;
            if was_fulfilled {
                reset_for_watch(album, added_at_ms);
            }
        } else {
            store.albums.push(WantedAlbum {
                album_id: request.album_id,
                artist: request.artist,
                title: request.title,
                first_release_date: request.first_release_date,
                cover_art_url: request.cover_art_url,
                paused: false,
                fulfilled: false,
                fulfilled_at_ms: None,
                fulfillment_source: None,
                download_receipt: None,
                owned_track_count: None,
                watch_despite_ownership: false,
                preferences: album_preferences,
                selected_release_id: None,
                added_at_ms,
                last_checked_at_ms: None,
                consecutive_misses: 0,
                last_found_at_ms: None,
                source_count: 0,
                matching_source_count: 0,
                ready_source_count: 0,
                complete_source_count: 0,
                new_source_count: 0,
                best_format: None,
                best_track_count: None,
                best_size_bytes: None,
                best_speed_bytes_per_second: None,
                best_source: None,
                error: None,
                source_fingerprints: Vec::new(),
            });
        }
    }
    Ok(())
}

fn valid_album_id(value: &str) -> Result<&str, WantedError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 100
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Err(WantedError::InvalidAlbum)
    } else {
        Ok(value)
    }
}

fn valid_text(value: &str, max: usize) -> Result<String, WantedError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        Err(WantedError::InvalidAlbum)
    } else {
        Ok(value.to_owned())
    }
}

fn load_store(path: &JsonFile) -> Result<WantedStore, WantedError> {
    Ok(path.load(WantedStore::default, decode_store))
}

fn decode_store(bytes: &[u8]) -> Result<WantedStore, DecodeError> {
    let store: WantedStore = store::decode(
        bytes,
        STORE_VERSION,
        None,
        &[
            (1, migrate_v1_to_v2),
            (2, migrate_v2_to_v3),
            (3, migrate_v3_to_v4),
        ],
    )?;
    Ok(store)
}

// Materialize the defaults introduced during v1 so v2 has an explicit schema.
fn migrate_v1_to_v2(value: serde_json::Value) -> Result<serde_json::Value, DecodeError> {
    let mut store: WantedStore = serde_json::from_value(value)?;
    store.version = 2;
    Ok(serde_json::to_value(store)?)
}

fn migrate_v2_to_v3(value: serde_json::Value) -> Result<serde_json::Value, DecodeError> {
    let mut store: WantedStore = serde_json::from_value(value)?;
    store.version = 3;
    for album in &mut store.albums {
        album.last_found_at_ms = (album.source_count > 0)
            .then_some(album.last_checked_at_ms)
            .flatten();
    }
    Ok(serde_json::to_value(store)?)
}

fn change_edition(album: &mut WantedAlbum, release_id: Option<String>) {
    album.selected_release_id = release_id;
    album.last_checked_at_ms = None;
    album.consecutive_misses = 0;
    album.last_found_at_ms = None;
    album.source_count = 0;
    album.matching_source_count = 0;
    album.ready_source_count = 0;
    album.complete_source_count = 0;
    album.new_source_count = 0;
    album.best_format = None;
    album.best_track_count = None;
    album.best_size_bytes = None;
    album.best_speed_bytes_per_second = None;
    album.best_source = None;
    album.error = None;
    album.source_fingerprints.clear();
}

fn migrate_v3_to_v4(value: serde_json::Value) -> Result<serde_json::Value, DecodeError> {
    let mut store: WantedStore = serde_json::from_value(value)?;
    store.version = 4;
    for album in &mut store.albums {
        album.selected_release_id = None;
    }
    Ok(serde_json::to_value(store)?)
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[derive(Debug, Error)]
pub enum WantedError {
    #[error("Choose a valid MusicBrainz album before adding it to Wanted.")]
    InvalidAlbum,
    #[error("That album is not in Wanted.")]
    AlbumNotFound,
    #[error("Resume this album before checking it.")]
    AlbumPaused,
    #[error("This album is already present in the read-only Music Library Archive.")]
    AlbumFulfilled,
    #[error("Another wanted album is already being checked.")]
    CheckInProgress,
    #[error("Choose Manual, 15 minutes, 30 minutes, or 1 hour.")]
    InvalidInterval,
    #[error("Choose valid Smart Match format, bitrate, and track requirements.")]
    InvalidPreferences,
    #[error("Choose a valid verified download before fulfilling this Wanted album.")]
    InvalidDownloadFulfillment,
    #[error("Forever supports up to {MAX_WANTED_ALBUMS} wanted albums.")]
    TooManyAlbums,
    #[error("Choose between 1 and {MAX_BULK_WANTED_ALBUMS} missing albums at a time.")]
    InvalidBulkCount,
    #[error("Could not read or save Wanted data: {0}")]
    Io(#[from] std::io::Error),
    #[error("Could not read or save Wanted data: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule_store(count: usize) -> WantedStore {
        let mut store = WantedStore::default();
        for offset in (0..count).step_by(100) {
            merge_bulk_requests(
                &mut store,
                (offset..(offset + 100).min(count))
                    .map(|index| request(&format!("album-{index:03}")))
                    .collect(),
                &WantedPreferences::default(),
                1,
            )
            .unwrap();
        }
        store
    }

    #[test]
    fn manual_checks_wait_for_dispatch_and_revalidate_queued_watches() {
        let now = Instant::now();
        let mut store = schedule_store(1);
        let pending = || WantedRuntime {
            active: Some(ActiveSearch {
                album_id: "album-000".to_owned(),
                token: 5,
                deadline: None,
                query: "artist album".to_owned(),
                plan: AlbumQueryPlan::new(
                    &AlbumIdentity {
                        artist: "artist".into(),
                        title: "album".into(),
                    },
                    None,
                )
                .unwrap(),
                automatic: false,
                official_tracks: Arc::new(Mutex::new(Some(vec![]))),
                selected_release_id: None,
                sources: HashMap::new(),
            }),
        };
        let mut runtime = pending();
        assert!(runtime.active.as_ref().unwrap().deadline.is_none());
        let sent = now + Duration::from_secs(300);
        assert_eq!(
            runtime.start_pending(&store, sent, false),
            Some((5, "artist album".to_owned()))
        );
        assert_eq!(
            runtime.active.as_ref().unwrap().deadline,
            Some(sent + SEARCH_TIMEOUT)
        );
        assert!(runtime.start_pending(&store, sent, false).is_none());
        store.albums[0].paused = true;
        let mut runtime = pending();
        assert!(runtime.start_pending(&store, now, false).is_none());
        assert!(runtime.active.is_none());
        store.albums[0].paused = false;
        store.albums[0].fulfilled = true;
        assert!(pending().start_pending(&store, now, false).is_none());
        store.albums.clear();
        assert!(pending().start_pending(&store, now, false).is_none());
    }

    #[test]
    fn automatic_fallbacks_stay_on_wishlist_slots_and_only_finish_backoff_once() {
        let store = schedule_store(1);
        let now = Instant::now();
        let governor = SearchGovernor::default();
        governor.set_online(true);
        governor.set_wishlist_interval(720, now);
        let mut runtime = WantedRuntime {
            active: Some(ActiveSearch {
                album_id: "album-000".into(),
                token: 1,
                deadline: Some(now + SEARCH_TIMEOUT),
                query: "artist the northern lights".into(),
                sources: HashMap::new(),
                automatic: true,
                official_tracks: Arc::new(Mutex::new(Some(vec![]))),
                selected_release_id: None,
                plan: AlbumQueryPlan::new(
                    &AlbumIdentity {
                        artist: "Artist".into(),
                        title: "The Northern Lights".into(),
                    },
                    None,
                )
                .unwrap(),
            }),
        };
        let tokens = AtomicU32::new(10);
        governor.sent(SearchLane::Wanted, now);
        assert!(runtime.active.as_mut().unwrap().retry_empty(&tokens));
        assert!(runtime.start_pending(&store, now, false).is_none());
        let dispatch = |runtime: &mut WantedRuntime, time| {
            governor.take_next(time, |lane| match lane {
                SearchLane::User => runtime.start_pending(&store, time, false),
                SearchLane::Wanted => runtime.start_pending(&store, time, true),
                _ => None,
            })
        };
        assert!(dispatch(&mut runtime, now + Duration::from_secs(719)).is_none());
        let sent = now + Duration::from_secs(720);
        assert_eq!(
            dispatch(&mut runtime, sent),
            Some((SearchLane::Wanted, (10, "the northern lights".into())))
        );
        assert_eq!(
            runtime.active.as_ref().unwrap().deadline,
            Some(sent + SEARCH_TIMEOUT)
        );
        assert!(runtime.active.as_mut().unwrap().retry_empty(&tokens));
        assert!(dispatch(&mut runtime, sent + Duration::from_secs(15)).is_none());
        assert_eq!(
            dispatch(&mut runtime, sent + Duration::from_secs(720))
                .unwrap()
                .0,
            SearchLane::Wanted
        );
        assert!(!runtime.active.as_mut().unwrap().retry_empty(&tokens));
        assert_eq!(store.albums[0].consecutive_misses, 0);
    }

    #[test]
    fn five_hundred_album_rotation_is_fair_and_reports_real_capacity() {
        let mut store = schedule_store(500);
        assert_eq!(effective_cadence(&store, Some(720)), Some(6_000));
        assert_eq!(effective_cadence(&store, Some(120)), Some(1_000));
        assert_eq!(effective_cadence(&store, None), None);
        assert_eq!(effective_cadence(&store, Some(0)), None);
        let mut checked = HashSet::new();
        for slot in 0..500 {
            let now = 1 + slot * 720_000;
            let id = select_due(&store, now).unwrap().album_id.clone();
            assert!(
                checked.insert(id.clone()),
                "rechecked before first rotation completed"
            );
            let album = store
                .albums
                .iter_mut()
                .find(|album| album.album_id == id)
                .unwrap();
            record_check_outcome(album, 0, now);
        }
        assert_eq!(checked.len(), 500);
        for album in &mut store.albums[..250] {
            album.paused = true;
        }
        for album in &mut store.albums[250..400] {
            album.fulfilled = true;
        }
        assert_eq!(effective_cadence(&store, Some(720)), Some(1_200));
        store.interval_minutes = 0;
        assert!(select_due(&store, u64::MAX).is_none());
        assert_eq!(effective_cadence(&store, Some(720)), None);
    }

    #[test]
    fn empty_checks_back_off_persist_and_success_and_restoration_reset_them() {
        let mut store = schedule_store(1);
        for (now, minutes) in [(10, 60), (20, 360), (30, 1440), (40, 1440)] {
            record_check_outcome(&mut store.albums[0], 0, now);
            assert_eq!(album_interval_minutes(&store.albums[0], 30), minutes);
            assert_eq!(next_check_at(&store, now), Some(now + minutes * 60_000));
        }
        let restored = decode_store(&serde_json::to_vec(&store).unwrap()).unwrap();
        assert_eq!(restored.albums[0].consecutive_misses, 4);
        record_check_outcome(&mut store.albums[0], 2, 50);
        assert_eq!(store.albums[0].last_found_at_ms, Some(50));
        assert_eq!(album_interval_minutes(&store.albums[0], 15), 15);
        record_check_outcome(&mut store.albums[0], 0, 60);
        reset_for_watch(&mut store.albums[0], 70);
        assert_eq!(store.albums[0].consecutive_misses, 0);
        assert_eq!(next_check_at(&store, 70), Some(70));
    }

    #[test]
    fn due_order_gives_new_and_successful_watches_slots_while_quiet_watches_back_off() {
        let mut store = schedule_store(3);
        for _ in 0..3 {
            record_check_outcome(&mut store.albums[0], 0, 100);
        }
        record_check_outcome(&mut store.albums[1], 1, 100);
        assert_eq!(select_due(&store, 101).unwrap().album_id, "album-002");
        store.albums[2].paused = true;
        assert!(select_due(&store, 101).is_none());
        assert_eq!(
            select_due(&store, 100 + 30 * 60_000).unwrap().album_id,
            "album-001"
        );
        store.albums[1].fulfilled = true;
        assert!(select_due(&store, 100 + 30 * 60_000).is_none());
        assert_eq!(
            select_due(&store, 100 + 24 * 60 * 60_000).unwrap().album_id,
            "album-000"
        );
    }

    #[test]
    fn v2_migration_preserves_watch_history_without_inventing_misses() {
        let mut value = serde_json::to_value(schedule_store(1)).unwrap();
        value["version"] = 2.into();
        let album = value["albums"][0].as_object_mut().unwrap();
        album.remove("consecutiveMisses");
        album.remove("lastFoundAtMs");
        album.insert("lastCheckedAtMs".to_owned(), 123.into());
        album.insert("sourceCount".to_owned(), 2.into());
        let migrated = decode_store(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(migrated.version, STORE_VERSION);
        assert_eq!(migrated.albums[0].last_found_at_ms, Some(123));
        assert_eq!(migrated.albums[0].consecutive_misses, 0);
        assert_eq!(migrated.albums[0].last_checked_at_ms, Some(123));
    }

    #[test]
    fn corrupt_store_recovers_fixture_and_future_schema_is_write_protected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wanted.json");
        let bytes = include_bytes!("../../fixtures/stores/wanted-v1.json");
        std::fs::write(dir.path().join("wanted.json.bak"), bytes).unwrap();
        std::fs::write(&path, b"{truncated").unwrap();
        let file = JsonFile::new(path.clone());
        let recovered = load_store(&file).unwrap();
        assert_eq!(
            serde_json::to_value(&recovered).unwrap(),
            serde_json::to_value(decode_store(bytes).unwrap()).unwrap()
        );
        assert_eq!(file.notices().len(), 2);
        let future = br#"{"version":99,"future":"keep"}"#;
        std::fs::write(&path, future).unwrap();
        let file = JsonFile::new(path.clone());
        let fallback = load_store(&file).unwrap();
        assert!(file.save(&fallback).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), future);
    }

    #[test]
    fn migrates_legacy_fixture_and_keeps_original_backup() {
        let bytes = include_bytes!("../../fixtures/stores/wanted-v1.json");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wanted.json");
        std::fs::write(&path, bytes).unwrap();
        let file = JsonFile::new(path.clone());
        let store = load_store(&file).unwrap();
        assert_eq!(store.version, STORE_VERSION);
        assert_eq!(store.albums[0].album_id, "legacy-album");
        assert_eq!(store.albums[0].preferences, WantedPreferences::default());
        assert!(file.notices().is_empty());
        assert_eq!(
            std::fs::read(dir.path().join("wanted.json.bak")).unwrap(),
            bytes
        );
        let migrated = std::fs::read(&path).unwrap();
        let again = load_store(&JsonFile::new(path)).unwrap();
        assert_eq!(
            serde_json::to_value(&store).unwrap(),
            serde_json::to_value(again).unwrap()
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&migrated).unwrap()["version"],
            STORE_VERSION
        );
    }

    use crate::connection::protocol::SearchFile;
    use std::fs;

    fn test_tracks(
        format: &str,
        count: usize,
        bitrate: Option<u32>,
    ) -> HashMap<String, RankingTrack> {
        (0..count)
            .map(|i| {
                let name = format!("{i}. Song.{format}");
                (
                    name.clone(),
                    RankingTrack {
                        id: name.clone(),
                        name,
                        format: format.into(),
                        bitrate,
                        duration_seconds: None,
                    },
                )
            })
            .collect()
    }

    fn request(id: &str) -> WantedAlbumRequest {
        WantedAlbumRequest {
            album_id: id.to_owned(),
            artist: "Def Leppard".to_owned(),
            title: "High 'n' Dry".to_owned(),
            first_release_date: "1981-07-11".to_owned(),
            cover_art_url: Some("https://coverartarchive.org/cover.jpg".to_owned()),
            minimum_track_count: None,
        }
    }

    fn response(
        token: u32,
        username: &str,
        folder: &str,
        format: &str,
        tracks: u32,
    ) -> SearchResponse {
        SearchResponse {
            username: username.to_owned(),
            token,
            files: (1..=tracks)
                .map(|track| SearchFile {
                    filename: format!("{folder}\\{track:02}. Song.{format}"),
                    size_bytes: 10_000_000,
                    extension: format.to_owned(),
                    bitrate: None,
                    duration_seconds: Some(240),
                    vbr: None,
                    sample_rate: None,
                    bit_depth: None,
                    is_private: false,
                })
                .collect(),
            slot_free: true,
            average_speed: 5_000_000,
            queue_length: 0,
        }
    }

    #[test]
    fn source_summary_groups_tracks_by_user_and_folder() {
        let mut sources = HashMap::new();
        for response in [
            response(7, "listener", "Music\\Album", "flac", 10),
            response(7, "listener", "Music\\Album", "jpg", 1),
            response(7, "another", "Shares\\Album", "mp3", 9),
        ] {
            for file in response.files {
                let extension = file.extension.to_ascii_lowercase();
                if !matching::is_audio(&extension) {
                    continue;
                }
                let key = format!(
                    "{}\u{0}{}",
                    response.username,
                    parent_folder(&file.filename)
                );
                let source: &mut SourceAggregate = sources.entry(key).or_default();
                source.username = response.username.clone();
                source.folder = parent_folder(&file.filename).to_owned();
                source.tracks.insert(
                    file.filename.clone(),
                    RankingTrack {
                        id: file.filename.clone(),
                        name: file.filename.clone(),
                        format: extension.to_ascii_uppercase(),
                        bitrate: file.bitrate,
                        duration_seconds: file.duration_seconds,
                    },
                );
                source.track_count += 1;
                source.total_size_bytes += file.size_bytes;

                source.slot_free = response.slot_free;
            }
        }
        let summary = summarize_sources(sources, &WantedPreferences::default());
        assert_eq!(summary.source_count, 2);
        assert_eq!(summary.matching_source_count, 1);
        assert_eq!(summary.ready_source_count, 2);
        assert_eq!(summary.complete_source_count, 1);
        assert_eq!(summary.best_track_count, Some(10));
        assert_eq!(summary.best_format.as_deref(), Some("FLAC"));
    }

    #[test]
    fn wanted_store_round_trips_without_touching_archive_data() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("wanted.json");
        let mut store = WantedStore::default();
        store.albums.push(WantedAlbum {
            album_id: request("album-1").album_id,
            artist: "Def Leppard".to_owned(),
            title: "High 'n' Dry".to_owned(),
            first_release_date: "1981".to_owned(),
            cover_art_url: None,
            paused: false,
            fulfilled: false,
            fulfilled_at_ms: None,
            fulfillment_source: None,
            download_receipt: None,
            owned_track_count: None,
            watch_despite_ownership: false,
            preferences: WantedPreferences::default(),
            selected_release_id: None,
            added_at_ms: 1,
            last_checked_at_ms: None,
            consecutive_misses: 0,
            last_found_at_ms: None,
            source_count: 0,
            matching_source_count: 0,
            ready_source_count: 0,
            complete_source_count: 0,
            new_source_count: 0,
            best_format: None,
            best_track_count: None,
            best_size_bytes: None,
            best_speed_bytes_per_second: None,
            best_source: None,
            error: None,
            source_fingerprints: vec!["listener\0Music/Artist/Album".to_string()],
        });
        fs::write(&path, serde_json::to_vec_pretty(&store).unwrap()).unwrap();
        let restored = load_store(&JsonFile::new(path.clone())).unwrap();
        assert_eq!(restored.albums.len(), 1);
        assert_eq!(
            restored.albums[0].source_fingerprints,
            vec!["listener\0Music/Artist/Album"]
        );
        assert_eq!(restored.interval_minutes, DEFAULT_INTERVAL_MINUTES);
        let original_preferences = restored.albums[0].preferences.clone();
        let mut album = restored.albums[0].clone();
        album.matching_source_count = 3;
        album.last_checked_at_ms = Some(123);
        let edition = "11111111-1111-1111-1111-111111111111";
        change_edition(&mut album, Some(edition.into()));
        assert_eq!(album.matching_source_count, 0);
        assert!(album.last_checked_at_ms.is_none());
        assert!(album.source_fingerprints.is_empty());
        assert_eq!(album.preferences, original_preferences);
        store.albums[0] = album;
        JsonFile::new(path.clone()).save(&store).unwrap();
        let restored = load_store(&JsonFile::new(path)).unwrap();
        assert_eq!(
            restored.albums[0].selected_release_id.as_deref(),
            Some(edition)
        );
    }

    #[test]
    fn older_wanted_albums_receive_safe_smart_match_defaults() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("wanted.json");
        let legacy_store = serde_json::json!({
            "version": 1,
            "interval_minutes": 30,
            "albums": [{
                "albumId": "legacy-album",
                "artist": "Def Leppard",
                "title": "High 'n' Dry",
                "firstReleaseDate": "1981",
                "coverArtUrl": null,
                "paused": false,
                "addedAtMs": 1,
                "lastCheckedAtMs": null,
                "sourceCount": 2,
                "readySourceCount": 1,
                "completeSourceCount": 1,
                "newSourceCount": 0,
                "bestFormat": "FLAC",
                "bestTrackCount": 10,
                "bestSizeBytes": 500000000,
                "bestSpeedBytesPerSecond": 5000000,
                "error": null,
                "sourceFingerprints": []
            }]
        });
        fs::write(&path, serde_json::to_vec_pretty(&legacy_store).unwrap()).unwrap();

        let restored =
            load_store(&JsonFile::new(path.clone())).expect("load the 0.0.25 Wanted store");
        let album = &restored.albums[0];
        assert_eq!(album.preferences, WantedPreferences::default());
        assert!(!album.fulfilled);
        assert_eq!(album.matching_source_count, 0);
        assert!(album.best_source.is_none());
    }

    #[test]
    fn only_supported_intervals_are_accepted_by_the_contract() {
        assert!(matches!(15, 0 | 15 | 30 | 60));
        assert!(!matches!(5, 0 | 15 | 30 | 60));
    }

    #[test]
    fn bulk_adds_share_one_profile_and_existing_watches_are_not_duplicated() {
        let mut store = WantedStore::default();
        let profile = WantedPreferences {
            format_preference: WantedFormatPreference::LosslessOnly,
            minimum_bitrate_kbps: Some(320),
            minimum_track_count: Some(10),
        };
        let first = validate_request(request("album-1")).expect("valid first album");
        merge_bulk_requests(&mut store, vec![first], &WantedPreferences::default(), 1)
            .expect("seed watch");
        store.albums[0].paused = true;
        let existing = validate_request(request("ALBUM-1")).expect("valid duplicate album");
        let mut second_request = request("album-2");
        second_request.minimum_track_count = Some(12);
        let second = validate_request(second_request).expect("valid second album");
        merge_bulk_requests(&mut store, vec![existing, second], &profile, 2)
            .expect("merge bulk watches");

        assert_eq!(store.albums.len(), 2);
        assert_eq!(store.albums[0].preferences, profile);
        assert_eq!(store.albums[1].preferences.minimum_track_count, Some(12));
        assert_eq!(
            store.albums[1].preferences.format_preference,
            profile.format_preference
        );
        assert!(store.albums.iter().all(|album| !album.paused));
    }

    #[test]
    fn verified_download_fulfillment_is_persistent_and_idempotent() {
        let mut store = WantedStore::default();
        let profile = WantedPreferences::default();
        merge_bulk_requests(
            &mut store,
            vec![
                validate_request(request("album-1")).unwrap(),
                validate_request(request("album-2")).unwrap(),
            ],
            &profile,
            1,
        )
        .unwrap();
        let fulfillment = WantedDownloadFulfillmentRequest {
            album_id: "album-1".to_owned(),
            release_id: "release-1".to_owned(),
            username: "listener".to_owned(),
            format: "MP3".to_owned(),
            track_count: 10,
            size_bytes: 100_000_000,
            soundcheck: WantedDownloadSoundcheck::Passed,
            completed_at_ms: 500,
        };

        assert_eq!(
            fulfill_downloaded_in_store(&mut store, vec![fulfillment.clone()]),
            1
        );
        assert_eq!(store.albums.len(), 2);
        let completed = store
            .albums
            .iter()
            .find(|album| album.album_id == "album-1")
            .expect("fulfilled album remains on its shelf");
        assert!(completed.fulfilled);
        assert_eq!(
            completed.fulfillment_source,
            Some(WantedFulfillmentSource::Download)
        );
        assert_eq!(completed.fulfilled_at_ms, Some(500));
        assert_eq!(
            completed
                .download_receipt
                .as_ref()
                .map(|receipt| receipt.track_count),
            Some(10)
        );
        assert_eq!(
            fulfill_downloaded_in_store(&mut store, vec![fulfillment]),
            0
        );
        let completed = store
            .albums
            .iter_mut()
            .find(|album| album.album_id == "album-1")
            .expect("fulfilled album can be restored");
        reset_for_watch(completed, 600);
        assert!(!completed.fulfilled);
        assert_eq!(completed.added_at_ms, 600);
        assert_eq!(completed.fulfillment_source, None);
        assert_eq!(completed.download_receipt, None);
        assert!(completed.watch_despite_ownership);
        assert!(
            !store
                .albums
                .iter()
                .find(|album| album.album_id == "album-2")
                .expect("other watch remains")
                .fulfilled
        );
    }

    #[test]
    fn smart_match_prefers_complete_ready_lossless_sources() {
        let mut sources = HashMap::new();
        let lossless_key = "lossless\0Music\\Album".to_owned();
        sources.insert(
            lossless_key,
            SourceAggregate {
                username: "lossless".to_owned(),
                folder: "Music\\Album".to_owned(),
                track_count: 10,
                total_size_bytes: 500_000_000,

                slot_free: true,
                average_speed: 8_000_000,
                queue_length: 0,

                tracks: test_tracks("FLAC", 10, None),
            },
        );
        sources.insert(
            "mp3\0Music\\Album".to_owned(),
            SourceAggregate {
                username: "mp3".to_owned(),
                folder: "Music\\Album".to_owned(),
                track_count: 12,
                total_size_bytes: 120_000_000,

                slot_free: true,
                average_speed: 12_000_000,
                queue_length: 0,

                tracks: test_tracks("MP3", 12, Some(320)),
            },
        );
        let summary = summarize_sources(sources, &WantedPreferences::default());
        assert_eq!(summary.matching_source_count, 2);
        assert_eq!(summary.best_source.unwrap().username, "lossless");
    }

    #[test]
    fn background_summary_uses_the_same_ranking_as_the_review_command() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/matching.json")).unwrap();
        for case in fixture["ranking"].as_array().unwrap() {
            let inputs: Vec<RankingSource> =
                serde_json::from_value(case["sources"].clone()).unwrap();
            let preferences = serde_json::from_value(case["preferences"].clone()).unwrap();
            let official: Vec<AlbumTrack> =
                serde_json::from_value(case["officialTracks"].clone()).unwrap();
            let sources = inputs
                .iter()
                .map(|source| {
                    (
                        source.id.clone(),
                        SourceAggregate {
                            username: source.owner.clone(),
                            folder: source.folder.clone(),
                            track_count: source.tracks.len() as u32,
                            tracks: source
                                .tracks
                                .iter()
                                .map(|track| (track.id.clone(), track.clone()))
                                .collect(),
                            slot_free: source.slot_free,
                            average_speed: source.average_speed,
                            queue_length: source.queue_length,
                            ..SourceAggregate::default()
                        },
                    )
                })
                .collect();
            let ranked = matching::rank_sources(
                &inputs,
                &preferences,
                &official,
                case["artist"].as_str().unwrap(),
            );
            let summary = summarize_ranked_sources(
                sources,
                &preferences,
                &official,
                case["artist"].as_str().unwrap(),
            );
            assert_eq!(
                summary.matching_source_count as usize,
                ranked.iter().filter(|r| r.eligible).count()
            );
            let expected = ranked.iter().find(|r| r.eligible);
            assert_eq!(
                summary.best_source.as_ref().map(|s| s.score),
                expected.map(|r| r.score)
            );
            assert_eq!(
                summary.best_source.as_ref().map(|s| &s.tracklist_label),
                expected.map(|r| &r.tracklist_confidence.label)
            );
            assert_eq!(
                summary.best_source.as_ref().map(|s| s.username.as_str()),
                expected.map(|r| inputs
                    .iter()
                    .find(|s| s.id == r.source_id)
                    .unwrap()
                    .owner
                    .as_str())
            );
        }
    }

    #[test]
    fn duplicate_replies_do_not_inflate_the_ranking_input() {
        let response = response(1, "listener", "Album", "flac", 2);
        let mut source = SourceAggregate::default();
        for _ in 0..3 {
            for file in &response.files {
                source.remember_file(file, "flac");
            }
        }
        assert_eq!(source.track_count, 2);
        assert_eq!(source.tracks.len(), 2);
        assert_eq!(source.total_size_bytes, 20_000_000);
    }

    #[tokio::test]
    async fn background_metadata_failure_and_timeout_use_the_count_fallback() {
        let timeout = Duration::from_millis(1);
        assert!(
            official_tracks_or_fallback(async { Err("offline".into()) }, timeout)
                .await
                .is_empty()
        );
        assert!(official_tracks_or_fallback(std::future::pending(), timeout)
            .await
            .is_empty());
        let tracks = vec![AlbumTrack {
            position: 1,
            disc_number: 1,
            disc_position: 1,
            title: "Song".into(),
            duration_ms: None,
        }];
        assert_eq!(
            official_tracks_or_fallback(async { Ok(tracks) }, timeout).await[0].title,
            "Song"
        );
    }

    #[test]
    fn mp3_only_rejects_lossless_and_mixed_format_folders() {
        let preferences = WantedPreferences {
            format_preference: WantedFormatPreference::Mp3Only,
            minimum_bitrate_kbps: Some(320),
            minimum_track_count: None,
        };
        let mp3 = SourceAggregate {
            tracks: test_tracks("MP3", 1, Some(320)),

            ..SourceAggregate::default()
        };
        let flac = SourceAggregate {
            tracks: test_tracks("FLAC", 1, None),

            ..SourceAggregate::default()
        };
        let mixed = SourceAggregate {
            tracks: test_tracks("MP3", 1, Some(320))
                .into_iter()
                .chain(test_tracks("FLAC", 1, None))
                .collect(),

            ..SourceAggregate::default()
        };
        assert!(source_matches(&mp3, &preferences));
        assert!(!source_matches(&flac, &preferences));
        assert!(!source_matches(&mixed, &preferences));
    }
}
