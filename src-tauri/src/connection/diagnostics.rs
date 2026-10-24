//! Local diagnostics only. Free-form text never enters a support bundle.
use serde::Serialize;
use std::{
    collections::VecDeque,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use time::{Date, OffsetDateTime};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

pub(super) const MAX_LOG_FILES: usize = 7;
pub(super) const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_RECENT_ENTRIES: usize = 120;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEntry {
    pub timestamp_ms: u64,
    pub level: String,
    pub event: String,
    pub message: String,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogHealth {
    pub dropped_records: u64,
    pub daily_limit_reached: bool,
    pub write_failed: bool,
}

struct WriterState {
    appender: Option<RollingFileAppender>,
    directory: PathBuf,
    day: Date,
    bytes: u64,
    limit: u64,
    health: LogHealth,
}

#[derive(Clone)]
struct LogWriter(Arc<Mutex<WriterState>>);

impl Write for LogWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let day = OffsetDateTime::now_utc().date();
        if day != state.day {
            match open_appender(&state.directory) {
                Ok(appender) => state.appender = Some(appender),
                Err(error) => {
                    state.health.write_failed = true;
                    return Err(error);
                }
            }
            state.day = day;
            state.bytes = log_size(&state.directory, day);
            state.health.daily_limit_reached = false;
        }
        if state.bytes.saturating_add(bytes.len() as u64) > state.limit {
            state.health.dropped_records = state.health.dropped_records.saturating_add(1);
            state.health.daily_limit_reached = true;
            return Ok(bytes.len());
        }
        let result = match state.appender.as_mut() {
            Some(appender) => appender.write_all(bytes).and_then(|()| appender.flush()),
            None => Err(io::Error::other("Diagnostic file logging is unavailable.")),
        };
        // Reserve attempted bytes even after a partial write.
        state.bytes = state.bytes.saturating_add(bytes.len() as u64);
        if let Err(error) = result {
            state.health.write_failed = true;
            return Err(error);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        match self
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .appender
            .as_mut()
        {
            Some(appender) => appender.flush(),
            None => Ok(()),
        }
    }
}

fn log_size(directory: &Path, day: Date) -> u64 {
    std::fs::metadata(directory.join(format!("connection.{day}.jsonl")))
        .map(|m| m.len())
        .unwrap_or(0)
}

#[derive(Clone)]
pub struct Diagnostics {
    directory: PathBuf,
    entries: Arc<Mutex<VecDeque<DiagnosticEntry>>>,
    writer: LogWriter,
    dispatch: tracing::Dispatch,
}

impl Diagnostics {
    pub fn new(directory: PathBuf) -> Self {
        // Logging must never prevent startup. Keep the live ring and surface failure.
        let appender = open_appender(&directory).ok();
        let write_failed = appender.is_none();
        let day = OffsetDateTime::now_utc().date();
        let writer = LogWriter(Arc::new(Mutex::new(WriterState {
            appender,
            bytes: log_size(&directory, day),
            directory: directory.clone(),
            day,
            limit: MAX_LOG_BYTES,
            health: LogHealth {
                write_failed,
                ..LogHealth::default()
            },
        })));
        let output = writer.clone();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .without_time()
            .with_target(false)
            .with_ansi(false)
            .with_current_span(false)
            .with_span_list(false)
            .log_internal_errors(false)
            .with_writer(move || output.clone())
            .finish();
        let diagnostics = Self {
            directory,
            writer,
            dispatch: tracing::Dispatch::new(subscriber),
            entries: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_RECENT_ENTRIES))),
        };
        diagnostics.record(
            "info",
            "diagnostics_ready",
            "Connection diagnostics started.",
        );
        diagnostics
    }

    pub fn path(&self) -> &Path {
        &self.directory
    }

    pub fn recent(&self) -> Vec<DiagnosticEntry> {
        let mut entries: Vec<_> = self
            .entries
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .cloned()
            .collect();
        let health = self.health();
        let notice = if health.write_failed {
            Some(("log_write_failed", "Some local diagnostic records could not be saved. Check disk space and folder permissions."))
        } else if health.daily_limit_reached {
            Some(("log_limit_reached", "The daily log limit was reached. Recent activity is still available; file logging resumes on the next UTC day."))
        } else {
            None
        };
        if let Some((event, message)) = notice {
            if entries.len() == MAX_RECENT_ENTRIES {
                entries.remove(0);
            }
            entries.push(DiagnosticEntry {
                timestamp_ms: timestamp_ms(),
                level: "warn".into(),
                event: event.into(),
                message: message.into(),
            });
        }
        entries
    }

    pub fn health(&self) -> LogHealth {
        self.writer
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .health
            .clone()
    }

    pub fn record(&self, level: &str, event: &str, message: &str) {
        let entry = DiagnosticEntry {
            timestamp_ms: timestamp_ms(),
            level: safe_level(level).into(),
            event: safe_event(event).into(),
            message: sanitize(message),
        };
        {
            let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            if entries.len() == MAX_RECENT_ENTRIES {
                entries.pop_front();
            }
            entries.push_back(entry.clone());
        }
        tracing::dispatcher::with_default(&self.dispatch, || match entry.level.as_str() {
            "error" => {
                tracing::error!(timestamp_ms = entry.timestamp_ms, event = %entry.event, message = %entry.message)
            }
            "warn" => {
                tracing::warn!(timestamp_ms = entry.timestamp_ms, event = %entry.event, message = %entry.message)
            }
            _ => {
                tracing::info!(timestamp_ms = entry.timestamp_ms, event = %entry.event, message = %entry.message)
            }
        });
    }
}

fn open_appender(directory: &Path) -> io::Result<RollingFileAppender> {
    std::fs::create_dir_all(directory)?;
    // Own retention rather than the appender's broad prefix/suffix matching, so
    // unrelated files and today's existing log are never accidentally removed.
    prune_logs(directory, MAX_LOG_FILES - 1)?;
    RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("connection")
        .filename_suffix("jsonl")
        .build(directory)
        .map_err(io::Error::other)
}

pub(super) fn log_files(directory: &Path) -> io::Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Strict ownership: never include legacy logs, arbitrary files, or links.
        if name.len() == 27
            && name.starts_with("connection.")
            && name.ends_with(".jsonl")
            && name.as_bytes()[11..21].iter().enumerate().all(|(i, b)| {
                if i == 4 || i == 7 {
                    *b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            })
            && entry.file_type()?.is_file()
        {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

fn prune_logs(directory: &Path, old_count: usize) -> io::Result<()> {
    let today = format!("connection.{}.jsonl", OffsetDateTime::now_utc().date());
    let old: Vec<_> = log_files(directory)?
        .into_iter()
        .filter(|p| p.file_name().and_then(|n| n.to_str()) != Some(&today))
        .collect();
    for path in old.iter().take(old.len().saturating_sub(old_count)) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub(super) fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub(super) fn safe_level(level: &str) -> &'static str {
    match level.to_ascii_lowercase().as_str() {
        "warn" | "warning" => "warn",
        "error" => "error",
        _ => "info",
    }
}

// Unknown event fields cannot smuggle free-form data into exports.
pub(super) fn safe_event(event: &str) -> &'static str {
    const EVENTS: &[&str] = &[
        "diagnostics_ready",
        "profile_saved",
        "profile_removed",
        "disconnected",
        "radar_started",
        "radar_stopped",
        "search_started",
        "search_stopped",
        "searches_stopped",
        "connect_started",
        "reconnect_started",
        "connected",
        "socket_closed",
        "socket_interrupted",
        "relogged",
        "socket_read_failed",
        "connect_timeout",
        "connect_failed",
        "login_send_failed",
        "login_timeout",
        "login_read_failed",
        "login_protocol_error",
        "login_rejected",
        "listen_failed",
        "listen_announce_failed",
        "session_setup_failed",
        "distributed_setup_failed",
        "distributed_parent_failed",
        "distributed_discovery",
        "distributed_branch_root",
        "distributed_reset",
        "distributed_connected",
        "distributed_parent_lost",
        "privileged_users_invalid",
        "wishlist_interval_invalid",
        "excluded_phrases_invalid",
        "port_mapping_cleanup",
        "port_mapping_renewal",
        "port_mapping_unavailable",
        "search_response_failed",
        "search_send_failed",
        "message_invalid",
        "diagnostics_exported",
        "command_channel_closed",
        "download_address_failed",
        "download_request_failed",
        "folder_address_failed",
        "folder_request_failed",
        "keepalive_failed",
        "message_ack_failed",
        "message_send_failed",
        "message_store_failed",
        "peer_response_failed",
        "people_request_failed",
        "people_watch_failed",
        "room_join_failed",
        "room_leave_failed",
        "room_list_failed",
        "room_message_failed",
        "room_message_invalid",
        "shared_counts_failed",
        "shares_address_failed",
        "shares_request_failed",
        "upload_address_failed",
        "upload_file_address_failed",
        "upload_file_request_failed",
        "upload_request_failed",
        "upload_speed_report_failed",
        "log_write_failed",
        "log_limit_reached",
    ];
    EVENTS
        .iter()
        .copied()
        .find(|known| *known == event)
        .unwrap_or("diagnostic_event")
}

fn sanitize(value: &str) -> String {
    static PRIVATE: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = PRIVATE.get_or_init(|| regex::Regex::new(
        r#"(?ix)(?:password|passwd|secret|token|authorization|credential|username)\s*[=:]\s*.*|(?:https?://|[a-z]:\\|/)[^\r\n]*|(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?|[a-f0-9]*:[a-f0-9:%\.]*:[a-f0-9:%\.]*"#
    ).expect("static diagnostics redaction regex"));
    let bounded: String = value.chars().take(4096).collect();
    pattern
        .replace_all(&bounded, "[redacted]")
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(500)
        .collect()
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CrashReport {
    pub schema_version: u32,
    pub timestamp_ms: u64,
    pub app_version: String,
    pub os: String,
    pub architecture: String,
    pub source_file: String,
    pub line: u32,
    pub column: u32,
}

pub(crate) fn install_panic_hook(directory: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let location = info.location();
        // Never capture payloads, thread names, environment, or raw stacks.
        let _ = write_crash_report(
            &directory,
            location.map(|l| (l.file(), l.line(), l.column())),
        );
        eprintln!("Forever encountered a Rust panic. A local diagnostic report was attempted.");
    }));
}

fn write_crash_report(directory: &Path, location: Option<(&str, u32, u32)>) -> io::Result<()> {
    let (file, line, column) = location.unwrap_or(("unknown", 0, 0));
    let report = CrashReport {
        schema_version: 1,
        timestamp_ms: timestamp_ms(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        architecture: std::env::consts::ARCH.into(),
        source_file: file.rsplit(['/', '\\']).next().unwrap_or("unknown").into(),
        line,
        column,
    };
    std::fs::create_dir_all(directory)?;
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer_pretty(&mut file, &report)?;
    file.as_file().sync_all()?;
    file.persist(directory.join("crash-latest.json"))
        .map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
