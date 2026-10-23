use super::album_query::{AlbumIdentity, AlbumQueryPlan, QueryMemory};
use super::{protocol::SearchResponse, search::SearchResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

pub const RADAR_EVENT: &str = "forever://radar";
const MAX_RADAR_ALBUMS: usize = 12;
const RADAR_SEARCH_TIMEOUT: Duration = Duration::from_secs(12);
const RADAR_SEARCH_COOLDOWN: Duration = Duration::from_secs(1);
const RADAR_RESULT_LIMIT: usize = 2_000;
const RADAR_EVENT_BATCH_SIZE: usize = 200;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarAlbumRequest {
    pub album_id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
    pub cover_art_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RadarState {
    Idle,
    Scanning,
    Completed,
    Stopped,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RadarAlbumState {
    Queued,
    Scanning,
    Completed,
    Stopped,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarAlbumScan {
    pub album_id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
    pub cover_art_url: Option<String>,
    pub state: RadarAlbumState,
    pub result_count: u32,
    pub peer_count: u32,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    pub error: Option<String>,
}

impl RadarAlbumScan {
    fn queued(request: RadarAlbumRequest) -> Self {
        Self {
            album_id: request.album_id,
            artist: request.artist,
            title: request.title,
            first_release_date: request.first_release_date,
            cover_art_url: request.cover_art_url,
            state: RadarAlbumState::Queued,
            result_count: 0,
            peer_count: 0,
            started_at_ms: None,
            finished_at_ms: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarSnapshot {
    pub state: RadarState,
    pub albums: Vec<RadarAlbumScan>,
    pub active_album_id: Option<String>,
    pub completed_count: u32,
    pub total_count: u32,
    pub message: String,
    pub updated_at_ms: u64,
}

impl RadarSnapshot {
    fn idle() -> Self {
        Self {
            state: RadarState::Idle,
            albums: Vec::new(),
            active_album_id: None,
            completed_count: 0,
            total_count: 0,
            message: "Shelf Radar is ready.".to_owned(),
            updated_at_ms: timestamp_ms(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadarEvent {
    event: &'static str,
    snapshot: RadarSnapshot,
    album_id: Option<String>,
    results: Vec<SearchResult>,
}

struct ActiveRadarSearch {
    album_index: usize,
    token: u32,
    deadline: Option<Instant>,
    plan: AlbumQueryPlan,
    seen: HashSet<String>,
    peers: HashSet<String>,
    next_result_id: u64,
}

struct RadarRuntime {
    snapshot: RadarSnapshot,
    queue: VecDeque<usize>,
    active: Option<ActiveRadarSearch>,
    next_allowed_at: Option<Instant>,
    queries: QueryMemory,
}

impl RadarRuntime {
    fn new() -> Self {
        Self {
            snapshot: RadarSnapshot::idle(),
            queue: VecDeque::new(),
            active: None,
            next_allowed_at: None,
            queries: QueryMemory::default(),
        }
    }

    fn begin(&mut self, requests: Vec<RadarAlbumRequest>) -> Result<RadarSnapshot, RadarError> {
        let requests = validate_requests(requests)?;
        for request in &requests {
            self.queries
                .plan(&AlbumIdentity {
                    artist: request.artist.clone(),
                    title: request.title.clone(),
                })
                .map_err(|_| RadarError::InvalidAlbum)?;
        }
        self.snapshot = RadarSnapshot {
            state: RadarState::Scanning,
            total_count: requests.len().try_into().unwrap_or(u32::MAX),
            albums: requests.into_iter().map(RadarAlbumScan::queued).collect(),
            active_album_id: None,
            completed_count: 0,
            message: "Preparing a bounded Shelf Radar scan…".to_owned(),
            updated_at_ms: timestamp_ms(),
        };
        self.queue = (0..self.snapshot.albums.len()).collect();
        self.active = None;
        self.next_allowed_at = None;
        Ok(self.snapshot.clone())
    }

    fn start_next(&mut self, token: u32) -> Option<(String, String)> {
        if self.snapshot.state != RadarState::Scanning {
            return None;
        }
        if let Some(active) = &mut self.active {
            if active.deadline.is_some() {
                return None;
            }
            active.token = token;
            active.deadline = Some(Instant::now() + RADAR_SEARCH_TIMEOUT);
            self.snapshot.message = active.plan.status();
            return Some((
                self.snapshot.albums[active.album_index].album_id.clone(),
                active.plan.query().to_owned(),
            ));
        }
        if self
            .next_allowed_at
            .is_some_and(|allowed| Instant::now() < allowed)
        {
            return None;
        }
        let Some(album_index) = self.queue.pop_front() else {
            self.snapshot.state = RadarState::Completed;
            self.snapshot.active_album_id = None;
            self.snapshot.message = format!(
                "Shelf Radar finished {} {}.",
                self.snapshot.completed_count,
                if self.snapshot.completed_count == 1 {
                    "album"
                } else {
                    "albums"
                }
            );
            self.snapshot.updated_at_ms = timestamp_ms();
            return None;
        };
        let album = &mut self.snapshot.albums[album_index];
        album.state = RadarAlbumState::Scanning;
        album.started_at_ms = Some(timestamp_ms());
        album.finished_at_ms = None;
        album.error = None;
        let album_id = album.album_id.clone();
        let plan = self
            .queries
            .plan(&AlbumIdentity {
                artist: album.artist.clone(),
                title: album.title.clone(),
            })
            .ok()?;
        let query = plan.query().to_owned();
        self.snapshot.active_album_id = Some(album_id.clone());
        self.snapshot.message = plan.status();
        self.snapshot.updated_at_ms = timestamp_ms();
        self.active = Some(ActiveRadarSearch {
            album_index,
            token,
            deadline: Some(Instant::now() + RADAR_SEARCH_TIMEOUT),
            plan,
            seen: HashSet::new(),
            peers: HashSet::new(),
            next_result_id: 0,
        });
        Some((album_id, query))
    }

    fn record(&mut self, response: &SearchResponse) -> Option<(String, Vec<SearchResult>)> {
        let active = self.active.as_mut()?;
        if response.token != active.token || active.deadline.is_none() {
            return None;
        }
        let album_id = self.snapshot.albums[active.album_index].album_id.clone();
        let mut accepted = Vec::new();
        for file in &response.files {
            if !active.plan.accepts(&file.filename) {
                continue;
            }
            if active.seen.len() >= RADAR_RESULT_LIMIT {
                break;
            }
            let deduplication_key = format!(
                "{}\u{0}{}\u{0}{}",
                response.username, file.filename, file.size_bytes
            );
            if !active.seen.insert(deduplication_key) {
                continue;
            }
            active.next_result_id += 1;
            accepted.push(SearchResult {
                id: format!("radar:{}:{}", response.token, active.next_result_id),
                token: response.token,
                username: response.username.clone(),
                filename: file.filename.clone(),
                size_bytes: file.size_bytes,
                extension: file.extension.clone(),
                bitrate: file.bitrate,
                duration_seconds: file.duration_seconds,
                vbr: file.vbr,
                sample_rate: file.sample_rate,
                bit_depth: file.bit_depth,
                slot_free: response.slot_free,
                average_speed: response.average_speed,
                queue_length: response.queue_length,
                is_private: file.is_private,
            });
        }
        if !accepted.is_empty() {
            active.peers.insert(response.username.clone());
        }
        let album = &mut self.snapshot.albums[active.album_index];
        album.result_count = active.seen.len().try_into().unwrap_or(u32::MAX);
        album.peer_count = active.peers.len().try_into().unwrap_or(u32::MAX);
        self.snapshot.message = format!("{} answered for {}…", album.peer_count, album.title);
        self.snapshot.updated_at_ms = timestamp_ms();
        Some((album_id, accepted))
    }

    fn expire_if_due(&mut self) -> Option<String> {
        if self.active.as_ref().is_none_or(|active| {
            active
                .deadline
                .is_none_or(|deadline| Instant::now() < deadline)
        }) {
            return None;
        }
        let active = self.active.as_mut().unwrap();
        if active.seen.is_empty() && active.plan.advance() {
            active.deadline = None;
            self.snapshot.message = format!("No matches. Queued {}", active.plan.status());
            self.snapshot.updated_at_ms = timestamp_ms();
            return Some(self.snapshot.albums[active.album_index].album_id.clone());
        }
        self.finish_active(None)
    }

    fn fail_active(&mut self, message: String) -> Option<String> {
        self.finish_active(Some(message))
    }

    fn finish_active(&mut self, error: Option<String>) -> Option<String> {
        let active = self.active.take()?;
        if error.is_none() && !active.seen.is_empty() {
            self.queries.remember(&active.plan);
        }
        let album = &mut self.snapshot.albums[active.album_index];
        let album_id = album.album_id.clone();
        album.finished_at_ms = Some(timestamp_ms());
        if let Some(message) = error {
            album.state = RadarAlbumState::Error;
            album.error = Some(message);
        } else {
            album.state = RadarAlbumState::Completed;
            self.snapshot.completed_count = self.snapshot.completed_count.saturating_add(1);
        }
        self.snapshot.active_album_id = None;
        self.snapshot.updated_at_ms = timestamp_ms();
        self.next_allowed_at = Some(Instant::now() + RADAR_SEARCH_COOLDOWN);
        if self.queue.is_empty() {
            self.snapshot.state = if album.state == RadarAlbumState::Error {
                RadarState::Error
            } else {
                RadarState::Completed
            };
            self.snapshot.message = if album.state == RadarAlbumState::Error {
                "Shelf Radar stopped after a search error.".to_owned()
            } else {
                format!(
                    "Shelf Radar finished {} albums.",
                    self.snapshot.completed_count
                )
            };
        } else {
            self.snapshot.message = "Waiting briefly before the next album…".to_owned();
        }
        Some(album_id)
    }

    fn stop(&mut self) -> RadarSnapshot {
        if self.snapshot.state != RadarState::Scanning {
            return self.snapshot.clone();
        }
        if let Some(active) = self.active.take() {
            let album = &mut self.snapshot.albums[active.album_index];
            album.state = RadarAlbumState::Stopped;
            album.finished_at_ms = Some(timestamp_ms());
        }
        for index in self.queue.drain(..) {
            self.snapshot.albums[index].state = RadarAlbumState::Stopped;
        }
        self.snapshot.state = RadarState::Stopped;
        self.snapshot.active_album_id = None;
        self.snapshot.message = "Shelf Radar scan stopped.".to_owned();
        self.snapshot.updated_at_ms = timestamp_ms();
        self.snapshot.clone()
    }

    fn connection_lost(&mut self) -> Option<RadarSnapshot> {
        if self.snapshot.state != RadarState::Scanning {
            return None;
        }
        if let Some(active) = self.active.take() {
            let album = &mut self.snapshot.albums[active.album_index];
            album.state = RadarAlbumState::Error;
            album.error = Some("The Soulseek connection was interrupted.".to_owned());
            album.finished_at_ms = Some(timestamp_ms());
        }
        for index in self.queue.drain(..) {
            let album = &mut self.snapshot.albums[index];
            album.state = RadarAlbumState::Error;
            album.error = Some("Reconnect before scanning this album.".to_owned());
        }
        self.snapshot.state = RadarState::Error;
        self.snapshot.active_album_id = None;
        self.snapshot.message = "Shelf Radar lost the Soulseek connection.".to_owned();
        self.snapshot.updated_at_ms = timestamp_ms();
        Some(self.snapshot.clone())
    }
}

#[derive(Clone)]
pub struct RadarHub {
    app: AppHandle,
    runtime: Arc<Mutex<RadarRuntime>>,
}

impl RadarHub {
    pub fn new(app: AppHandle, queries: QueryMemory) -> Self {
        let mut runtime = RadarRuntime::new();
        runtime.queries = queries;
        Self {
            app,
            runtime: Arc::new(Mutex::new(runtime)),
        }
    }

    pub fn snapshot(&self) -> RadarSnapshot {
        self.runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .snapshot
            .clone()
    }

    pub fn start(&self, requests: Vec<RadarAlbumRequest>) -> Result<RadarSnapshot, RadarError> {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .begin(requests)?;
        self.emit("started", snapshot.clone(), None, Vec::new());
        Ok(snapshot)
    }

    pub fn start_next(&self, token: u32) -> Option<(u32, String)> {
        let (album_id, query, snapshot) = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let (album_id, query) = runtime.start_next(token)?;
            (album_id, query, runtime.snapshot.clone())
        };
        self.emit("albumStarted", snapshot, Some(album_id), Vec::new());
        Some((token, query))
    }

    pub fn record(&self, response: &SearchResponse) {
        let Some((album_id, results, snapshot)) = ({
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime
                .record(response)
                .map(|(album_id, results)| (album_id, results, runtime.snapshot.clone()))
        }) else {
            return;
        };
        for batch in results.chunks(RADAR_EVENT_BATCH_SIZE) {
            self.emit(
                "results",
                snapshot.clone(),
                Some(album_id.clone()),
                batch.to_vec(),
            );
        }
    }

    pub fn expire_if_due(&self) {
        let completed = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime
                .expire_if_due()
                .map(|album_id| (album_id, runtime.snapshot.clone()))
        };
        if let Some((album_id, snapshot)) = completed {
            let event =
                if snapshot.albums.iter().any(|album| {
                    album.album_id == album_id && album.state == RadarAlbumState::Scanning
                }) {
                    "albumStarted"
                } else {
                    "albumCompleted"
                };
            self.emit(event, snapshot, Some(album_id), Vec::new());
        }
    }

    pub fn fail_active(&self, message: impl Into<String>) {
        let failed = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime
                .fail_active(message.into())
                .map(|album_id| (album_id, runtime.snapshot.clone()))
        };
        if let Some((album_id, snapshot)) = failed {
            self.emit("error", snapshot, Some(album_id), Vec::new());
        }
    }

    pub fn stop(&self) -> RadarSnapshot {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .stop();
        self.emit("stopped", snapshot.clone(), None, Vec::new());
        snapshot
    }

    pub fn connection_lost(&self) {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .connection_lost();
        if let Some(snapshot) = snapshot {
            self.emit("error", snapshot, None, Vec::new());
        }
    }

    fn emit(
        &self,
        event: &'static str,
        snapshot: RadarSnapshot,
        album_id: Option<String>,
        results: Vec<SearchResult>,
    ) {
        let _ = self.app.emit(
            RADAR_EVENT,
            RadarEvent {
                event,
                snapshot,
                album_id,
                results,
            },
        );
    }
}

fn validate_requests(
    requests: Vec<RadarAlbumRequest>,
) -> Result<Vec<RadarAlbumRequest>, RadarError> {
    if requests.is_empty() || requests.len() > MAX_RADAR_ALBUMS {
        return Err(RadarError::InvalidCount);
    }
    let mut seen = HashSet::new();
    let mut valid = Vec::new();
    for mut request in requests {
        request.album_id = request.album_id.trim().to_owned();
        request.artist = request.artist.trim().to_owned();
        request.title = request.title.trim().to_owned();
        request.first_release_date = request.first_release_date.trim().to_owned();
        if request.album_id.is_empty()
            || request.album_id.len() > 128
            || request.artist.is_empty()
            || request.artist.len() > 180
            || request.title.is_empty()
            || request.title.len() > 220
        {
            return Err(RadarError::InvalidAlbum);
        }
        if seen.insert(request.album_id.to_lowercase()) {
            valid.push(request);
        }
    }
    if valid.is_empty() {
        return Err(RadarError::InvalidCount);
    }
    Ok(valid)
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
pub enum RadarError {
    #[error("Choose between 1 and {MAX_RADAR_ALBUMS} albums for one Shelf Radar scan.")]
    InvalidCount,
    #[error("Shelf Radar received an invalid album identity.")]
    InvalidAlbum,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::protocol::SearchFile;

    #[test]
    fn empty_radar_attempts_retry_without_completing_album_or_accepting_old_tokens() {
        let mut runtime = RadarRuntime::new();
        runtime
            .begin(vec![request("one", "The Northern Lights")])
            .unwrap();
        assert_eq!(
            runtime.start_next(1).unwrap().1,
            "def leppard the northern lights"
        );
        runtime.active.as_mut().unwrap().deadline = Some(Instant::now());
        assert_eq!(runtime.expire_if_due(), Some("one".into()));
        assert_eq!(runtime.snapshot.completed_count, 0);
        assert_eq!(runtime.snapshot.state, RadarState::Scanning);
        assert!(runtime.active.as_ref().unwrap().deadline.is_none());
        let mut response = SearchResponse {
            token: 1,
            username: "source".into(),
            files: vec![SearchFile {
                filename: "Music\\Def Leppard\\The Northern Lights\\Track.flac".into(),
                size_bytes: 10,
                extension: "flac".into(),
                bitrate: None,
                duration_seconds: None,
                vbr: None,
                sample_rate: None,
                bit_depth: None,
                is_private: false,
            }],
            slot_free: true,
            average_speed: 1,
            queue_length: 0,
        };
        assert!(runtime.record(&response).is_none());
        assert_eq!(runtime.start_next(2).unwrap().1, "the northern lights");
        assert!(runtime.record(&response).is_none());
        response.token = 2;
        response.files[0].filename = "Other\\The Northern Lights\\01.flac".into();
        assert!(runtime.record(&response).unwrap().1.is_empty());
        response.files[0].filename = "Def Leppard\\The Northern Lights\\01.flac".into();
        assert_eq!(runtime.record(&response).unwrap().1.len(), 1);
        runtime.active.as_mut().unwrap().deadline = Some(Instant::now());
        runtime.expire_if_due();
        assert_eq!(runtime.snapshot.state, RadarState::Completed);
        assert_eq!(runtime.snapshot.completed_count, 1);
        assert_eq!(
            runtime
                .queries
                .plan(&AlbumIdentity {
                    artist: "Def Leppard".into(),
                    title: "The Northern Lights".into()
                })
                .unwrap()
                .query(),
            "the northern lights"
        );
        runtime
            .begin(vec![request("two", "Another Album")])
            .unwrap();
        runtime.start_next(3);
        runtime.active.as_mut().unwrap().deadline = Some(Instant::now());
        runtime.expire_if_due();
        runtime.stop();
        assert!(runtime.start_next(4).is_none());
    }

    fn request(id: &str, title: &str) -> RadarAlbumRequest {
        RadarAlbumRequest {
            album_id: id.to_owned(),
            artist: "Def Leppard".to_owned(),
            title: title.to_owned(),
            first_release_date: "1992".to_owned(),
            cover_art_url: None,
        }
    }

    #[test]
    fn bounded_scan_deduplicates_album_ids() {
        let requests = validate_requests(vec![
            request("one", "Adrenalize"),
            request("ONE", "Adrenalize"),
        ])
        .unwrap();
        assert_eq!(requests.len(), 1);
        assert!(validate_requests(Vec::new()).is_err());
        assert!(validate_requests(
            (0..13)
                .map(|index| request(&index.to_string(), "Album"))
                .collect()
        )
        .is_err());
    }

    #[test]
    fn runtime_routes_results_by_token_and_advances_sequentially() {
        let mut runtime = RadarRuntime::new();
        runtime
            .begin(vec![request("one", "Adrenalize"), request("two", "Slang")])
            .unwrap();
        let (album_id, _) = runtime.start_next(41).unwrap();
        assert_eq!(album_id, "one");
        let ignored = SearchResponse {
            username: "wrong".to_owned(),
            token: 99,
            files: Vec::new(),
            slot_free: true,
            average_speed: 1,
            queue_length: 0,
        };
        assert!(runtime.record(&ignored).is_none());
        let response = SearchResponse {
            username: "source".to_owned(),
            token: 41,
            files: vec![SearchFile {
                filename: "Music\\Adrenalize\\01 Heaven Is.flac".to_owned(),
                size_bytes: 42_000_000,
                extension: "flac".to_owned(),
                bitrate: Some(1_411),
                duration_seconds: Some(240),
                vbr: Some(false),
                sample_rate: Some(44_100),
                bit_depth: Some(16),
                is_private: false,
            }],
            slot_free: true,
            average_speed: 5_000_000,
            queue_length: 0,
        };
        let (_, results) = runtime.record(&response).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(runtime.snapshot.albums[0].peer_count, 1);
        runtime.finish_active(None);
        runtime.next_allowed_at = None;
        assert_eq!(runtime.start_next(42).unwrap().0, "two");
    }

    #[test]
    fn stopping_marks_remaining_work_without_discarding_finished_results() {
        let mut runtime = RadarRuntime::new();
        runtime
            .begin(vec![request("one", "Adrenalize"), request("two", "Slang")])
            .unwrap();
        runtime.start_next(41);
        runtime.finish_active(None);
        runtime.next_allowed_at = None;
        runtime.start_next(42);
        let stopped = runtime.stop();
        assert_eq!(stopped.state, RadarState::Stopped);
        assert_eq!(stopped.albums[0].state, RadarAlbumState::Completed);
        assert_eq!(stopped.albums[1].state, RadarAlbumState::Stopped);
    }
}
