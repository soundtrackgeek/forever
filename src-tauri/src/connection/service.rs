use super::{
    credentials::CredentialVault,
    diagnostics::{DiagnosticEntry, Diagnostics},
    downloads::{
        DownloadPlan, EnqueueReleaseRequest, EnqueueTransferRequest, TransferError, TransferHub,
        TransferQueueSnapshot, TransferTicket,
    },
    folders::{FolderError, FolderHub, FolderInspection, FolderTicket},
    protocol::{
        cant_connect_to_peer_frame, connect_to_peer_frame, file_search_frame,
        folder_contents_request_frame, get_peer_address_frame, login_frame,
        parse_cant_connect_token, parse_connect_to_peer, parse_filename,
        parse_folder_contents_response, parse_login_response, parse_peer_address,
        parse_queue_position, parse_search_response, parse_transfer_request, parse_upload_denied,
        peer_init_frame, pierce_firewall_frame, place_in_queue_request_frame, queue_upload_frame,
        read_frame, read_peer_init, server_ping_frame, set_online_frame, set_wait_port_frame,
        shared_counts_frame, transfer_response_frame, write_raw_frame, ConnectToPeer, Frame,
        LoginResponse, PeerAddress, PeerInit, ProtocolError, CANT_CONNECT_TO_PEER_CODE,
        CONNECT_TO_PEER_CODE, FILE_SEARCH_RESPONSE_CODE, FOLDER_CONTENTS_RESPONSE_CODE,
        GET_PEER_ADDRESS_CODE, PLACE_IN_QUEUE_RESPONSE_CODE, RELOGGED_CODE, TRANSFER_REQUEST_CODE,
        UPLOAD_DENIED_CODE, UPLOAD_FAILED_CODE,
    },
    search::{SearchHub, SearchSnapshot, SearchState},
    settings::{ConnectionProfile, SettingsStore},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::{
    fs::OpenOptions,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Semaphore},
    time::timeout,
};
use zeroize::Zeroizing;

const CONNECTION_EVENT: &str = "forever://connection-status";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(12);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(60);
const PEER_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const PEER_MESSAGE_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_CONCURRENT_PEERS: usize = 32;
const SERVER_FRAME_QUEUE_SIZE: usize = 64;
const MAX_SEARCH_QUERY_BYTES: usize = 250;
const TRANSFER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const FOLDER_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const PEER_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const FILE_BUFFER_SIZE: usize = 128 * 1024;

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

struct AbortOnDrop(tauri::async_runtime::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

enum ConnectionCommand {
    StartSearch { token: u32, query: String },
    InspectFolder { ticket: FolderTicket },
    PeerConnectionFailed { token: u32, username: String },
    ScheduleDownloads,
}

#[derive(Clone)]
struct PeerServices {
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
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
    command_sender: Arc<Mutex<Option<mpsc::UnboundedSender<ConnectionCommand>>>>,
    generation: Arc<AtomicU64>,
    next_search_token: Arc<AtomicU32>,
    next_folder_token: Arc<AtomicU32>,
    next_connection_token: Arc<AtomicU32>,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
}

impl ConnectionManager {
    pub fn new(
        app: AppHandle,
        settings_path: PathBuf,
        transfers_path: PathBuf,
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
        let search = SearchHub::new(app.clone());
        let transfers = TransferHub::new(app.clone(), transfers_path)?;

        Ok(Self {
            app,
            settings,
            vault: CredentialVault::default(),
            diagnostics,
            suggested_profile: ConnectionProfile::suggested(&download_directory),
            snapshot: Arc::new(RwLock::new(snapshot)),
            task: Arc::new(Mutex::new(None)),
            command_sender: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            next_search_token: Arc::new(AtomicU32::new((timestamp_ms() as u32).max(1))),
            next_folder_token: Arc::new(AtomicU32::new(
                (timestamp_ms() as u32).wrapping_add(0x2000).max(1),
            )),
            next_connection_token: Arc::new(AtomicU32::new(
                (timestamp_ms() as u32).wrapping_add(0x4000).max(1),
            )),
            search,
            folders: FolderHub::default(),
            transfers,
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

    pub fn current_search(&self) -> SearchSnapshot {
        self.search.current()
    }

    pub fn current_transfers(&self) -> TransferQueueSnapshot {
        self.transfers.snapshot()
    }

    pub fn enqueue_transfer(
        &self,
        request: EnqueueTransferRequest,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let profile = self
            .settings
            .load()?
            .ok_or(ConnectionServiceError::NotConfigured)?;
        let snapshot = self
            .transfers
            .enqueue(request, Path::new(&profile.download_directory))?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn enqueue_release(
        &self,
        request: EnqueueReleaseRequest,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let profile = self
            .settings
            .load()?
            .ok_or(ConnectionServiceError::NotConfigured)?;
        let snapshot = self
            .transfers
            .enqueue_release(request, Path::new(&profile.download_directory))?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn pause_transfer(
        &self,
        id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.pause(id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn resume_transfer(
        &self,
        id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.resume(id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn cancel_transfer(
        &self,
        id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.cancel(id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn reveal_transfer_path(&self, id: &str) -> Result<String, ConnectionServiceError> {
        Ok(self.transfers.reveal_path(id)?)
    }

    pub fn pause_release(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.pause_release(release_id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn resume_release(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.resume_release(release_id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn cancel_release(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.cancel_release(release_id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn clear_completed_transfers(
        &self,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.clear_completed()?)
    }

    pub fn reveal_release_path(&self, release_id: &str) -> Result<String, ConnectionServiceError> {
        Ok(self.transfers.reveal_release_path(release_id)?)
    }

    pub async fn inspect_folder(
        &self,
        username: String,
        folder: String,
    ) -> Result<FolderInspection, ConnectionServiceError> {
        let username = username.trim().to_owned();
        let folder = folder.replace('/', "\\").trim_matches('\\').to_owned();
        if username.is_empty() || folder.is_empty() || folder.len() > 4_096 {
            return Err(ConnectionServiceError::InvalidFolderRequest);
        }
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::FolderUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::FolderUnavailable)?;
        let mut folder_token = self.next_folder_token.fetch_add(1, Ordering::SeqCst);
        if folder_token == 0 {
            folder_token = self.next_folder_token.fetch_add(1, Ordering::SeqCst);
        }
        let ticket = FolderTicket {
            connection_token: self.take_connection_token(),
            folder_token,
            username,
            folder,
        };
        let receiver = self.folders.start(ticket.clone());
        if sender
            .send(ConnectionCommand::InspectFolder { ticket })
            .is_err()
        {
            self.folders.fail_folder_token(
                folder_token,
                "The Soulseek connection changed before the folder request could start.".to_owned(),
            );
            return Err(ConnectionServiceError::FolderUnavailable);
        }
        match timeout(FOLDER_REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result.map_err(Into::into),
            Ok(Err(_)) => Err(ConnectionServiceError::FolderUnavailable),
            Err(_) => {
                self.folders.fail_folder_token(
                    folder_token,
                    "The source did not answer the folder request in time.".to_owned(),
                );
                Err(ConnectionServiceError::FolderTimeout)
            }
        }
    }

    fn schedule_downloads(&self) {
        if self.current_snapshot().state != ConnectionState::Online {
            return;
        }
        if let Some(sender) = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            let _ = sender.send(ConnectionCommand::ScheduleDownloads);
        }
    }

    fn take_connection_token(&self) -> u32 {
        loop {
            let token = self.next_connection_token.fetch_add(1, Ordering::SeqCst);
            if token != 0 {
                return token;
            }
        }
    }

    pub fn start_search(&self, query: String) -> Result<SearchSnapshot, ConnectionServiceError> {
        let query = query.trim().to_owned();
        if query.is_empty() {
            return Err(ConnectionServiceError::InvalidSearch(
                "Enter something to search for.".to_owned(),
            ));
        }
        if query.len() > MAX_SEARCH_QUERY_BYTES {
            return Err(ConnectionServiceError::InvalidSearch(format!(
                "Search queries can be at most {MAX_SEARCH_QUERY_BYTES} bytes."
            )));
        }
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::SearchUnavailable);
        }

        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::SearchUnavailable)?;
        let mut token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
        if token == 0 {
            token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
        }

        let snapshot = self.search.start(token, query.clone());
        if sender
            .send(ConnectionCommand::StartSearch { token, query })
            .is_err()
        {
            self.search
                .fail("The Soulseek connection changed before the search could start.");
            return Err(ConnectionServiceError::SearchUnavailable);
        }
        self.diagnostics.record(
            "info",
            "search_started",
            "A live Soulseek search was started.",
        );
        Ok(snapshot)
    }

    pub fn stop_search(&self) -> SearchSnapshot {
        let snapshot = self.search.stop();
        if snapshot.state == SearchState::Stopped {
            self.diagnostics
                .record("info", "search_stopped", "The live search was stopped.");
        }
        snapshot
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

            let outcome = self
                .connect_once(&profile, password.as_str(), attempt)
                .await;
            self.clear_command_sender();
            self.transfers.connection_lost();
            self.folders.connection_lost();
            self.search
                .fail("Search stopped because the Soulseek connection was interrupted.");

            match outcome {
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

        let listener = TcpListener::bind(("0.0.0.0", 0)).await.map_err(|error| {
            ConnectionFailure::retryable(
                format!("Forever could not open a peer listening port: {error}"),
                "listen_failed",
            )
        })?;
        let listen_port = listener
            .local_addr()
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("Forever could not inspect its peer listening port: {error}"),
                    "listen_failed",
                )
            })?
            .port();
        write_raw_frame(&mut stream, &set_wait_port_frame(listen_port))
            .await
            .map_err(|error| {
                ConnectionFailure::retryable(
                    format!("The Soulseek peer listener could not be announced: {error}"),
                    "session_setup_failed",
                )
            })?;
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

        // `read_frame` uses `read_exact`, which is not cancellation-safe. Keep it
        // out of the busy select loop so timer/listener/command branches cannot
        // discard a partially consumed server frame and desynchronize the socket.
        let (server_reader, mut server_writer) = stream.into_split();
        let (server_frame_sender, mut server_frame_receiver) =
            mpsc::channel(SERVER_FRAME_QUEUE_SIZE);
        let _server_reader_task = AbortOnDrop(tauri::async_runtime::spawn(forward_server_frames(
            server_reader,
            server_frame_sender,
        )));

        let (command_sender, mut command_receiver) = mpsc::unbounded_channel();
        *self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(command_sender.clone());

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
        let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);

        let mut keepalive = tokio::time::interval(KEEPALIVE_INTERVAL);
        let mut search_tick = tokio::time::interval(Duration::from_millis(250));
        let peer_limit = Arc::new(Semaphore::new(MAX_CONCURRENT_PEERS));
        keepalive.tick().await;
        search_tick.tick().await;
        loop {
            tokio::select! {
                _ = keepalive.tick() => {
                    write_raw_frame(&mut server_writer, &server_ping_frame()).await.map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The Soulseek keepalive failed: {error}"),
                            "keepalive_failed",
                        )
                    })?;
                }
                frame = server_frame_receiver.recv() => {
                    let frame = match frame {
                        Some(Ok(frame)) => frame,
                        Some(Err(error)) => {
                            return Err(ConnectionFailure::retryable(
                                format!("The Soulseek connection was interrupted: {error}"),
                                "socket_interrupted",
                            ));
                        }
                        None => {
                            return Err(ConnectionFailure::retryable(
                                "The Soulseek server reader stopped unexpectedly.",
                                "socket_interrupted",
                            ));
                        }
                    };
                    if frame.code == RELOGGED_CODE {
                        return Err(ConnectionFailure::fatal(
                            "This account signed in from another Soulseek client.",
                            "relogged",
                        ));
                    }
                    if frame.code == CONNECT_TO_PEER_CODE {
                        if let Ok(request) = parse_connect_to_peer(&frame) {
                            spawn_indirect_peer(
                                request,
                                self.search.clone(),
                                self.folders.clone(),
                                self.transfers.clone(),
                                command_sender.clone(),
                                peer_limit.clone(),
                            );
                        }
                    } else if frame.code == GET_PEER_ADDRESS_CODE {
                        if let Ok(address) = parse_peer_address(&frame) {
                            if let Some(ticket) = self.folders.requesting_for_username(&address.username) {
                                spawn_outbound_folder_peer(
                                    address,
                                    ticket,
                                    profile.username.clone(),
                                    PeerServices {
                                        search: self.search.clone(),
                                        folders: self.folders.clone(),
                                        transfers: self.transfers.clone(),
                                        command_sender: command_sender.clone(),
                                    },
                                    peer_limit.clone(),
                                );
                            } else if let Some(ticket) = self
                                .transfers
                                .requesting_for_username(&address.username)
                            {
                                spawn_outbound_download_peer(
                                    address,
                                    ticket,
                                    profile.username.clone(),
                                    PeerServices {
                                        search: self.search.clone(),
                                        folders: self.folders.clone(),
                                        transfers: self.transfers.clone(),
                                        command_sender: command_sender.clone(),
                                    },
                                    peer_limit.clone(),
                                );
                            }
                        }
                    } else if frame.code == CANT_CONNECT_TO_PEER_CODE {
                        if let Ok(token) = parse_cant_connect_token(&frame) {
                            if self.transfers.fail_connection(
                                token,
                                "The source could not establish a peer connection.".to_owned(),
                            ) {
                                let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
                            }
                            self.folders.fail_connection(
                                token,
                                "The source could not establish a peer connection.".to_owned(),
                            );
                        }
                    }
                }
                accepted = listener.accept() => {
                    let (peer_stream, _) = accepted.map_err(|error| {
                        ConnectionFailure::retryable(
                            format!("The Soulseek peer listener stopped: {error}"),
                            "listen_failed",
                        )
                    })?;
                    spawn_direct_peer(
                        peer_stream,
                        self.search.clone(),
                        self.folders.clone(),
                        self.transfers.clone(),
                        command_sender.clone(),
                        peer_limit.clone(),
                    );
                }
                command = command_receiver.recv() => {
                    match command {
                        Some(ConnectionCommand::StartSearch { token, query }) => {
                            write_raw_frame(&mut server_writer, &file_search_frame(token, &query))
                                .await
                                .map_err(|error| {
                                    ConnectionFailure::retryable(
                                        format!("The live search could not be sent: {error}"),
                                        "search_send_failed",
                                    )
                                })?;
                        }
                        Some(ConnectionCommand::InspectFolder { ticket }) => {
                            write_raw_frame(
                                &mut server_writer,
                                &connect_to_peer_frame(
                                    ticket.connection_token,
                                    &ticket.username,
                                    "P",
                                ),
                            )
                            .await
                            .map_err(|error| {
                                ConnectionFailure::retryable(
                                    format!("The folder peer request could not be sent: {error}"),
                                    "folder_request_failed",
                                )
                            })?;
                            write_raw_frame(
                                &mut server_writer,
                                &get_peer_address_frame(&ticket.username),
                            )
                            .await
                            .map_err(|error| {
                                ConnectionFailure::retryable(
                                    format!("The folder source address request could not be sent: {error}"),
                                    "folder_address_failed",
                                )
                            })?;
                        }
                        Some(ConnectionCommand::PeerConnectionFailed { token, username }) => {
                            write_raw_frame(
                                &mut server_writer,
                                &cant_connect_to_peer_frame(token, &username),
                            )
                            .await
                            .map_err(|error| {
                                ConnectionFailure::retryable(
                                    format!("The peer connection response could not be sent: {error}"),
                                    "peer_response_failed",
                                )
                                })?;
                        }
                        Some(ConnectionCommand::ScheduleDownloads) => {
                            let token = self.take_connection_token();
                            if let Some(ticket) = self.transfers.activate_next(token) {
                                write_raw_frame(
                                    &mut server_writer,
                                    &connect_to_peer_frame(
                                        ticket.connection_token,
                                        &ticket.username,
                                        "P",
                                    ),
                                )
                                .await
                                .map_err(|error| {
                                    ConnectionFailure::retryable(
                                        format!("The download peer request could not be sent: {error}"),
                                        "download_request_failed",
                                    )
                                })?;
                                write_raw_frame(
                                    &mut server_writer,
                                    &get_peer_address_frame(&ticket.username),
                                )
                                .await
                                .map_err(|error| {
                                    ConnectionFailure::retryable(
                                        format!("The source address request could not be sent: {error}"),
                                        "download_address_failed",
                                    )
                                })?;
                                spawn_transfer_request_timeout(
                                    ticket,
                                    self.transfers.clone(),
                                    command_sender.clone(),
                                );
                            }
                        }
                        None => {
                            return Err(ConnectionFailure::retryable(
                                "The Soulseek command channel closed.",
                                "command_channel_closed",
                            ));
                        }
                    }
                }
                _ = search_tick.tick() => {
                    self.search.expire_if_due();
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
        self.clear_command_sender();
        self.search.stop();
        self.transfers.connection_lost();
        self.folders.connection_lost();
        if let Some(active) = self
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            active.handle.abort();
        }
    }

    fn clear_command_sender(&self) {
        self.command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
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

async fn forward_server_frames<R>(mut reader: R, sender: mpsc::Sender<Result<Frame, ProtocolError>>)
where
    R: AsyncRead + Unpin,
{
    loop {
        let frame = read_frame(&mut reader).await;
        let terminal = frame.is_err();
        if sender.send(frame).await.is_err() || terminal {
            return;
        }
    }
}

fn spawn_direct_peer(
    stream: TcpStream,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
    limit: Arc<Semaphore>,
) {
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let _ = handle_direct_peer(stream, search, folders, transfers, command_sender).await;
    });
}

fn spawn_indirect_peer(
    request: ConnectToPeer,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
    limit: Arc<Semaphore>,
) {
    if !matches!(request.connection_type.as_str(), "P" | "F")
        || request.port == 0
        || request.port > u16::MAX.into()
    {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        if handle_indirect_peer(
            &request,
            search,
            folders.clone(),
            transfers,
            command_sender.clone(),
        )
        .await
        .is_err()
        {
            folders.fail_connection(
                request.token,
                "The source peer connection failed before the folder could be read.".to_owned(),
            );
            let _ = command_sender.send(ConnectionCommand::PeerConnectionFailed {
                token: request.token,
                username: request.username,
            });
        }
    });
}

async fn handle_direct_peer(
    mut stream: TcpStream,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) -> Result<(), super::protocol::ProtocolError> {
    let _ = stream.set_nodelay(true);
    let init = timeout(PEER_MESSAGE_TIMEOUT, read_peer_init(&mut stream))
        .await
        .map_err(|_| peer_timeout_error())??;
    match init {
        PeerInit::PierceFirewall { token } => {
            if let Some(ticket) = transfers.claim_peer(token) {
                if let Err(error) = queue_download_on_peer(
                    &mut stream,
                    ticket.clone(),
                    search.clone(),
                    folders.clone(),
                    transfers.clone(),
                    command_sender.clone(),
                )
                .await
                {
                    if transfers.fail_id(
                        &ticket.id,
                        format!("The source connection ended before the file was queued: {error}"),
                    ) {
                        let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
                    }
                }
            } else if let Some(ticket) = folders.claim_peer(token) {
                if let Err(error) = browse_folder_on_peer(
                    &mut stream,
                    ticket.clone(),
                    search,
                    folders.clone(),
                    transfers,
                    command_sender,
                )
                .await
                {
                    folders.fail_connection(
                        ticket.connection_token,
                        format!("The folder connection ended before the source answered: {error}"),
                    );
                }
            }
            Ok(())
        }
        PeerInit::Peer {
            username,
            connection_type,
            ..
        } if connection_type == "P" => {
            handle_peer_messages(
                &mut stream,
                &username,
                search,
                folders,
                transfers,
                command_sender,
            )
            .await
        }
        PeerInit::Peer {
            connection_type, ..
        } if connection_type == "F" => {
            let transfer_token = timeout(PEER_MESSAGE_TIMEOUT, stream.read_u32_le())
                .await
                .map_err(|_| peer_timeout_error())??;
            spawn_file_download(stream, transfer_token, transfers, command_sender);
            Ok(())
        }
        _ => Ok(()),
    }
}

async fn handle_indirect_peer(
    request: &ConnectToPeer,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) -> Result<(), super::protocol::ProtocolError> {
    let mut stream = timeout(
        PEER_CONNECT_TIMEOUT,
        TcpStream::connect((request.address, request.port as u16)),
    )
    .await
    .map_err(|_| peer_timeout_error())??;
    let _ = stream.set_nodelay(true);
    write_raw_frame(&mut stream, &pierce_firewall_frame(request.token)).await?;
    if request.connection_type == "F" {
        let transfer_token = timeout(PEER_MESSAGE_TIMEOUT, stream.read_u32_le())
            .await
            .map_err(|_| peer_timeout_error())??;
        spawn_file_download(stream, transfer_token, transfers, command_sender);
        return Ok(());
    }
    if let Some(ticket) = folders.claim_peer(request.token) {
        return browse_folder_on_peer(
            &mut stream,
            ticket,
            search,
            folders,
            transfers,
            command_sender,
        )
        .await;
    }
    handle_peer_messages(
        &mut stream,
        &request.username,
        search,
        folders,
        transfers,
        command_sender,
    )
    .await
}

fn spawn_outbound_download_peer(
    address: PeerAddress,
    ticket: TransferTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let PeerServices {
            search,
            folders,
            transfers,
            command_sender,
        } = services;
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = transfers.claim_peer(ticket.connection_token) else {
            return;
        };
        if let Err(error) = queue_download_on_peer(
            &mut stream,
            claimed.clone(),
            search,
            folders,
            transfers.clone(),
            command_sender.clone(),
        )
        .await
        {
            if transfers.fail_id(
                &claimed.id,
                format!("The source connection ended before the file was queued: {error}"),
            ) {
                let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
            }
        }
    });
}

fn spawn_outbound_folder_peer(
    address: PeerAddress,
    ticket: FolderTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let PeerServices {
            search,
            folders,
            transfers,
            command_sender,
        } = services;
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = folders.claim_peer(ticket.connection_token) else {
            return;
        };
        if let Err(error) = browse_folder_on_peer(
            &mut stream,
            claimed.clone(),
            search,
            folders.clone(),
            transfers,
            command_sender,
        )
        .await
        {
            folders.fail_connection(
                claimed.connection_token,
                format!("The folder connection ended before the source answered: {error}"),
            );
        }
    });
}

async fn queue_download_on_peer(
    stream: &mut TcpStream,
    ticket: TransferTicket,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) -> Result<(), super::protocol::ProtocolError> {
    write_raw_frame(stream, &queue_upload_frame(&ticket.remote_filename)).await?;
    write_raw_frame(
        stream,
        &place_in_queue_request_frame(&ticket.remote_filename),
    )
    .await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        search,
        folders,
        transfers,
        command_sender,
    )
    .await
}

async fn browse_folder_on_peer(
    stream: &mut TcpStream,
    ticket: FolderTicket,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) -> Result<(), super::protocol::ProtocolError> {
    write_raw_frame(
        stream,
        &folder_contents_request_frame(ticket.folder_token, &ticket.folder),
    )
    .await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        search,
        folders,
        transfers,
        command_sender,
    )
    .await
}

async fn handle_peer_messages(
    stream: &mut TcpStream,
    username: &str,
    search: SearchHub,
    folders: FolderHub,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) -> Result<(), super::protocol::ProtocolError> {
    loop {
        let frame = match timeout(PEER_IDLE_TIMEOUT, read_frame(stream)).await {
            Ok(Ok(frame)) => frame,
            Ok(Err(ProtocolError::Io(error)))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::UnexpectedEof
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ) =>
            {
                return Ok(())
            }
            Ok(Err(error)) => return Err(error),
            Err(_) => return Ok(()),
        };
        match frame.code {
            FILE_SEARCH_RESPONSE_CODE => search.record(parse_search_response(&frame)?),
            FOLDER_CONTENTS_RESPONSE_CODE
                if folders.resolve(username, parse_folder_contents_response(&frame)?) =>
            {
                return Ok(())
            }
            FOLDER_CONTENTS_RESPONSE_CODE => {}
            TRANSFER_REQUEST_CODE => {
                let request = parse_transfer_request(&frame)?;
                let accepted = request.direction == 1
                    && request.size_bytes.is_some_and(|size| {
                        transfers
                            .accept_upload_request(username, &request.filename, request.token, size)
                            .is_some()
                    });
                write_raw_frame(
                    stream,
                    &transfer_response_frame(
                        request.token,
                        accepted,
                        (!accepted).then_some("Cancelled"),
                    ),
                )
                .await?;
                if !accepted
                    && transfers.fail_for_filename(
                        username,
                        &request.filename,
                        "The source reported a different file size than the search result."
                            .to_owned(),
                    )
                {
                    let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
                }
            }
            PLACE_IN_QUEUE_RESPONSE_CODE => {
                let (filename, position) = parse_queue_position(&frame)?;
                transfers.set_queue_position(username, &filename, position);
            }
            UPLOAD_FAILED_CODE => {
                let filename = parse_filename(&frame, UPLOAD_FAILED_CODE)?;
                if transfers.fail_for_filename(
                    username,
                    &filename,
                    "The source stopped the upload before the file completed.".to_owned(),
                ) {
                    let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
                }
            }
            UPLOAD_DENIED_CODE => {
                let (filename, reason) = parse_upload_denied(&frame)?;
                if transfers.fail_for_filename(
                    username,
                    &filename,
                    format!("The source declined the download: {reason}"),
                ) {
                    let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
                }
            }
            _ => {}
        }
    }
}

fn spawn_transfer_request_timeout(
    ticket: TransferTicket,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TRANSFER_REQUEST_TIMEOUT).await;
        if transfers.fail_connection(
            ticket.connection_token,
            "The source did not answer the peer connection request.".to_owned(),
        ) {
            let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
        }
    });
}

fn spawn_file_download(
    stream: TcpStream,
    transfer_token: u32,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    let plan = match transfers.begin_file(transfer_token) {
        Ok(plan) => plan,
        Err(error) => {
            if transfers.fail_transfer_token(transfer_token, error.to_string()) {
                let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
            }
            return;
        }
    };
    let id = plan.id.clone();
    let cancellation = Arc::new(AtomicBool::new(false));
    transfers.register_task(id.clone(), cancellation.clone());
    let task_transfers = transfers.clone();
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = receive_file(stream, &plan, task_transfers.clone(), cancellation).await;
        if let Err(message) = outcome {
            task_transfers.fail_id(&task_id, message);
        }
        task_transfers.unregister_task(&task_id);
        let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
    });
}

async fn receive_file(
    mut stream: TcpStream,
    plan: &DownloadPlan,
    transfers: TransferHub,
    cancellation: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&plan.partial_path)
        .await
        .map_err(|error| format!("Forever could not open the partial file: {error}"))?;
    stream
        .write_u64_le(plan.offset)
        .await
        .map_err(|error| format!("The resume offset could not be sent: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("The source connection could not be started: {error}"))?;

    let mut transferred = plan.offset;
    let mut last_bytes = transferred;
    let mut last_update = Instant::now();
    let mut buffer = vec![0_u8; FILE_BUFFER_SIZE];
    while transferred < plan.size_bytes {
        if cancellation.load(Ordering::SeqCst) {
            return Ok(());
        }
        let remaining = plan.size_bytes - transferred;
        let capacity = usize::try_from(remaining.min(FILE_BUFFER_SIZE as u64))
            .expect("bounded file read size fits usize");
        let count = tokio::select! {
            result = stream.read(&mut buffer[..capacity]) => result
                .map_err(|error| format!("The source connection was interrupted: {error}"))?,
            _ = tokio::time::sleep(Duration::from_millis(100)) => continue,
        };
        if count == 0 {
            return Err("The source closed the connection before the file completed.".to_owned());
        }
        file.write_all(&buffer[..count])
            .await
            .map_err(|error| format!("Forever could not write the partial file: {error}"))?;
        transferred += count as u64;
        let elapsed = last_update.elapsed();
        if elapsed >= Duration::from_millis(250) || transferred == plan.size_bytes {
            let millis = elapsed.as_millis().max(1) as u64;
            let speed = transferred.saturating_sub(last_bytes).saturating_mul(1_000) / millis;
            transfers.update_progress(&plan.id, transferred, speed);
            last_bytes = transferred;
            last_update = Instant::now();
        }
    }
    if cancellation.load(Ordering::SeqCst) {
        return Ok(());
    }
    file.flush()
        .await
        .map_err(|error| format!("Forever could not finish the partial file: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("Forever could not secure the completed file: {error}"))?;
    drop(file);

    if plan.final_path.exists() {
        return Err("A file appeared at the final download path before completion.".to_owned());
    }
    tokio::fs::rename(&plan.partial_path, &plan.final_path)
        .await
        .map_err(|error| format!("Forever could not finalize the downloaded file: {error}"))?;
    transfers
        .complete(&plan.id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn peer_timeout_error() -> super::protocol::ProtocolError {
    super::protocol::ProtocolError::Io(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "Soulseek peer timed out",
    ))
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
    #[error("{0}")]
    Transfer(#[from] TransferError),
    #[error("{0}")]
    Folder(#[from] FolderError),
    #[error("Add your Soulseek account before connecting.")]
    NotConfigured,
    #[error("Enter your Soulseek password.")]
    MissingPassword,
    #[error("Connect to Soulseek before starting a live search.")]
    SearchUnavailable,
    #[error("Connect to Soulseek before browsing a source folder.")]
    FolderUnavailable,
    #[error("Choose a valid Soulseek source folder.")]
    InvalidFolderRequest,
    #[error("The source did not answer the folder request in time.")]
    FolderTimeout,
    #[error("{0}")]
    InvalidSearch(String),
    #[error("Could not initialize connection diagnostics: {0}")]
    Diagnostics(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

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

    #[tokio::test]
    async fn server_frame_pump_preserves_fragmented_frames_while_other_events_fire() {
        let (mut writer, reader) = tokio::io::duplex(64);
        let (sender, mut receiver) = mpsc::channel(2);
        let pump = tokio::spawn(forward_server_frames(reader, sender));
        let first = server_ping_frame();
        let second = set_online_frame();

        let fragmented_writer = tokio::spawn(async move {
            for byte in first.into_iter().chain(second) {
                writer.write_all(&[byte]).await.unwrap();
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        let mut competing_tick = tokio::time::interval(Duration::from_millis(1));
        let mut competing_events = 0;
        let mut received = Vec::new();
        while received.len() < 2 {
            tokio::select! {
                biased;
                _ = competing_tick.tick(), if competing_events == 0 => competing_events += 1,
                frame = receiver.recv() => received.push(frame.unwrap().unwrap()),
            }
        }

        assert!(competing_events > 0);
        assert_eq!(received[0].code, super::super::protocol::SERVER_PING_CODE);
        assert_eq!(received[1].code, super::super::protocol::SET_STATUS_CODE);
        fragmented_writer.await.unwrap();
        pump.abort();
    }
}
