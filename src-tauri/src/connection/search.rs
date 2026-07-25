use super::protocol::SearchResponse;
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub const SEARCH_EVENT: &str = "forever://search";
pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const SEARCH_RESULT_LIMIT: usize = 5_000;
const SEARCH_EVENT_BATCH_SIZE: usize = 200;

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
}

impl SearchRuntime {
    fn new() -> Self {
        Self {
            snapshot: SearchSnapshot::idle(),
            deadline: None,
            seen: HashSet::new(),
            peers: HashSet::new(),
            next_result_id: 0,
        }
    }

    fn start(&mut self, token: u32, query: String) -> SearchSnapshot {
        self.seen.clear();
        self.peers.clear();
        self.next_result_id = 0;
        self.deadline = Some(Instant::now() + SEARCH_TIMEOUT);
        self.snapshot = SearchSnapshot {
            state: SearchState::Searching,
            token: Some(token),
            query,
            result_count: 0,
            peer_count: 0,
            message: "Listening across the Soulseek network…".to_owned(),
            started_at_ms: Some(timestamp_ms()),
            finished_at_ms: None,
        };
        self.snapshot.clone()
    }

    fn record(&mut self, response: SearchResponse) -> Vec<SearchResult> {
        if self.snapshot.state != SearchState::Searching
            || self.snapshot.token != Some(response.token)
        {
            return Vec::new();
        }

        self.peers.insert(response.username.clone());
        let mut accepted = Vec::new();
        for file in response.files {
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
}

#[derive(Clone)]
pub struct SearchHub {
    app: AppHandle,
    runtime: Arc<Mutex<SearchRuntime>>,
}

impl SearchHub {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            runtime: Arc::new(Mutex::new(SearchRuntime::new())),
        }
    }

    pub fn current(&self) -> SearchSnapshot {
        self.runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .snapshot
            .clone()
    }

    pub fn start(&self, token: u32, query: String) -> SearchSnapshot {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .start(token, query);
        self.emit("started", snapshot.clone(), Vec::new());
        snapshot
    }

    pub fn record(&self, response: SearchResponse) {
        let (snapshot, results, limit_reached) = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
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
            self.complete_with_message("Result limit reached. Refine the search for fewer files.");
        }
    }

    pub fn stop(&self) -> SearchSnapshot {
        let stopped = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime.finish(SearchState::Stopped, "Search stopped.".to_owned())
        };
        if let Some(snapshot) = stopped {
            self.emit("stopped", snapshot.clone(), Vec::new());
            snapshot
        } else {
            self.current()
        }
    }

    pub fn fail(&self, message: impl Into<String>) {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .finish(SearchState::Error, message.into());
        if let Some(snapshot) = snapshot {
            self.emit("error", snapshot, Vec::new());
        }
    }

    pub fn expire_if_due(&self) {
        let snapshot = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
            {
                runtime.finish_for_count()
            } else {
                None
            }
        };
        if let Some(snapshot) = snapshot {
            self.emit("completed", snapshot, Vec::new());
        }
    }

    fn complete_with_message(&self, message: &str) {
        let snapshot = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .finish(SearchState::Completed, message.to_owned());
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
        runtime.start(42, "artist track".to_owned());

        assert!(runtime.record(response(41, "listener")).is_empty());
        assert_eq!(runtime.record(response(42, "listener")).len(), 1);
        assert!(runtime.record(response(42, "listener")).is_empty());
        assert_eq!(runtime.snapshot.result_count, 1);
        assert_eq!(runtime.snapshot.peer_count, 1);
    }

    #[test]
    fn starting_a_new_search_clears_previous_session_state() {
        let mut runtime = SearchRuntime::new();
        runtime.start(1, "first".to_owned());
        runtime.record(response(1, "listener"));

        let snapshot = runtime.start(2, "second".to_owned());
        assert_eq!(snapshot.result_count, 0);
        assert_eq!(snapshot.peer_count, 0);
        assert_eq!(snapshot.query, "second");
        assert!(runtime.record(response(1, "listener")).is_empty());
    }
}
