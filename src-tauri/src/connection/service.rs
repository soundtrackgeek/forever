use super::{
    credentials::CredentialVault,
    diagnostics::{DiagnosticEntry, Diagnostics},
    protocol::{
        login_frame, parse_login_response, read_frame, server_ping_frame, set_online_frame,
        shared_counts_frame, write_raw_frame, LoginResponse, RELOGGED_CODE,
    },
    settings::{ConnectionProfile, SettingsStore},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{net::TcpStream, time::timeout};
use zeroize::Zeroizing;

const CONNECTION_EVENT: &str = "forever://connection-status";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(12);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Unconfigured,
    Offline,
    Connecting,
    Authenticating,
    Online,
    Reconnecting,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub state: ConnectionState,
    pub username: Option<String>,
    pub server: Option<String>,
    pub message: String,
    pub attempt: u32,
    pub connected_at_ms: Option<u64>,
    pub retry_in_seconds: Option<u64>,
    pub updated_at_ms: u64,
}

impl ConnectionSnapshot {
    fn unconfigured() -> Self {
        Self {
            state: ConnectionState::Unconfigured,
            username: None,
            server: None,
            message: "Add your Soulseek account to get started.".to_owned(),
            attempt: 0,
            connected_at_ms: None,
            retry_in_seconds: None,
            updated_at_ms: timestamp_ms(),
        }
    }

    fn offline(profile: &ConnectionProfile) -> Self {
        Self {
            state: ConnectionState::Offline,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: "Ready to connect.".to_owned(),
            attempt: 0,
            connected_at_ms: None,
            retry_in_seconds: None,
            updated_at_ms: timestamp_ms(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionBootstrap {
    pub profile: Option<ConnectionProfile>,
    pub suggested_profile: ConnectionProfile,
    pub has_password: bool,
    pub snapshot: ConnectionSnapshot,
    pub diagnostics_path: String,
    pub diagnostics: Vec<DiagnosticEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionRequest {
    pub profile: ConnectionProfile,
    pub password: Option<String>,
}

struct ActiveTask {
    generation: u64,
    handle: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone)]
pub struct ConnectionManager {
    app: AppHandle,
    settings: SettingsStore,
    vault: CredentialVault,
    diagnostics: Diagnostics,
    suggested_profile: ConnectionProfile,
    snapshot: Arc<RwLock<ConnectionSnapshot>>,
    task: Arc<Mutex<Option<ActiveTask>>>,
    generation: Arc<AtomicU64>,
}

impl ConnectionManager {
    pub fn new(
        app: AppHandle,
        settings_path: PathBuf,
        diagnostics_path: PathBuf,
        download_directory: PathBuf,
    ) -> Result<Self, ConnectionServiceError> {
        let settings = SettingsStore::new(settings_path);
        let diagnostics = Diagnostics::new(diagnostics_path)?;
        let profile = settings.load()?;
        let snapshot = profile
            .as_ref()
            .map(ConnectionSnapshot::offline)
            .unwrap_or_else(ConnectionSnapshot::unconfigured);

        Ok(Self {
            app,
            settings,
            vault: CredentialVault::default(),
            diagnostics,
            suggested_profile: ConnectionProfile::suggested(&download_directory),
            snapshot: Arc::new(RwLock::new(snapshot)),
            task: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
        })
    }

    pub fn bootstrap(&self) -> Result<ConnectionBootstrap, ConnectionServiceError> {
        let profile = self.settings.load()?;
        let has_password = match profile.as_ref() {
            Some(profile) => self.vault.has(&profile.username)?,
            None => false,
        };

        Ok(ConnectionBootstrap {
            profile,
            suggested_profile: self.suggested_profile.clone(),
            has_password,
            snapshot: self.current_snapshot(),
            diagnostics_path: self.diagnostics.path().to_string_lossy().into_owned(),
            diagnostics: self.diagnostics.recent(),
        })
    }

    pub fn save_profile(
        &self,
        request: SaveConnectionRequest,
    ) -> Result<ConnectionBootstrap, ConnectionServiceError> {
        request.profile.validate()?;
        let previous = self.settings.load()?;
        let username_changed = previous
            .as_ref()
            .is_some_and(|profile| profile.username != request.profile.username);

        let password = match request.password.filter(|password| !password.is_empty()) {
            Some(password) => Some(Zeroizing::new(password)),
            None if username_changed => None,
            None => self.vault.get(&request.profile.username)?,
        }
        .ok_or(ConnectionServiceError::MissingPassword)?;

        self.vault.store(
            &request.profile.username,
            password.to_string(),
            request.profile.remember_password,
        )?;
        self.settings.save(&request.profile)?;

        if let Some(previous) = previous {
            if previous.username != request.profile.username {
                self.vault.forget(&previous.username)?;
            }
        }

        self.stop_active_task();
        self.diagnostics.record(
            "info",
            "profile_saved",
            "Soulseek connection settings were saved.",
        );
        self.publish(ConnectionSnapshot::offline(&request.profile));
        self.bootstrap()
    }

    pub fn connect(&self) -> Result<ConnectionSnapshot, ConnectionServiceError> {
        let profile = self
            .settings
            .load()?
            .ok_or(ConnectionServiceError::NotConfigured)?;
        let password = self
            .vault
            .get(&profile.username)?
            .ok_or(ConnectionServiceError::MissingPassword)?;

        self.stop_active_task();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let manager = self.clone();
        let handle = tauri::async_runtime::spawn(async move {
            manager
                .run_connection_loop(profile, password, generation)
                .await;
            manager.clear_task(generation);
        });
        *self
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(ActiveTask { generation, handle });

        Ok(self.current_snapshot())
    }

    pub fn disconnect(&self) -> Result<ConnectionSnapshot, ConnectionServiceError> {
        self.stop_active_task();
        let snapshot = match self.settings.load()? {
            Some(profile) => ConnectionSnapshot::offline(&profile),
            None => ConnectionSnapshot::unconfigured(),
        };
        self.diagnostics
            .record("info", "disconnected", "Disconnected by the user.");
        self.publish(snapshot.clone());
        Ok(snapshot)
    }

    pub fn reset(&self) -> Result<ConnectionBootstrap, ConnectionServiceError> {
        self.stop_active_task();
        if let Some(profile) = self.settings.load()? {
            self.vault.forget(&profile.username)?;
        }
        self.settings.delete()?;
        self.diagnostics.record(
            "info",
            "profile_removed",
            "Soulseek account settings and stored credentials were removed.",
        );
        self.publish(ConnectionSnapshot::unconfigured());
        self.bootstrap()
    }

    pub fn diagnostics(&self) -> Vec<DiagnosticEntry> {
        self.diagnostics.recent()
    }

    pub fn current_snapshot(&self) -> ConnectionSnapshot {
        self.snapshot
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    async fn run_connection_loop(
        &self,
        profile: ConnectionProfile,
        password: Zeroizing<String>,
        generation: u64,
    ) {
        let mut attempt = 0;
        loop {
            if self.generation.load(Ordering::SeqCst) != generation {
                return;
            }

            attempt += 1;
            let state = if attempt == 1 {
                ConnectionState::Connecting
            } else {
                ConnectionState::Reconnecting
            };
            self.publish(ConnectionSnapshot {
                state,
                username: Some(profile.username.clone()),
                server: Some(server_label(&profile)),
                message: if attempt == 1 {
                    "Connecting to the Soulseek network…".to_owned()
                } else {
                    format!("Reconnect attempt {attempt}…")
                },
                attempt,
                connected_at_ms: None,
                retry_in_seconds: None,
                updated_at_ms: timestamp_ms(),
            });
            self.diagnostics.record(
                "info",
                if attempt == 1 {
                    "connect_started"
                } else {
                    "reconnect_started"
                },
                &format!("Connecting to {}.", server_label(&profile)),
            );

            match self
                .connect_once(&profile, password.as_str(), attempt)
                .await
            {
                Ok(()) => {
                    let failure = ConnectionFailure::retryable(
                        "The Soulseek server closed the connection.",
                        "socket_closed",
                    );
                    if !self.wait_to_retry(&profile, attempt, &failure).await {
                        return;
                    }
                }
                Err(failure) if failure.retryable => {
                    if !self.wait_to_retry(&profile, attempt, &failure).await {
                        return;
                    }
                }
                Err(failure) => {
                    self.diagnostics
                        .record("error", failure.event, &failure.message);
                    self.publish(ConnectionSnapshot {
                        state: ConnectionState::Error,
                        username: Some(profile.username.clone()),
                        server: Some(server_label(&profile)),
                        message: failure.message,
                        attempt,
                        connected_at_ms: None,
                        retry_in_seconds: None,
                        updated_at_ms: timestamp_ms(),
                    });
                    return;
                }
            }
        }
    }

    async fn connect_once(
        &self,
        profile: &ConnectionProfile,
        password: &str,
        attempt: u32,
    ) -> Result<(), ConnectionFailure> {
        let address = (profile.server_host.as_str(), profile.server_port);
        let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(address))
            .await
            .map_err(|_| {
                ConnectionFailure::retryable(
                    "The Soulseek server did not respond in time.",
                    "connect_timeout",
                )
            })?
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not reach the Soulseek server: {error}"),
                    "connect_failed",
                )
            })?;
        let _ = stream.set_nodelay(true);

        self.publish(ConnectionSnapshot {
            state: ConnectionState::Authenticating,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: "Signing in to Soulseek…".to_owned(),
            attempt,
            connected_at_ms: None,
            retry_in_seconds: None,
            updated_at_ms: timestamp_ms(),
        });

        let login = Zeroizing::new(login_frame(&profile.username, password));
        write_raw_frame(&mut stream, login.as_slice())
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not send the Soulseek login: {error}"),
                    "login_send_failed",
                )
            })?;
        let response = timeout(LOGIN_TIMEOUT, read_frame(&mut stream))
            .await
            .map_err(|_| {
                ConnectionFailure::retryable(
                    "The Soulseek server did not answer the login request.",
                    "login_timeout",
                )
            })?
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Could not read the Soulseek login response: {error}"),
                    "login_read_failed",
                )
            })?;

        match parse_login_response(&response).map_err(|error| {
            ConnectionFailure::fatal(
                format!("The Soulseek server sent an unexpected login response: {error}"),
                "login_protocol_error",
            )
        })? {
            LoginResponse::Accepted { .. } => {}
            LoginResponse::Rejected { reason, detail } => {
                return Err(rejection_failure(&reason, detail.as_deref()));
            }
        }

        write_raw_frame(&mut stream, &set_online_frame())
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The Soulseek session could not be initialized: {error}"),
                    "session_setup_failed",
                )
            })?;
        write_raw_frame(&mut stream, &shared_counts_frame())
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The Soulseek session could not be initialized: {error}"),
                    "session_setup_failed",
                )
            })?;

        let connected_at_ms = timestamp_ms();
        self.diagnostics.record(
            "info",
            "connected",
            "Authenticated with the Soulseek server.",
        );
        self.publish(ConnectionSnapshot {
            state: ConnectionState::Online,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: "Network online".to_owned(),
            attempt,
            connected_at_ms: Some(connected_at_ms),
            retry_in_seconds: None,
            updated_at_ms: connected_at_ms,
        });

        let mut keepalive = tokio::time::interval(KEEPALIVE_INTERVAL);
        keepalive.tick().await;
        loop {
            tokio::select! {
                _ = keepalive.tick() => {
                    write_raw_frame(&mut stream, &server_ping_frame()).await.map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The Soulseek keepalive failed: {error}"),
                            "keepalive_failed",
                        )
                    })?;
                }
                frame = read_frame(&mut stream) => {
                    let frame = frame.map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The Soulseek connection was interrupted: {error}"),
                            "socket_interrupted",
                        )
                    })?;
                    if frame.code == RELOGGED_CODE {
                        return Err(ConnectionFailure::fatal(
                            "This account signed in from another Soulseek client.",
                            "relogged",
                        ));
                    }
                }
            }
        }
    }

    async fn wait_to_retry(
        &self,
        profile: &ConnectionProfile,
        attempt: u32,
        failure: &ConnectionFailure,
    ) -> bool {
        let delay = retry_delay(attempt);
        self.diagnostics
            .record("warn", failure.event, &failure.message);
        self.publish(ConnectionSnapshot {
            state: ConnectionState::Reconnecting,
            username: Some(profile.username.clone()),
            server: Some(server_label(profile)),
            message: failure.message.clone(),
            attempt,
            connected_at_ms: None,
            retry_in_seconds: Some(delay.as_secs()),
            updated_at_ms: timestamp_ms(),
        });
        tokio::time::sleep(delay).await;
        true
    }

    fn publish(&self, snapshot: ConnectionSnapshot) {
        *self
            .snapshot
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = snapshot.clone();
        let _ = self.app.emit(CONNECTION_EVENT, snapshot);
    }

    fn stop_active_task(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(active) = self
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            active.handle.abort();
        }
    }

    fn clear_task(&self, generation: u64) {
        let mut task = self
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if task
            .as_ref()
            .is_some_and(|active| active.generation == generation)
        {
            *task = None;
        }
    }
}

fn server_label(profile: &ConnectionProfile) -> String {
    format!("{}:{}", profile.server_host, profile.server_port)
}

fn retry_delay(attempt: u32) -> Duration {
    let seconds = 2_u64.saturating_pow(attempt).min(30);
    Duration::from_secs(seconds)
}

fn rejection_failure(reason: &str, detail: Option<&str>) -> ConnectionFailure {
    let normalized = reason.to_ascii_uppercase();
    let (message, retryable) = match normalized.as_str() {
        "INVALIDPASS" => (
            "That Soulseek username or password was not accepted.".to_owned(),
            false,
        ),
        "EMPTYPASSWORD" => ("Enter your Soulseek password.".to_owned(), false),
        "INVALIDUSERNAME" => detail
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .map(|message| (message, false))
            .unwrap_or_else(|| ("That Soulseek username is not valid.".to_owned(), false)),
        "INVALIDVERSION" => (
            "This version of Forever is not accepted by the Soulseek server. Check for an update."
                .to_owned(),
            false,
        ),
        "SVRFULL" => (
            "The Soulseek server is full. Forever will try again.".to_owned(),
            true,
        ),
        "SVRPRIVATE" => (
            "The Soulseek server is currently private.".to_owned(),
            false,
        ),
        _ => (
            format!("The Soulseek server rejected the login ({reason})."),
            false,
        ),
    };
    if retryable {
        ConnectionFailure::retryable(message, "login_rejected")
    } else {
        ConnectionFailure::fatal(message, "login_rejected")
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

#[derive(Debug)]
struct ConnectionFailure {
    message: String,
    event: &'static str,
    retryable: bool,
}

impl ConnectionFailure {
    fn retryable(message: impl Into<String>, event: &'static str) -> Self {
        Self {
            message: message.into(),
            event,
            retryable: true,
        }
    }

    fn fatal(message: impl Into<String>, event: &'static str) -> Self {
        Self {
            message: message.into(),
            event,
            retryable: false,
        }
    }
}

#[derive(Debug, Error)]
pub enum ConnectionServiceError {
    #[error("{0}")]
    Settings(#[from] super::settings::SettingsError),
    #[error("{0}")]
    Credentials(#[from] super::credentials::CredentialError),
    #[error("Add your Soulseek account before connecting.")]
    NotConfigured,
    #[error("Enter your Soulseek password.")]
    MissingPassword,
    #[error("Could not initialize connection diagnostics: {0}")]
    Diagnostics(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnect_backoff_caps_at_thirty_seconds() {
        assert_eq!(retry_delay(1), Duration::from_secs(2));
        assert_eq!(retry_delay(2), Duration::from_secs(4));
        assert_eq!(retry_delay(6), Duration::from_secs(30));
        assert_eq!(retry_delay(30), Duration::from_secs(30));
    }

    #[test]
    fn rejection_messages_are_safe_and_actionable() {
        let invalid_password = rejection_failure("INVALIDPASS", None);
        assert!(!invalid_password.retryable);
        assert!(invalid_password.message.contains("username or password"));

        let invalid_username = rejection_failure("INVALIDUSERNAME", Some("Name unavailable."));
        assert_eq!(invalid_username.message, "Name unavailable.");
    }
}
