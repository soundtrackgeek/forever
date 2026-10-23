use super::album_query::{next_token, AlbumIdentity, AlbumQueryPlan, QueryMemory};
use super::protocol::SearchResponse;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{atomic::AtomicU32, Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub const SEARCH_EVENT: &str = "forever://search";
pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const SEARCH_RESULT_LIMIT: usize = 5_000;
const SEARCH_EVENT_BATCH_SIZE: usize = 200;
const SEARCH_SESSION_LIMIT: usize = 8;
const RELAY_SESSION_LIMIT: usize = 4;
pub const RELAY_CLIENT_PREFIX: &str = "signal-relay:";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchState {
    Idle,
    Searching,
    Completed,
    Stopped,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnapshot {
    pub state: SearchState,
    pub token: Option<u32>,
    pub client_id: String,
    pub query: String,
    pub result_count: u32,
    pub peer_count: u32,
    pub message: String,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
}

impl SearchSnapshot {
    pub fn idle() -> Self {
        Self {
            state: SearchState::Idle,
            token: None,
            client_id: String::new(),
            query: String::new(),
            result_count: 0,
            peer_count: 0,
            message: "Ready for a live search.".to_owned(),
            started_at_ms: None,
            finished_at_ms: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub token: u32,
    pub username: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub bitrate: Option<u32>,
    pub duration_seconds: Option<u32>,
    pub vbr: Option<bool>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub slot_free: bool,
    pub average_speed: u32,
    pub queue_length: u32,
    pub is_private: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEvent {
    pub event: &'static str,
    pub snapshot: SearchSnapshot,
    pub results: Vec<SearchResult>,
}

struct SearchRuntime {
    snapshot: SearchSnapshot,
    deadline: Option<Instant>,
    seen: HashSet<String>,
    peers: HashSet<String>,
    next_result_id: u64,
    queued_at: Instant,
    plan: Option<AlbumQueryPlan>,
}

impl SearchRuntime {
    fn new() -> Self {
        Self {
            snapshot: SearchSnapshot::idle(),
            deadline: None,
            seen: HashSet::new(),
            peers: HashSet::new(),
            next_result_id: 0,
            queued_at: Instant::now(),
            plan: None,
        }
    }

    fn start(&mut self, token: u32, client_id: String, query: String) -> SearchSnapshot {
        self.seen.clear();
        self.peers.clear();
        self.next_result_id = 0;
        self.deadline = Some(Instant::now() + SEARCH_TIMEOUT);
        self.snapshot = SearchSnapshot {
            state: SearchState::Searching,
            token: Some(token),
            client_id,
            query,
            result_count: 0,
            peer_count: 0,
            message: "Listening across the Soulseek network…".to_owned(),
            started_at_ms: Some(timestamp_ms()),
            finished_at_ms: None,
        };
        self.snapshot.clone()
    }

    fn queue(&mut self, token: u32, client_id: String, query: String) -> SearchSnapshot {
        self.start(token, client_id, query);
        self.deadline = None;
        self.snapshot.started_at_ms = None;
        self.snapshot.message = "Queued for the shared search budget...".to_owned();
        self.snapshot.clone()
    }

    fn record(&mut self, response: SearchResponse) -> Vec<SearchResult> {
        if self.snapshot.state != SearchState::Searching
            || self.deadline.is_none()
            || self.snapshot.token != Some(response.token)
        {
            return Vec::new();
        }

        let mut accepted = Vec::new();
        for file in response.files {
            if self
                .plan
                .as_ref()
                .is_some_and(|plan| !plan.accepts(&file.filename))
            {
                continue;
            }
            if self.seen.len() >= SEARCH_RESULT_LIMIT {
                break;
            }
            let deduplication_key = format!(
                "{}\u{0}{}\u{0}{}",
                response.username, file.filename, file.size_bytes
            );
            if !self.seen.insert(deduplication_key) {
                continue;
            }

            self.next_result_id += 1;
            accepted.push(SearchResult {
                id: format!("{}:{}", response.token, self.next_result_id),
                token: response.token,
                username: response.username.clone(),
                filename: file.filename,
                size_bytes: file.size_bytes,
                extension: file.extension,
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
            self.peers.insert(response.username.clone());
        }
        self.snapshot.result_count = self.seen.len().try_into().unwrap_or(u32::MAX);
        self.snapshot.peer_count = self.peers.len().try_into().unwrap_or(u32::MAX);
        self.snapshot.message = format!(
            "Receiving files from {} {}…",
            self.snapshot.peer_count,
            if self.snapshot.peer_count == 1 {
                "person"
            } else {
                "people"
            }
        );
        accepted
    }

    fn finish(&mut self, state: SearchState, message: String) -> Option<SearchSnapshot> {
        if self.snapshot.state != SearchState::Searching {
            return None;
        }
        self.snapshot.state = state;
        self.snapshot.message = message;
        self.snapshot.finished_at_ms = Some(timestamp_ms());
        self.deadline = None;
        Some(self.snapshot.clone())
    }

    fn finish_for_count(&mut self) -> Option<SearchSnapshot> {
        let message = if self.snapshot.result_count == 0 {
            "No matching files arrived.".to_owned()
        } else {
            format!(
                "Found {} files from {} {}.",
                self.snapshot.result_count,
                self.snapshot.peer_count,
                if self.snapshot.peer_count == 1 {
                    "person"
                } else {
                    "people"
                }
            )
        };
        self.finish(SearchState::Completed, message)
    }

    fn retry_empty(&mut self, tokens: &AtomicU32) -> bool {
        if self.snapshot.result_count != 0
            || !self.plan.as_mut().is_some_and(AlbumQueryPlan::advance)
        {
            return false;
        }
        self.snapshot.token = Some(next_token(tokens));
        self.snapshot.query = self.plan.as_ref().unwrap().query().to_owned();
        self.snapshot.message = format!(
            "No matches. Queued {}",
            self.plan.as_ref().unwrap().status()
        );
        self.snapshot.started_at_ms = None;
        self.deadline = None;
        self.queued_at = Instant::now();
        true
    }
}

#[derive(Clone)]
pub struct SearchHub {
    app: AppHandle,
    runtimes: Arc<Mutex<HashMap<u32, SearchRuntime>>>,
    queries: QueryMemory,
}

impl SearchHub {
    pub fn new(app: AppHandle, queries: QueryMemory) -> Self {
        Self {
            app,
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            queries,
        }
    }

    pub fn snapshots(&self) -> Vec<SearchSnapshot> {
        let mut snapshots = self
            .runtimes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .map(|runtime| runtime.snapshot.clone())
            .collect::<Vec<_>>();
        snapshots.sort_by_key(|snapshot| snapshot.started_at_ms.unwrap_or_default());
        snapshots
    }

    pub fn start(
        &self,
        token: u32,
        client_id: String,
        query: String,
        album: Option<AlbumIdentity>,
    ) -> Result<SearchSnapshot, String> {
        let plan = album
            .as_ref()
            .map(|album| self.queries.plan(album))
            .transpose()?;
        let query = plan.as_ref().map_or(query, |plan| plan.query().to_owned());
        let snapshot = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let existing = runtimes.iter().find_map(|(token, runtime)| {
                (runtime.snapshot.client_id == client_id).then_some(*token)
            });
            if let Some(existing) = existing {
                runtimes.remove(&existing);
            } else {
                let relay = client_id.starts_with(RELAY_CLIENT_PREFIX);
                let matching_count = runtimes
                    .values()
                    .filter(|runtime| {
                        runtime.snapshot.client_id.starts_with(RELAY_CLIENT_PREFIX) == relay
                    })
                    .count();
                let limit = if relay {
                    RELAY_SESSION_LIMIT
                } else {
                    SEARCH_SESSION_LIMIT
                };
                if matching_count >= limit {
                    return Err(if relay {
                        "Signal Relay is already comparing four releases. Let one finish before rescuing another."
                            .to_owned()
                    } else {
                        format!(
                            "Dial Memory can hold at most {SEARCH_SESSION_LIMIT} searches. Close one before starting another."
                        )
                    });
                }
            }
            let mut runtime = SearchRuntime::new();
            runtime.plan = plan;
            let snapshot = runtime.queue(token, client_id, query);
            runtimes.insert(token, runtime);
            snapshot
        };
        self.emit("started", snapshot.clone(), Vec::new());
        Ok(snapshot)
    }

    pub fn start_pending(&self, relay: bool) -> Option<(u32, String)> {
        let snapshot = take_pending(
            &mut self.runtimes.lock().unwrap_or_else(|p| p.into_inner()),
            relay,
            Instant::now(),
        )?;
        let request = (snapshot.token?, snapshot.query.clone());
        self.emit("started", snapshot, Vec::new());
        Some(request)
    }

    pub fn record(&self, response: SearchResponse) {
        let token = response.token;
        let (snapshot, results, limit_reached) = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(runtime) = runtimes.get_mut(&token) else {
                return;
            };
            let results = runtime.record(response);
            let limit_reached = runtime.seen.len() >= SEARCH_RESULT_LIMIT;
            (runtime.snapshot.clone(), results, limit_reached)
        };
        if results.is_empty() {
            return;
        }

        for batch in results.chunks(SEARCH_EVENT_BATCH_SIZE) {
            self.emit("results", snapshot.clone(), batch.to_vec());
        }
        if limit_reached {
            self.complete_with_message(
                token,
                "Result limit reached. Refine the search for fewer files.",
            );
        }
    }

    pub fn stop(&self, client_id: &str) -> Option<SearchSnapshot> {
        let stopped = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let runtime = runtimes
                .values_mut()
                .find(|runtime| runtime.snapshot.client_id == client_id)?;
            runtime.finish(SearchState::Stopped, "Search stopped.".to_owned())
        };
        if let Some(snapshot) = &stopped {
            self.emit("stopped", snapshot.clone(), Vec::new());
        }
        stopped
    }

    pub fn stop_all(&self) -> Vec<SearchSnapshot> {
        let stopped = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtimes
                .values_mut()
                .filter_map(|runtime| {
                    runtime.finish(SearchState::Stopped, "Search stopped.".to_owned())
                })
                .collect::<Vec<_>>()
        };
        for snapshot in &stopped {
            self.emit("stopped", snapshot.clone(), Vec::new());
        }
        stopped
    }

    pub fn close(&self, client_id: &str) -> bool {
        let mut runtimes = self
            .runtimes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let token = runtimes.iter().find_map(|(token, runtime)| {
            (runtime.snapshot.client_id == client_id).then_some(*token)
        });
        token.is_some_and(|token| runtimes.remove(&token).is_some())
    }

    pub fn fail(&self, client_id: &str, message: impl Into<String>) {
        let message = message.into();
        let snapshot = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtimes
                .values_mut()
                .find(|runtime| runtime.snapshot.client_id == client_id)
                .and_then(|runtime| runtime.finish(SearchState::Error, message))
        };
        if let Some(snapshot) = snapshot {
            self.emit("error", snapshot, Vec::new());
        }
    }

    pub fn fail_all(&self, message: impl Into<String>) {
        let message = message.into();
        let failed = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtimes
                .values_mut()
                .filter_map(|runtime| runtime.finish(SearchState::Error, message.clone()))
                .collect::<Vec<_>>()
        };
        for snapshot in failed {
            self.emit("error", snapshot, Vec::new());
        }
    }

    pub fn expire_if_due(&self, tokens: &AtomicU32) {
        let snapshots = {
            let mut runtimes = self
                .runtimes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let due = runtimes
                .iter()
                .filter_map(|(token, runtime)| {
                    runtime
                        .deadline
                        .is_some_and(|deadline| Instant::now() >= deadline)
                        .then_some(*token)
                })
                .collect::<Vec<_>>();
            let mut snapshots = Vec::new();
            for token in due {
                let mut runtime = runtimes.remove(&token).unwrap();
                if runtime.retry_empty(tokens) {
                    snapshots.push(("started", runtime.snapshot.clone()));
                } else {
                    if runtime.snapshot.result_count > 0 {
                        if let Some(plan) = &runtime.plan {
                            self.queries.remember(plan);
                        }
                    }
                    if let Some(snapshot) = runtime.finish_for_count() {
                        snapshots.push(("completed", snapshot));
                    }
                }
                runtimes.insert(runtime.snapshot.token.unwrap(), runtime);
            }
            snapshots
        };
        for (event, snapshot) in snapshots {
            self.emit(event, snapshot, Vec::new());
        }
    }

    fn complete_with_message(&self, token: u32, message: &str) {
        let snapshot = self
            .runtimes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_mut(&token)
            .and_then(|runtime| {
                if let Some(plan) = &runtime.plan {
                    self.queries.remember(plan);
                }
                runtime.finish(SearchState::Completed, message.to_owned())
            });
        if let Some(snapshot) = snapshot {
            self.emit("completed", snapshot, Vec::new());
        }
    }

    fn emit(&self, event: &'static str, snapshot: SearchSnapshot, results: Vec<SearchResult>) {
        let _ = self.app.emit(
            SEARCH_EVENT,
            SearchEvent {
                event,
                snapshot,
                results,
            },
        );
    }
}

fn take_pending(
    runtimes: &mut HashMap<u32, SearchRuntime>,
    relay: bool,
    now: Instant,
) -> Option<SearchSnapshot> {
    let runtime = runtimes
        .values_mut()
        .filter(|runtime| {
            runtime.snapshot.state == SearchState::Searching
                && runtime.deadline.is_none()
                && runtime.snapshot.client_id.starts_with(RELAY_CLIENT_PREFIX) == relay
        })
        .min_by_key(|runtime| runtime.queued_at)?;
    runtime.deadline = Some(now + SEARCH_TIMEOUT);
    runtime.snapshot.started_at_ms = Some(timestamp_ms());
    runtime.snapshot.message = runtime.plan.as_ref().map_or_else(
        || "Listening across the Soulseek network…".to_owned(),
        AlbumQueryPlan::status,
    );
    Some(runtime.snapshot.clone())
}

pub fn valid_client_id(client_id: &str) -> bool {
    let suffix = client_id
        .strip_prefix(RELAY_CLIENT_PREFIX)
        .unwrap_or(client_id);
    !suffix.is_empty()
        && client_id.len() <= 128
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::protocol::SearchFile;

    #[test]
    fn album_fallbacks_wait_for_dispatch_filter_other_artists_and_stop_after_success() {
        let mut runtime = SearchRuntime::new();
        runtime.plan = Some(
            AlbumQueryPlan::new(
                &AlbumIdentity {
                    artist: "Artist".into(),
                    title: "The Northern Lights".into(),
                },
                None,
            )
            .unwrap(),
        );
        runtime.start(42, "album-dial".into(), "artist the northern lights".into());
        let tokens = AtomicU32::new(100);
        assert!(runtime.retry_empty(&tokens));
        assert_eq!(runtime.snapshot.token, Some(100));
        assert_eq!(runtime.snapshot.query, "the northern lights");
        assert!(runtime.record(response(42, "stale")).is_empty());
        assert!(runtime.record(response(100, "early")).is_empty());
        let mut runtimes = HashMap::from([(100, runtime)]);
        let sent = Instant::now() + Duration::from_secs(300);
        assert_eq!(
            take_pending(&mut runtimes, false, sent).unwrap().token,
            Some(100)
        );
        let runtime = runtimes.get_mut(&100).unwrap();
        assert_eq!(runtime.deadline, Some(sent + SEARCH_TIMEOUT));
        let mut unrelated = response(100, "other");
        unrelated.files[0].filename = "Music\\Someone Else\\The Northern Lights\\Track.flac".into();
        assert!(runtime.record(unrelated).is_empty());
        assert_eq!(runtime.snapshot.peer_count, 0);
        assert_eq!(runtime.record(response(100, "correct")).len(), 1);
        assert!(!runtime.retry_empty(&tokens));
        assert_eq!(
            runtime.finish_for_count().unwrap().state,
            SearchState::Completed
        );
    }

    #[test]
    fn ordinary_queries_do_not_fallback_and_cancelled_album_retry_never_dispatches() {
        let tokens = AtomicU32::new(10);
        let mut plain = SearchRuntime::new();
        plain.start(1, "plain".into(), "Björk -live *debut".into());
        assert!(!plain.retry_empty(&tokens));
        assert_eq!(plain.snapshot.query, "Björk -live *debut");
        let mut album = SearchRuntime::new();
        album.plan = Some(
            AlbumQueryPlan::new(
                &AlbumIdentity {
                    artist: "Artist".into(),
                    title: "Album".into(),
                },
                None,
            )
            .unwrap(),
        );
        album.start(2, "signal-relay:release-1".into(), "artist album".into());
        assert!(album.retry_empty(&tokens));
        album.finish(SearchState::Stopped, "Stopped".into());
        let mut runtimes = HashMap::from([(10, album)]);
        assert!(take_pending(&mut runtimes, true, Instant::now()).is_none());
        assert!(runtimes
            .get_mut(&10)
            .unwrap()
            .record(response(10, "late"))
            .is_empty());
    }

    #[test]
    fn queued_searches_wait_without_timing_out_and_cancelled_tokens_never_send() {
        let now = Instant::now();
        let mut runtimes = HashMap::new();
        for (token, id) in [(1, "signal-relay:release-1"), (2, "user-2"), (3, "user-3")] {
            let mut runtime = SearchRuntime::new();
            runtime.queue(token, id.to_owned(), "query".to_owned());
            runtime.queued_at = now + Duration::from_secs(u64::from(token));
            assert!(runtime.record(response(token, "listener")).is_empty());
            runtimes.insert(token, runtime);
        }
        runtimes
            .get_mut(&2)
            .unwrap()
            .finish(SearchState::Stopped, "Cancelled".to_owned());
        let sent_at = now + Duration::from_secs(300);
        assert_eq!(
            take_pending(&mut runtimes, false, sent_at).unwrap().token,
            Some(3)
        );
        assert_eq!(runtimes[&3].deadline, Some(sent_at + SEARCH_TIMEOUT));
        assert!(take_pending(&mut runtimes, false, sent_at).is_none());
        assert_eq!(
            take_pending(&mut runtimes, true, sent_at).unwrap().token,
            Some(1)
        );
        assert_eq!(
            runtimes
                .get_mut(&3)
                .unwrap()
                .record(response(3, "listener"))
                .len(),
            1
        );
        assert!(runtimes
            .get_mut(&2)
            .unwrap()
            .record(response(2, "listener"))
            .is_empty());
    }

    #[test]
    fn relay_session_ids_reach_the_relay_lane_without_accepting_arbitrary_colons() {
        assert!(valid_client_id("signal-relay:release-123"));
        assert!(valid_client_id("dial_1-2"));
        for invalid in [
            "signal-relay:",
            "other:release",
            "signal-relay:release:extra",
            "a b",
            "",
        ] {
            assert!(!valid_client_id(invalid));
        }
        assert!(!valid_client_id(&"a".repeat(129)));
    }

    fn response(token: u32, username: &str) -> SearchResponse {
        SearchResponse {
            username: username.to_owned(),
            token,
            files: vec![SearchFile {
                filename: "Music\\Artist\\Track.flac".to_owned(),
                size_bytes: 1_024,
                extension: "flac".to_owned(),
                bitrate: None,
                duration_seconds: Some(240),
                vbr: None,
                sample_rate: Some(96_000),
                bit_depth: Some(24),
                is_private: false,
            }],
            slot_free: true,
            average_speed: 5_000_000,
            queue_length: 0,
        }
    }

    #[test]
    fn ignores_stale_tokens_and_deduplicates_results() {
        let mut runtime = SearchRuntime::new();
        runtime.start(42, "session-a".to_owned(), "artist track".to_owned());

        assert!(runtime.record(response(41, "listener")).is_empty());
        assert_eq!(runtime.record(response(42, "listener")).len(), 1);
        assert!(runtime.record(response(42, "listener")).is_empty());
        assert_eq!(runtime.snapshot.result_count, 1);
        assert_eq!(runtime.snapshot.peer_count, 1);
    }

    #[test]
    fn independent_sessions_keep_results_and_expire_separately() {
        let first = SearchRuntime::new();
        let second = SearchRuntime::new();
        let mut runtimes = HashMap::from([(1, first), (2, second)]);
        runtimes
            .get_mut(&1)
            .unwrap()
            .start(1, "one".to_owned(), "first".to_owned());
        runtimes
            .get_mut(&2)
            .unwrap()
            .start(2, "two".to_owned(), "second".to_owned());

        assert_eq!(
            runtimes
                .get_mut(&1)
                .unwrap()
                .record(response(1, "listener"))
                .len(),
            1
        );
        assert_eq!(runtimes.get(&1).unwrap().snapshot.result_count, 1);
        assert_eq!(runtimes.get(&2).unwrap().snapshot.result_count, 0);
        assert!(runtimes
            .get_mut(&2)
            .unwrap()
            .record(response(1, "listener"))
            .is_empty());
    }
}
