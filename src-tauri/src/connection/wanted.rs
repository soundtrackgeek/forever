use super::protocol::SearchResponse;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

pub const WANTED_EVENT: &str = "forever://wanted";
const STORE_VERSION: u32 = 1;
const DEFAULT_INTERVAL_MINUTES: u32 = 30;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const SEARCH_COOLDOWN: Duration = Duration::from_secs(5);
const MAX_WANTED_ALBUMS: usize = 500;
const AUDIO_EXTENSIONS: &[&str] = &[
    "aac", "aiff", "alac", "ape", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma", "wv",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedAlbumRequest {
    pub album_id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
    pub cover_art_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WantedFormatPreference {
    Any,
    #[default]
    PreferLossless,
    LosslessOnly,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedPreferences {
    pub format_preference: WantedFormatPreference,
    pub minimum_bitrate_kbps: Option<u32>,
    pub minimum_track_count: Option<u32>,
}

impl Default for WantedPreferences {
    fn default() -> Self {
        Self {
            format_preference: WantedFormatPreference::PreferLossless,
            minimum_bitrate_kbps: Some(320),
            minimum_track_count: None,
        }
    }
}

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
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WantedFulfillmentRequest {
    pub album_id: String,
    pub owned: bool,
    pub track_count: Option<u32>,
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
    pub owned_track_count: Option<u32>,
    #[serde(default)]
    pub preferences: WantedPreferences,
    pub added_at_ms: u64,
    pub last_checked_at_ms: Option<u64>,
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
    pub interval_minutes: u32,
    pub active_album_id: Option<String>,
    pub next_check_at_ms: Option<u64>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WantedStore {
    version: u32,
    interval_minutes: u32,
    albums: Vec<WantedAlbum>,
}

impl Default for WantedStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
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
    formats: HashSet<String>,
    slot_free: bool,
    average_speed: u32,
    queue_length: u32,
    minimum_bitrate_kbps: Option<u32>,
    unknown_lossy_bitrate: bool,
}

struct ActiveSearch {
    album_id: String,
    token: u32,
    deadline: Instant,
    sources: HashMap<String, SourceAggregate>,
}

#[derive(Default)]
struct WantedRuntime {
    active: Option<ActiveSearch>,
    next_allowed_at: Option<Instant>,
}

#[derive(Clone)]
pub struct WantedHub {
    app: AppHandle,
    path: PathBuf,
    store: Arc<RwLock<WantedStore>>,
    runtime: Arc<Mutex<WantedRuntime>>,
}

impl WantedHub {
    pub fn new(app: AppHandle, path: PathBuf) -> Result<Self, WantedError> {
        Ok(Self {
            app,
            path: path.clone(),
            store: Arc::new(RwLock::new(load_store(&path)?)),
            runtime: Arc::new(Mutex::new(WantedRuntime::default())),
        })
    }

    pub fn snapshot(&self) -> WantedSnapshot {
        let active_album_id = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active
            .as_ref()
            .map(|active| active.album_id.clone());
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = timestamp_ms();
        let next_check_at_ms = next_check_at(&store, now);
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
            interval_minutes: store.interval_minutes,
            active_album_id,
            next_check_at_ms,
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
            album.artist = request.artist;
            album.title = request.title;
            album.first_release_date = request.first_release_date;
            album.cover_art_url = request.cover_art_url;
            album.paused = false;
        } else {
            if store.albums.len() >= MAX_WANTED_ALBUMS {
                return Err(WantedError::TooManyAlbums);
            }
            store.albums.push(WantedAlbum {
                album_id: request.album_id,
                artist: request.artist,
                title: request.title,
                first_release_date: request.first_release_date,
                cover_art_url: request.cover_art_url,
                paused: false,
                fulfilled: false,
                fulfilled_at_ms: None,
                owned_track_count: None,
                preferences: WantedPreferences::default(),
                added_at_ms: timestamp_ms(),
                last_checked_at_ms: None,
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
            if album.fulfilled != fulfillment.owned || album.owned_track_count != owned_track_count
            {
                album.fulfilled = fulfillment.owned;
                album.fulfilled_at_ms = fulfillment.owned.then(timestamp_ms);
                album.owned_track_count = owned_track_count;
                if fulfillment.owned {
                    album.new_source_count = 0;
                } else {
                    album.last_checked_at_ms = None;
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
            if store.interval_minutes == 0 {
                return None;
            }
            store
                .albums
                .iter()
                .filter(|album| {
                    !album.paused
                        && !album.fulfilled
                        && album_due(album, store.interval_minutes, now)
                })
                .min_by_key(|album| album.last_checked_at_ms.unwrap_or(0))
                .map(|album| album.album_id.clone())
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
        if !force
            && runtime
                .next_allowed_at
                .is_some_and(|next_allowed| Instant::now() < next_allowed)
        {
            return Err(WantedError::RateLimited);
        }
        let query = {
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
            format!("{} {}", album.artist, album.title)
        };
        runtime.active = Some(ActiveSearch {
            album_id: album_id.to_owned(),
            token,
            deadline: Instant::now() + SEARCH_TIMEOUT,
            sources: HashMap::new(),
        });
        drop(runtime);
        self.publish();
        Ok(query)
    }

    pub fn record(&self, response: &SearchResponse) {
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(active) = runtime
            .active
            .as_mut()
            .filter(|active| active.token == response.token)
        else {
            return;
        };
        for file in &response.files {
            let extension = file.extension.trim_start_matches('.').to_ascii_lowercase();
            if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
                continue;
            }
            let folder = parent_folder(&file.filename);
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
            source.track_count = source.track_count.saturating_add(1);
            source.total_size_bytes = source.total_size_bytes.saturating_add(file.size_bytes);
            source.formats.insert(extension.to_ascii_uppercase());
            source.slot_free |= response.slot_free;
            source.average_speed = source.average_speed.max(response.average_speed);
            if !is_lossless(&extension) {
                match file.bitrate {
                    Some(bitrate) => {
                        source.minimum_bitrate_kbps = Some(
                            source
                                .minimum_bitrate_kbps
                                .map_or(bitrate, |current| current.min(bitrate)),
                        );
                    }
                    None => source.unknown_lossy_bitrate = true,
                }
            }
        }
    }

    pub fn expire_if_due(&self) {
        let active = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime
                .active
                .as_ref()
                .is_some_and(|active| Instant::now() >= active.deadline)
            {
                runtime.next_allowed_at = Some(Instant::now() + SEARCH_COOLDOWN);
                runtime.active.take()
            } else {
                None
            }
        };
        if let Some(active) = active {
            self.finish(active);
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
            .find(|album| album.album_id == active.album_id)
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
        let preferences = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .albums
            .iter()
            .find(|album| album.album_id == active.album_id)
            .map(|album| album.preferences.clone())
            .unwrap_or_default();
        let summary = summarize_sources(active.sources, &preferences);
        if let Some(album) = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .albums
            .iter_mut()
            .find(|album| album.album_id == active.album_id)
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
            album.last_checked_at_ms = Some(timestamp_ms());
            album.error = None;
            album.source_fingerprints = summary.source_fingerprints;
        }
        let _ = self.persist();
        self.publish();
    }

    fn persist(&self) -> Result<(), WantedError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        fs::write(&self.path, serde_json::to_vec_pretty(&*store)?)?;
        Ok(())
    }

    fn publish(&self) {
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

fn summarize_sources(
    sources: HashMap<String, SourceAggregate>,
    preferences: &WantedPreferences,
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
    let mut matching_sources: Vec<_> = sources
        .iter()
        .filter(|(_, source)| source_matches(source, preferences))
        .collect();
    matching_sources.sort_by(|(_, left), (_, right)| {
        source_score(right, preferences)
            .cmp(&source_score(left, preferences))
            .then(right.track_count.cmp(&left.track_count))
            .then(right.slot_free.cmp(&left.slot_free))
            .then(right.average_speed.cmp(&left.average_speed))
            .then(left.queue_length.cmp(&right.queue_length))
    });
    let best_source = matching_sources
        .first()
        .map(|(_, source)| wanted_best_source(source, preferences));
    let mut source_fingerprints: Vec<_> = matching_sources
        .iter()
        .map(|(fingerprint, _)| (*fingerprint).clone())
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

fn source_matches(source: &SourceAggregate, preferences: &WantedPreferences) -> bool {
    if preferences
        .minimum_track_count
        .is_some_and(|minimum| source.track_count < minimum)
    {
        return false;
    }
    let lossless = source.formats.iter().any(|format| is_lossless(format));
    if preferences.format_preference == WantedFormatPreference::LosslessOnly && !lossless {
        return false;
    }
    if !lossless {
        if let Some(minimum) = preferences.minimum_bitrate_kbps {
            if source.unknown_lossy_bitrate
                || source
                    .minimum_bitrate_kbps
                    .is_none_or(|bitrate| bitrate < minimum)
            {
                return false;
            }
        }
    }
    true
}

fn wanted_best_source(
    source: &SourceAggregate,
    preferences: &WantedPreferences,
) -> WantedBestSource {
    WantedBestSource {
        username: source.username.clone(),
        folder: source.folder.clone(),
        format: best_format(source).unwrap_or_else(|| "Unknown".to_owned()),
        track_count: source.track_count,
        size_bytes: source.total_size_bytes,
        slot_free: source.slot_free,
        average_speed_bytes_per_second: source.average_speed,
        queue_length: source.queue_length,
        minimum_bitrate_kbps: source.minimum_bitrate_kbps,
        score: source_score(source, preferences),
    }
}

fn source_score(source: &SourceAggregate, preferences: &WantedPreferences) -> u32 {
    let lossless = source.formats.iter().any(|format| is_lossless(format));
    let preference_bonus = match preferences.format_preference {
        WantedFormatPreference::PreferLossless if lossless => 500,
        WantedFormatPreference::LosslessOnly => 500,
        _ => 0,
    };
    let format_bonus = best_format(source)
        .map(|format| u32::from(format_rank(&format)) * 20)
        .unwrap_or(0);
    preference_bonus
        + format_bonus
        + source.track_count.saturating_mul(30)
        + u32::from(source.slot_free) * 180
        + (source.average_speed / 100_000).min(120)
        + 100u32.saturating_sub(source.queue_length.min(20).saturating_mul(5))
}

fn best_format(source: &SourceAggregate) -> Option<String> {
    source
        .formats
        .iter()
        .max_by_key(|format| format_rank(format))
        .cloned()
}

fn is_lossless(format: &str) -> bool {
    matches!(
        format.to_ascii_uppercase().as_str(),
        "FLAC" | "ALAC" | "WAV" | "AIFF" | "APE" | "WV"
    )
}

fn format_rank(format: &str) -> u8 {
    match format {
        "FLAC" => 10,
        "ALAC" => 9,
        "WAV" | "AIFF" => 8,
        "APE" | "WV" => 7,
        "MP3" => 5,
        "M4A" | "AAC" => 4,
        "OGG" | "OPUS" => 3,
        "WMA" => 2,
        _ => 1,
    }
}

fn parent_folder(filename: &str) -> &str {
    filename
        .rfind(['\\', '/'])
        .map(|index| &filename[..index])
        .unwrap_or("")
}

fn next_check_at(store: &WantedStore, now: u64) -> Option<u64> {
    if store.interval_minutes == 0 {
        return None;
    }
    let interval_ms = u64::from(store.interval_minutes) * 60_000;
    store
        .albums
        .iter()
        .filter(|album| !album.paused && !album.fulfilled)
        .map(|album| {
            album
                .last_checked_at_ms
                .map(|checked| checked.saturating_add(interval_ms))
                .unwrap_or(now)
        })
        .min()
}

fn album_due(album: &WantedAlbum, interval_minutes: u32, now: u64) -> bool {
    album
        .last_checked_at_ms
        .map(|checked| now >= checked.saturating_add(u64::from(interval_minutes) * 60_000))
        .unwrap_or(true)
}

fn validate_request(mut request: WantedAlbumRequest) -> Result<WantedAlbumRequest, WantedError> {
    request.album_id = valid_album_id(&request.album_id)?.to_owned();
    request.artist = valid_text(&request.artist, 180)?;
    request.title = valid_text(&request.title, 500)?;
    request.first_release_date = request.first_release_date.trim().chars().take(32).collect();
    request.cover_art_url = request
        .cover_art_url
        .map(|value| value.trim().chars().take(2_048).collect())
        .filter(|value: &String| value.starts_with("https://"));
    Ok(request)
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

fn load_store(path: &Path) -> Result<WantedStore, WantedError> {
    if !path.exists() {
        return Ok(WantedStore::default());
    }
    let store: WantedStore = serde_json::from_slice(&fs::read(path)?)?;
    if store.version != STORE_VERSION {
        return Err(WantedError::UnsupportedStore);
    }
    Ok(store)
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
    #[error("Wanted checks are briefly cooling down.")]
    RateLimited,
    #[error("Choose Manual, 15 minutes, 30 minutes, or 1 hour.")]
    InvalidInterval,
    #[error("Choose valid Smart Match format, bitrate, and track requirements.")]
    InvalidPreferences,
    #[error("Forever supports up to {MAX_WANTED_ALBUMS} wanted albums.")]
    TooManyAlbums,
    #[error("The Wanted data was created by an unsupported Forever version.")]
    UnsupportedStore,
    #[error("Could not read or save Wanted data: {0}")]
    Io(#[from] std::io::Error),
    #[error("Could not read or save Wanted data: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::protocol::SearchFile;

    fn request(id: &str) -> WantedAlbumRequest {
        WantedAlbumRequest {
            album_id: id.to_owned(),
            artist: "Def Leppard".to_owned(),
            title: "High 'n' Dry".to_owned(),
            first_release_date: "1981-07-11".to_owned(),
            cover_art_url: Some("https://coverartarchive.org/cover.jpg".to_owned()),
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
                if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
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
                source.track_count += 1;
                source.total_size_bytes += file.size_bytes;
                source.formats.insert(extension.to_ascii_uppercase());
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
            owned_track_count: None,
            preferences: WantedPreferences::default(),
            added_at_ms: 1,
            last_checked_at_ms: None,
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
        let restored = load_store(&path).unwrap();
        assert_eq!(restored.albums.len(), 1);
        assert_eq!(
            restored.albums[0].source_fingerprints,
            vec!["listener\0Music/Artist/Album"]
        );
        assert_eq!(restored.interval_minutes, DEFAULT_INTERVAL_MINUTES);
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

        let restored = load_store(&path).expect("load the 0.0.25 Wanted store");
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
                formats: HashSet::from(["FLAC".to_owned()]),
                slot_free: true,
                average_speed: 8_000_000,
                queue_length: 0,
                minimum_bitrate_kbps: None,
                unknown_lossy_bitrate: false,
            },
        );
        sources.insert(
            "mp3\0Music\\Album".to_owned(),
            SourceAggregate {
                username: "mp3".to_owned(),
                folder: "Music\\Album".to_owned(),
                track_count: 12,
                total_size_bytes: 120_000_000,
                formats: HashSet::from(["MP3".to_owned()]),
                slot_free: true,
                average_speed: 12_000_000,
                queue_length: 0,
                minimum_bitrate_kbps: Some(320),
                unknown_lossy_bitrate: false,
            },
        );
        let summary = summarize_sources(sources, &WantedPreferences::default());
        assert_eq!(summary.matching_source_count, 2);
        assert_eq!(summary.best_source.unwrap().username, "lossless");
    }
}
