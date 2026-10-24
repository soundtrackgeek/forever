use super::album_query::{AlbumIdentity, QueryMemory};
use super::app_settings::{AppSettings, Settings, SettingsPatch};
use super::credentials::CredentialVault;
use super::diagnostics::{DiagnosticEntry, Diagnostics};
use super::distributed::{DistributedHub, DistributedSnapshot};
use super::downloads::{
    EnqueueReleaseRequest, EnqueueTransferRequest, PatchReleaseFileRequest,
    ReleaseAlternativeSource, TransferError, TransferHub, TransferPreparationMode,
    TransferQueueSnapshot,
};
use super::folders::{FolderError, FolderHub, FolderInspection, FolderTicket};
use super::local_shares::{LocalSharesError, LocalSharesHub, LocalSharesSnapshot};
use super::messages::{MessagesError, MessagesHub, MessagesSnapshot};
use super::people::{
    PeopleError, PeopleHub, PeopleSnapshot, PersonProfile, ProfileState, ProfileTicket,
};
use super::radar::{RadarAlbumRequest, RadarError, RadarHub, RadarSnapshot};
use super::reachability::{ReachabilityHub, ReachabilitySnapshot};
use super::rooms::{valid_room_message, valid_room_name, RoomsError, RoomsHub, RoomsSnapshot};
use super::search::{valid_client_id, SearchHub, SearchSnapshot, SearchState};
use super::search_governor::SearchGovernor;
use super::settings::ConnectionProfile;
use super::shares::{
    ShareFolderSnapshot, ShareSearchSnapshot, SharesError, SharesHub, SharesTicket,
    UserSharesOverview,
};
use super::store::{JsonFile, StoreNotice};
use super::upload_policy::UploadPolicy;
use super::uploads::{UploadError, UploadHub, UploadQueueSnapshot};
use super::wanted::{
    WantedAlbumRequest, WantedDownloadFulfillmentRequest, WantedError, WantedFulfillmentRequest,
    WantedHub, WantedPreferences, WantedSnapshot,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::time::timeout;
use zeroize::Zeroizing;

mod commands;
mod connection;
mod hubs;
mod network;
mod peers;
mod server;
mod session;
#[cfg(test)]
mod tests;

const CONNECTION_EVENT: &str = "forever://connection-status";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(12);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(60);
const PEER_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const PEER_MESSAGE_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_CONCURRENT_PEERS: usize = 32;
const SERVER_FRAME_QUEUE_SIZE: usize = 64;
const MAX_SEARCH_QUERY_BYTES: usize = 250;
const MAX_SEARCH_USERNAME_BYTES: usize = 100;
const TRANSFER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const FOLDER_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const SHARES_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const PROFILE_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const PEER_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const FILE_BUFFER_SIZE: usize = 128 * 1024;
const DISTRIBUTED_EVENT_QUEUE_SIZE: usize = 256;
const DISTRIBUTED_PARENT_IDLE_TIMEOUT: Duration = Duration::from_secs(3 * 60);

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
    pub search_network: DistributedSnapshot,
    pub reachability: ReachabilitySnapshot,
    pub storage_notices: Vec<StoreNotice>,
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
    SearchesChanged,
    SendPrivateMessage {
        id: String,
        username: String,
        message: String,
    },
    RefreshRooms,
    JoinRoom {
        room: String,
    },
    LeaveRoom {
        room: String,
    },
    SendRoomMessage {
        room: String,
        message: String,
    },
    InspectFolder {
        ticket: FolderTicket,
    },
    BrowseShares {
        ticket: SharesTicket,
    },
    RequestProfile {
        ticket: ProfileTicket,
    },
    WatchPerson {
        username: String,
    },
    UnwatchPerson {
        username: String,
    },
    PeerConnectionFailed {
        token: u32,
        username: String,
    },
    ScheduleDownloads,
    ScheduleUploads,
    ReportUploadSpeed {
        bytes_per_second: u32,
    },
    OpenUploadFile {
        id: String,
    },
    RefreshSharedCounts,
}

#[derive(Clone)]
struct PeerServices {
    bandwidth: super::bandwidth::Bandwidth,
    search: SearchHub,
    wanted: WantedHub,
    radar: RadarHub,
    folders: FolderHub,
    shares: SharesHub,
    people: PeopleHub,
    transfers: TransferHub,
    local_shares: LocalSharesHub,
    uploads: UploadHub,
    distributed: DistributedHub,
    own_username: String,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PeerMessagePurpose {
    General,
    Transfer,
    Folder,
    Shares(u32),
    Profile(u32),
}

#[derive(Clone)]
pub struct ConnectionManager {
    bandwidth: super::bandwidth::Bandwidth,
    app: AppHandle,
    settings: AppSettings,
    settings_operation: Arc<Mutex<()>>,
    store_files: Vec<JsonFile>,
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
    search_governor: SearchGovernor,
    wanted: WantedHub,
    radar: RadarHub,
    folders: FolderHub,
    shares: SharesHub,
    people: PeopleHub,
    messages: MessagesHub,
    rooms: RoomsHub,
    transfers: TransferHub,
    local_shares: LocalSharesHub,
    uploads: UploadHub,
    distributed: DistributedHub,
    reachability: ReachabilityHub,
}

pub struct ConnectionPaths {
    pub settings: PathBuf,
    pub transfers: PathBuf,
    pub sharing: PathBuf,
    pub people: PathBuf,
    pub messages: PathBuf,
    pub rooms: PathBuf,
    pub wanted: PathBuf,
    pub diagnostics: PathBuf,
}

impl ConnectionManager {
    pub(crate) fn filing_transfers(&self) -> TransferHub {
        self.transfers.clone()
    }
    pub fn new(
        app: AppHandle,
        paths: ConnectionPaths,
        download_directory: PathBuf,
    ) -> Result<Self, ConnectionServiceError> {
        let diagnostics = Diagnostics::new(paths.diagnostics);
        let store_files: Vec<_> = [
            paths.settings,
            paths.transfers,
            paths.sharing,
            paths.people,
            paths.messages,
            paths.rooms,
            paths.wanted.clone(),
            paths.wanted.with_file_name("search-queries.json"),
            paths.wanted.with_file_name("uploads.json"),
            paths.wanted.with_file_name("archive.json"),
            paths.wanted.with_file_name("settings.json"),
        ]
        .into_iter()
        .map(JsonFile::new)
        .collect();
        let settings = AppSettings::open(store_files[10].clone(), &store_files[..10]);
        let preferences = settings.get();
        let profile = settings.load()?;
        let snapshot = profile
            .as_ref()
            .map(ConnectionSnapshot::offline)
            .unwrap_or_else(ConnectionSnapshot::unconfigured);
        let queries = QueryMemory::new(store_files[7].clone());
        let search = SearchHub::new(app.clone(), queries.clone());
        let transfers = TransferHub::new(
            app.clone(),
            store_files[1].clone(),
            &preferences.transfers,
            settings.file(),
        )?;
        let local_shares =
            LocalSharesHub::new(app.clone(), store_files[2].clone(), settings.clone())?;
        let uploads = UploadHub::new(
            app.clone(),
            store_files[8].clone(),
            local_shares.upload_policy(),
        );
        let distributed = DistributedHub::new(app.clone());
        let reachability = ReachabilityHub::new(app.clone());
        let people = PeopleHub::new(app.clone(), store_files[3].clone())?;
        uploads.set_policy(local_shares.upload_policy(), people.saved_users_to_watch());
        let messages = MessagesHub::new(app.clone(), store_files[4].clone())?;
        let rooms = RoomsHub::new(app.clone(), store_files[5].clone())?;
        let search_governor = SearchGovernor::default();
        let wanted = WantedHub::new(
            app.clone(),
            store_files[6].clone(),
            search_governor.clone(),
            queries.clone(),
            &preferences.wanted,
            settings.file(),
        )?;
        let radar = RadarHub::new(app.clone(), queries);

        Ok(Self {
            bandwidth: super::bandwidth::Bandwidth::new(preferences.transfers.bandwidth.clone()),
            app,
            settings,
            settings_operation: Arc::new(Mutex::new(())),
            store_files,
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
            search_governor,
            wanted,
            radar,
            folders: FolderHub::default(),
            shares: SharesHub::default(),
            people,
            messages,
            rooms,
            transfers,
            local_shares,
            uploads,
            distributed,
            reachability,
        })
    }

    pub fn bandwidth(&self) -> super::bandwidth::Bandwidth {
        self.bandwidth.clone()
    }

    pub fn bandwidth_changed(&self) {
        self.transfers.wake_scheduler();
        self.schedule_downloads();
        self.schedule_uploads();
    }

    pub fn settings_store(&self) -> AppSettings {
        self.settings.clone()
    }

    pub(crate) fn publish_settings(&self) {
        let _ = self.app.emit("forever://settings", self.settings.get());
    }

    fn apply_settings(&self, previous: &Settings, next: &Settings) {
        if previous.connection != next.connection {
            self.stop_active_task();
            self.publish(
                next.connection
                    .as_ref()
                    .map(ConnectionSnapshot::offline)
                    .unwrap_or_else(ConnectionSnapshot::unconfigured),
            );
        }
        if previous.transfers.bandwidth != next.transfers.bandwidth {
            self.bandwidth.configure(next.transfers.bandwidth.clone());
            let _ = self
                .app
                .emit("forever://bandwidth", self.bandwidth.snapshot());
            self.bandwidth_changed();
        }
        if previous.transfers != next.transfers {
            self.transfers.apply_settings(&next.transfers);
            self.schedule_downloads();
        }
        if previous.wanted != next.wanted {
            self.wanted.apply_settings(&next.wanted);
        }
        if previous.sharing != next.sharing {
            self.local_shares.apply_settings(&next.sharing);
            self.uploads.set_policy(
                next.sharing.upload_policy.clone(),
                self.people.saved_users_to_watch(),
            );
            self.schedule_uploads();
            if previous.sharing.roots != next.sharing.roots {
                let manager = self.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = manager.rescan_local_shares();
                });
            }
        }
        self.publish_settings();
    }

    pub fn patch_settings(&self, patch: SettingsPatch) -> Result<Settings, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let previous = self.settings.get();
        if patch.touches_webview() && !previous.webview_migrated {
            return Err(super::settings::SettingsError::Validation("WebView preferences have not finished migrating. Resolve the settings notice and restart, or import a complete settings backup.".into()).into());
        }
        let next = self.settings.update(|s| patch.apply(s))?;
        self.apply_settings(&previous, &next);
        Ok(next)
    }

    pub fn import_settings(&self, json: &str) -> Result<Settings, String> {
        let imported = super::app_settings::parse_import(json)?;
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let previous = self.settings.get();
        let next = self
            .settings
            .update(|s| {
                *s = imported;
                s.webview_migrated = true;
            })
            .map_err(|e| e.to_string())?;
        self.apply_settings(&previous, &next);
        Ok(next)
    }

    pub fn reset_settings_section(&self, section: &str) -> Result<Settings, String> {
        if ["preferences", "searches"].contains(&section) && !self.settings.get().webview_migrated {
            return Err("WebView preferences have not finished migrating. Resolve the settings notice and restart, or import a complete settings backup.".into());
        }
        if section == "connection" {
            self.reset().map_err(|e| e.to_string())?;
            return Ok(self.settings.get());
        }
        if ![
            "desktop",
            "transfers",
            "sharing",
            "wanted",
            "archive",
            "preferences",
            "searches",
        ]
        .contains(&section)
        {
            return Err("Unknown settings section.".into());
        }
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let previous = self.settings.get();
        let next = self
            .settings
            .update(|s| match section {
                "desktop" => s.desktop = Default::default(),
                "transfers" => s.transfers = Default::default(),
                "sharing" => s.sharing = Default::default(),
                "wanted" => s.wanted = Default::default(),
                "archive" => s.archive_database_path = None,
                "searches" => s.dial_memory = Default::default(),
                "preferences" => {
                    s.preferences = Default::default();
                    s.webview_migrated = true;
                }
                _ => unreachable!(),
            })
            .map_err(|e| e.to_string())?;
        self.apply_settings(&previous, &next);
        Ok(next)
    }

    pub fn migrate_webview_settings(
        &self,
        preferences: super::app_settings::Preferences,
        dial_memory: super::app_settings::DialMemory,
    ) -> Result<Settings, String> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let previous = self.settings.get();
        if previous.webview_migrated {
            return Ok(previous);
        }
        let next = self
            .settings
            .update(|s| {
                s.preferences = preferences;
                s.dial_memory = dial_memory;
                s.webview_migrated = true;
            })
            .map_err(|e| e.to_string())?;
        self.publish_settings();
        Ok(next)
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
            search_network: self.distributed.snapshot(),
            reachability: self.reachability.snapshot(),
            storage_notices: self
                .store_files
                .iter()
                .flat_map(JsonFile::notices)
                .collect(),
        })
    }

    pub fn save_profile(
        &self,
        request: SaveConnectionRequest,
    ) -> Result<ConnectionBootstrap, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
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
        self.publish_settings();

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
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        self.stop_active_task();
        if let Some(profile) = self.settings.load()? {
            self.vault.forget(&profile.username)?;
        }
        self.settings.delete()?;
        self.publish_settings();
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

    pub(super) fn diagnostic_logger(&self) -> Diagnostics {
        self.diagnostics.clone()
    }

    pub async fn test_reachability(&self) -> Result<ReachabilitySnapshot, String> {
        self.reachability.test().await
    }

    pub async fn shutdown_network(&self) {
        // Await cancellation so the session's mapping owner has been dropped
        // before waiting for its deletion worker.
        let active = self.task.lock().unwrap_or_else(|p| p.into_inner()).take();
        let _ = self.disconnect();
        if let Some(active) = active {
            active.handle.abort();
            let _ = active.handle.await;
        }
        self.reachability.wait_for_cleanup().await;
    }

    pub fn current_searches(&self) -> Vec<SearchSnapshot> {
        self.search.snapshots()
    }

    pub fn current_wanted(&self) -> WantedSnapshot {
        self.wanted.snapshot()
    }

    pub(crate) fn add_radar_wanted(&self, request: WantedAlbumRequest) -> Result<(), String> {
        self.wanted
            .add_if_missing(request)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn current_radar(&self) -> RadarSnapshot {
        self.radar.snapshot()
    }

    pub fn start_radar(
        &self,
        albums: Vec<RadarAlbumRequest>,
    ) -> Result<RadarSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::RadarUnavailable);
        }
        let snapshot = self.radar.start(albums)?;
        self.diagnostics.record(
            "info",
            "radar_started",
            "A bounded Shelf Radar scan was started.",
        );
        Ok(snapshot)
    }

    pub fn stop_radar(&self) -> RadarSnapshot {
        let snapshot = self.radar.stop();
        if snapshot.state == super::radar::RadarState::Stopped {
            self.diagnostics
                .record("info", "radar_stopped", "The Shelf Radar scan was stopped.");
        }
        snapshot
    }

    pub fn add_wanted(
        &self,
        request: WantedAlbumRequest,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.add(request)?)
    }

    pub fn add_many_wanted(
        &self,
        requests: Vec<WantedAlbumRequest>,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.add_many(requests, preferences)?)
    }

    pub fn remove_wanted(&self, album_id: &str) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.remove(album_id)?)
    }

    pub fn fulfill_downloaded_wanted(
        &self,
        fulfillments: Vec<WantedDownloadFulfillmentRequest>,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.fulfill_downloaded(fulfillments)?)
    }

    pub fn restore_wanted(&self, album_id: &str) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.restore(album_id)?)
    }

    pub fn set_wanted_paused(
        &self,
        album_id: &str,
        paused: bool,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.set_paused(album_id, paused)?)
    }

    pub fn set_wanted_interval(
        &self,
        interval_minutes: u32,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            wanted_interval_minutes: Some(interval_minutes),
            ..Default::default()
        })?;
        Ok(self.wanted.snapshot())
    }

    pub fn set_wanted_preferences(
        &self,
        album_id: &str,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.set_preferences(album_id, preferences)?)
    }

    pub fn set_wanted_edition(
        &self,
        album_id: &str,
        release_id: Option<String>,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.set_edition(album_id, release_id)?)
    }

    pub fn set_default_wanted_preferences(
        &self,
        preferences: WantedPreferences,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            wanted_default_preferences: Some(preferences),
            ..Default::default()
        })?;
        Ok(self.wanted.snapshot())
    }

    pub fn sync_wanted_fulfilled(
        &self,
        fulfillments: Vec<WantedFulfillmentRequest>,
    ) -> Result<WantedSnapshot, ConnectionServiceError> {
        Ok(self.wanted.sync_fulfilled(fulfillments)?)
    }

    pub fn check_wanted(&self, album_id: &str) -> Result<WantedSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::WantedUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::WantedUnavailable)?;
        let mut token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
        if token == 0 {
            token = self.next_search_token.fetch_add(1, Ordering::SeqCst);
        }
        self.wanted.start_manual(album_id, token)?;
        if sender.send(ConnectionCommand::SearchesChanged).is_err() {
            self.wanted
                .fail_active("The Soulseek connection changed before this check could start.");
            return Err(ConnectionServiceError::WantedUnavailable);
        }
        Ok(self.wanted.snapshot())
    }

    pub async fn prepare_desktop_exit(&self) -> Result<(), String> {
        self.prepare_transfers_for_restart(TransferPreparationMode::PauseNow)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn desktop_status_label(&self) -> String {
        let state = match self.current_snapshot().state {
            ConnectionState::Unconfigured => "Account setup needed",
            ConnectionState::Offline => "Offline",
            ConnectionState::Connecting | ConnectionState::Authenticating => "Connecting",
            ConnectionState::Online => "Online",
            ConnectionState::Reconnecting => "Reconnecting",
            ConnectionState::Error => "Connection error",
        };
        let paused = if self.bandwidth.paused() {
            " · Transfers paused"
        } else {
            ""
        };
        format!(
            "Forever · {state} · {} downloads · {} uploads{paused}",
            self.transfers.active_task_count(),
            self.uploads.active_count()
        )
    }

    pub fn toggle_transfer_pause(&self) -> Result<Settings, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let previous = self.settings.get();
        let next = self.settings.update(|s| {
            s.transfers.bandwidth.manual_paused = !s.transfers.bandwidth.manual_paused
        })?;
        self.apply_settings(&previous, &next);
        Ok(next)
    }

    pub fn current_transfers(&self) -> TransferQueueSnapshot {
        self.transfers.snapshot()
    }

    pub async fn prepare_transfers_for_restart(
        &self,
        mode: TransferPreparationMode,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.transfers.begin_restart_preparation(mode)?;
        while self.transfers.active_task_count() > 0 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let snapshot = self.transfers.finish_restart_preparation()?;
        self.transfers.flush_store().await?;
        Ok(snapshot)
    }

    pub fn cancel_restart_preparation(
        &self,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.cancel_restart_preparation()?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn set_max_concurrent_downloads(
        &self,
        max_concurrent_downloads: u8,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            max_concurrent_downloads: Some(max_concurrent_downloads),
            ..Default::default()
        })?;
        Ok(self.transfers.snapshot())
    }

    pub fn set_soundcheck_enabled(
        &self,
        enabled: bool,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            soundcheck_enabled: Some(enabled),
            ..Default::default()
        })?;
        Ok(self.transfers.snapshot())
    }

    pub fn current_local_shares(&self) -> LocalSharesSnapshot {
        self.local_shares.snapshot()
    }

    pub fn current_people(&self) -> PeopleSnapshot {
        self.people.snapshot()
    }

    pub fn current_messages(&self) -> MessagesSnapshot {
        self.messages.snapshot()
    }

    pub fn current_rooms(&self) -> RoomsSnapshot {
        self.rooms.snapshot()
    }

    pub fn refresh_rooms(&self) -> Result<RoomsSnapshot, ConnectionServiceError> {
        self.send_room_command(ConnectionCommand::RefreshRooms)?;
        Ok(self.rooms.snapshot())
    }

    pub fn join_room(&self, room: String) -> Result<RoomsSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::RoomsUnavailable);
        }
        let room = valid_room_name(&room)?;
        let snapshot = self.rooms.request_join(&room)?;
        self.send_room_command(ConnectionCommand::JoinRoom { room })?;
        Ok(snapshot)
    }

    pub fn leave_room(&self, room: String) -> Result<RoomsSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::RoomsUnavailable);
        }
        let room = valid_room_name(&room)?;
        let snapshot = self.rooms.request_leave(&room)?;
        self.send_room_command(ConnectionCommand::LeaveRoom { room })?;
        Ok(snapshot)
    }

    pub fn send_room_message(
        &self,
        room: String,
        message: String,
    ) -> Result<RoomsSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::RoomsUnavailable);
        }
        let room = valid_room_name(&room)?;
        let message = valid_room_message(&message)?;
        self.send_room_command(ConnectionCommand::SendRoomMessage { room, message })?;
        Ok(self.rooms.snapshot())
    }

    pub fn mark_room_read(&self, room: &str) -> Result<RoomsSnapshot, ConnectionServiceError> {
        Ok(self.rooms.mark_read(room)?)
    }

    pub fn set_room_favorite(
        &self,
        room: &str,
        favorite: bool,
    ) -> Result<RoomsSnapshot, ConnectionServiceError> {
        Ok(self.rooms.set_favorite(room, favorite)?)
    }

    fn send_room_command(&self, command: ConnectionCommand) -> Result<(), ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::RoomsUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::RoomsUnavailable)?;
        sender
            .send(command)
            .map_err(|_| ConnectionServiceError::RoomsUnavailable)
    }

    pub fn send_private_message(
        &self,
        username: String,
        message: String,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        let username = username.trim().to_owned();
        let message = super::messages::valid_message(&message)?;
        if username.is_empty() || username.len() > MAX_SEARCH_USERNAME_BYTES {
            return Err(ConnectionServiceError::InvalidPerson);
        }
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::MessagesUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::MessagesUnavailable)?;
        self.people.remember(&username)?;
        let (id, snapshot) = self.messages.queue_outgoing(&username, &message)?;
        if sender
            .send(ConnectionCommand::SendPrivateMessage {
                id: id.clone(),
                username,
                message,
            })
            .is_err()
        {
            let _ = self.messages.mark_failed(
                &id,
                "The Soulseek connection closed before this message was sent.",
            );
            return Err(ConnectionServiceError::MessagesUnavailable);
        }
        Ok(snapshot)
    }

    pub fn retry_private_message(
        &self,
        id: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::MessagesUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::MessagesUnavailable)?;
        let (username, message, snapshot) = self.messages.retry(id)?;
        if sender
            .send(ConnectionCommand::SendPrivateMessage {
                id: id.to_owned(),
                username,
                message,
            })
            .is_err()
        {
            let _ = self.messages.mark_failed(
                id,
                "The Soulseek connection closed before this message was sent.",
            );
            return Err(ConnectionServiceError::MessagesUnavailable);
        }
        Ok(snapshot)
    }

    pub fn open_conversation(
        &self,
        username: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        self.people.remember(username)?;
        Ok(self.messages.open_conversation(username)?)
    }

    pub fn mark_conversation_read(
        &self,
        username: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        Ok(self.messages.mark_read(username)?)
    }

    pub fn mark_conversation_unread(
        &self,
        username: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        Ok(self.messages.mark_unread(username)?)
    }

    pub fn clear_conversation(
        &self,
        username: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        Ok(self.messages.clear_conversation(username)?)
    }

    pub fn remove_conversation(
        &self,
        username: &str,
    ) -> Result<MessagesSnapshot, ConnectionServiceError> {
        Ok(self.messages.remove_conversation(username)?)
    }

    pub async fn open_person_profile(
        &self,
        username: String,
        refresh: bool,
    ) -> Result<PersonProfile, ConnectionServiceError> {
        let username = username.trim().to_owned();
        if username.is_empty() || username.len() > MAX_SEARCH_USERNAME_BYTES {
            return Err(ConnectionServiceError::InvalidPerson);
        }
        if !refresh {
            if let Some(profile) = self.people.profile(&username) {
                if profile.profile_state == ProfileState::Ready {
                    self.people.remember(&username)?;
                    return Ok(profile);
                }
            }
        }
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::PeopleUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::PeopleUnavailable)?;
        let ticket = ProfileTicket {
            connection_token: self.take_connection_token(),
            username,
        };
        let connection_token = ticket.connection_token;
        let receiver = self.people.start_profile(ticket.clone())?;
        if sender
            .send(ConnectionCommand::RequestProfile { ticket })
            .is_err()
        {
            self.people.fail_profile(
                connection_token,
                "The Soulseek connection changed before the profile request could start."
                    .to_owned(),
            );
            return Err(ConnectionServiceError::PeopleUnavailable);
        }
        match timeout(PROFILE_REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result.map_err(Into::into),
            Ok(Err(_)) => Err(ConnectionServiceError::PeopleUnavailable),
            Err(_) => {
                self.people.fail_profile(
                    connection_token,
                    "The user did not answer the profile request in time.".to_owned(),
                );
                Err(ConnectionServiceError::ProfileTimeout)
            }
        }
    }

    pub fn set_person_favorite(
        &self,
        username: &str,
        favorite: bool,
    ) -> Result<PeopleSnapshot, ConnectionServiceError> {
        let snapshot = self.people.set_favorite(username, favorite)?;
        self.uploads.set_policy(
            self.local_shares.upload_policy(),
            self.people.saved_users_to_watch(),
        );
        self.schedule_uploads();
        if self.current_snapshot().state == ConnectionState::Online {
            if let Some(sender) = self
                .command_sender
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
            {
                let command = if favorite {
                    ConnectionCommand::WatchPerson {
                        username: username.to_owned(),
                    }
                } else {
                    ConnectionCommand::UnwatchPerson {
                        username: username.to_owned(),
                    }
                };
                let _ = sender.send(command);
            }
        }
        Ok(snapshot)
    }

    pub fn set_person_blocked(
        &self,
        username: &str,
        blocked: bool,
    ) -> Result<PeopleSnapshot, ConnectionServiceError> {
        Ok(self.people.set_blocked(username, blocked)?)
    }

    pub fn set_person_ignored(
        &self,
        username: &str,
        ignored: bool,
    ) -> Result<PeopleSnapshot, ConnectionServiceError> {
        Ok(self.people.set_ignored(username, ignored)?)
    }

    pub fn add_local_share(
        &self,
        path: &str,
    ) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let snapshot = self.local_shares.add_root(path)?;
        self.publish_settings();
        self.refresh_shared_counts();
        Ok(snapshot)
    }

    pub fn remove_local_share(
        &self,
        id: &str,
    ) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let snapshot = self.local_shares.remove_root(id)?;
        self.publish_settings();
        self.refresh_shared_counts();
        Ok(snapshot)
    }

    pub fn set_local_share_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        let _guard = self
            .settings_operation
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let snapshot = self.local_shares.set_enabled(id, enabled)?;
        self.publish_settings();
        self.refresh_shared_counts();
        Ok(snapshot)
    }

    pub fn rescan_local_shares(&self) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        let snapshot = self.local_shares.scan()?;
        self.refresh_shared_counts();
        Ok(snapshot)
    }

    pub fn set_upload_slots(
        &self,
        upload_slots: u8,
    ) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            upload_slots: Some(upload_slots),
            ..Default::default()
        })?;
        Ok(self.local_shares.snapshot())
    }

    pub fn set_upload_policy(
        &self,
        policy: UploadPolicy,
    ) -> Result<LocalSharesSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            upload_policy: Some(policy),
            ..Default::default()
        })?;
        Ok(self.local_shares.snapshot())
    }

    pub fn current_uploads(&self) -> UploadQueueSnapshot {
        self.uploads.snapshot()
    }

    pub fn cancel_upload(&self, id: &str) -> Result<UploadQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.uploads.cancel(id)?;
        self.schedule_uploads();
        Ok(snapshot)
    }

    pub fn clear_finished_uploads(&self) -> UploadQueueSnapshot {
        self.uploads.clear_finished()
    }

    pub fn enqueue_transfer(
        &self,
        request: EnqueueTransferRequest,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let profile = self
            .settings
            .load()?
            .ok_or(ConnectionServiceError::NotConfigured)?;
        self.people.remember(&request.username)?;
        let snapshot = self.transfers.enqueue(
            request,
            self.settings
                .get()
                .transfers
                .filing
                .incomplete_directory
                .as_deref()
                .map(Path::new)
                .unwrap_or(Path::new(&profile.download_directory)),
        )?;
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
        self.people.remember(&request.username)?;
        let snapshot = self.transfers.enqueue_release(
            request,
            self.settings
                .get()
                .transfers
                .filing
                .incomplete_directory
                .as_deref()
                .map(Path::new)
                .unwrap_or(Path::new(&profile.download_directory)),
        )?;
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

    pub fn reorder_release(
        &self,
        release_id: &str,
        before_transfer_id: Option<&str>,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self
            .transfers
            .reorder_release(release_id, before_transfer_id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn clear_completed_transfers(
        &self,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.clear_completed()?)
    }

    pub fn set_release_filed(
        &self,
        release_id: &str,
        filed: bool,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.set_release_filed(release_id, filed)?)
    }

    pub fn clear_release_history(
        &self,
        release_ids: &[String],
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.clear_release_history(release_ids)?)
    }

    pub fn verify_release(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.verify_release(release_id)?)
    }

    pub fn verify_completed(&self) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.verify_completed()?)
    }

    pub fn soundcheck_release(
        &self,
        release_id: &str,
        deep: bool,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        Ok(self.transfers.soundcheck_release(release_id, deep)?)
    }

    pub fn retry_release_issues(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        let snapshot = self.transfers.retry_release_issues(release_id)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn switch_release_source(
        &self,
        release_id: &str,
        username: &str,
        remote_folder: &str,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.people.remember(username)?;
        let snapshot = self
            .transfers
            .switch_release_source(release_id, username, remote_folder)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn auto_relay_release_source(
        &self,
        release_id: &str,
        source: ReleaseAlternativeSource,
    ) -> Result<bool, ConnectionServiceError> {
        if self.current_snapshot().state != ConnectionState::Online
            || self.bandwidth.paused()
            || self.people.is_blocked(&source.username)
            || self.people.is_ignored(&source.username)
        {
            return Ok(false);
        }
        let switched = self
            .transfers
            .auto_relay_release_source(release_id, source)?;
        if switched {
            self.schedule_downloads();
        }
        Ok(switched)
    }

    pub fn relay_release_source(
        &self,
        release_id: &str,
        source: ReleaseAlternativeSource,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.people.remember(&source.username)?;
        let snapshot = self.transfers.relay_release_source(release_id, source)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn patch_release_file(
        &self,
        request: PatchReleaseFileRequest,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.people.remember(&request.username)?;
        let snapshot = self.transfers.patch_release_file(request)?;
        self.schedule_downloads();
        Ok(snapshot)
    }

    pub fn set_relay_suggestion_minutes(
        &self,
        minutes: u32,
    ) -> Result<TransferQueueSnapshot, ConnectionServiceError> {
        self.patch_settings(SettingsPatch {
            relay_suggestion_minutes: Some(minutes),
            ..Default::default()
        })?;
        Ok(self.transfers.snapshot())
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

    pub async fn browse_shares(
        &self,
        username: String,
        refresh: bool,
    ) -> Result<UserSharesOverview, ConnectionServiceError> {
        let username = username.trim().to_owned();
        if username.is_empty() || username.len() > 64 {
            return Err(ConnectionServiceError::InvalidSharesRequest);
        }
        self.people.remember(&username)?;
        if !refresh {
            if let Some(cached) = self.shares.cached(&username) {
                return Ok(cached);
            }
        }
        if self.current_snapshot().state != ConnectionState::Online {
            return Err(ConnectionServiceError::SharesUnavailable);
        }
        let sender = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or(ConnectionServiceError::SharesUnavailable)?;
        let ticket = SharesTicket {
            connection_token: self.take_connection_token(),
            username,
        };
        let connection_token = ticket.connection_token;
        let receiver = self.shares.start(ticket.clone());
        if sender
            .send(ConnectionCommand::BrowseShares { ticket })
            .is_err()
        {
            self.shares.fail_connection(
                connection_token,
                "The Soulseek connection changed before share browsing could start.".to_owned(),
            );
            return Err(ConnectionServiceError::SharesUnavailable);
        }
        match timeout(SHARES_REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result.map_err(Into::into),
            Ok(Err(_)) => Err(ConnectionServiceError::SharesUnavailable),
            Err(_) => {
                self.shares.fail_connection(
                    connection_token,
                    "The user did not answer the share-list request in time.".to_owned(),
                );
                Err(ConnectionServiceError::SharesTimeout)
            }
        }
    }

    pub fn shared_folder(
        &self,
        username: &str,
        directory: &str,
    ) -> Result<ShareFolderSnapshot, ConnectionServiceError> {
        Ok(self.shares.folder(username, directory)?)
    }

    pub fn search_shares(
        &self,
        username: &str,
        query: &str,
        extension: Option<&str>,
    ) -> Result<ShareSearchSnapshot, ConnectionServiceError> {
        if query.len() > MAX_SEARCH_QUERY_BYTES {
            return Err(ConnectionServiceError::InvalidSharesRequest);
        }
        Ok(self.shares.search(username, query, extension)?)
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

    fn schedule_uploads(&self) {
        if self.current_snapshot().state != ConnectionState::Online {
            return;
        }
        if let Some(sender) = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            let _ = sender.send(ConnectionCommand::ScheduleUploads);
        }
    }

    fn refresh_shared_counts(&self) {
        if let Some(sender) = self
            .command_sender
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
        {
            let _ = sender.send(ConnectionCommand::RefreshSharedCounts);
        }
    }

    fn peer_services(
        &self,
        own_username: &str,
        command_sender: &mpsc::UnboundedSender<ConnectionCommand>,
    ) -> PeerServices {
        PeerServices {
            bandwidth: self.bandwidth.clone(),
            search: self.search.clone(),
            wanted: self.wanted.clone(),
            radar: self.radar.clone(),
            folders: self.folders.clone(),
            shares: self.shares.clone(),
            people: self.people.clone(),
            transfers: self.transfers.clone(),
            local_shares: self.local_shares.clone(),
            uploads: self.uploads.clone(),
            distributed: self.distributed.clone(),
            own_username: own_username.to_owned(),
            command_sender: command_sender.clone(),
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

    pub fn start_search(
        &self,
        client_id: String,
        query: String,
        album: Option<AlbumIdentity>,
    ) -> Result<SearchSnapshot, ConnectionServiceError> {
        let query = query.trim().to_owned();
        let client_id = client_id.trim().to_owned();
        let album = album.or_else(|| {
            client_id
                .starts_with(super::search::RELAY_CLIENT_PREFIX)
                .then(|| AlbumIdentity {
                    artist: String::new(),
                    title: query.clone(),
                })
        });
        if query.is_empty() {
            return Err(ConnectionServiceError::InvalidSearch(
                "Enter something to search for.".to_owned(),
            ));
        }
        if album.is_none() && query.len() > MAX_SEARCH_QUERY_BYTES {
            return Err(ConnectionServiceError::InvalidSearch(format!(
                "Search queries can be at most {MAX_SEARCH_QUERY_BYTES} bytes."
            )));
        }
        if !valid_client_id(&client_id) {
            return Err(ConnectionServiceError::InvalidSearch(
                "The search session identifier is invalid.".to_owned(),
            ));
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

        let snapshot = self
            .search
            .start(token, client_id.clone(), query.clone(), album)
            .map_err(ConnectionServiceError::InvalidSearch)?;
        if sender.send(ConnectionCommand::SearchesChanged).is_err() {
            self.search.fail(
                &client_id,
                "The Soulseek connection changed before the search could start.",
            );
            return Err(ConnectionServiceError::SearchUnavailable);
        }
        self.diagnostics.record(
            "info",
            "search_started",
            "A live Soulseek search was started.",
        );
        Ok(snapshot)
    }

    pub fn stop_search(&self, client_id: &str) -> Option<SearchSnapshot> {
        let snapshot = self.search.stop(client_id);
        if snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.state == SearchState::Stopped)
        {
            self.diagnostics
                .record("info", "search_stopped", "The live search was stopped.");
        }
        snapshot
    }

    pub fn stop_all_searches(&self) -> Vec<SearchSnapshot> {
        let snapshots = self.search.stop_all();
        if !snapshots.is_empty() {
            self.diagnostics.record(
                "info",
                "searches_stopped",
                "All live searches were stopped.",
            );
        }
        snapshots
    }

    pub fn close_search(&self, client_id: &str) -> bool {
        self.search.close(client_id)
    }

    pub fn current_snapshot(&self) -> ConnectionSnapshot {
        self.snapshot
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
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
        if let Some(active) = self
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            active.handle.abort();
        }
        self.hubs().disconnected(hubs::DisconnectReason::Requested);
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
    #[error("{0}")]
    Shares(#[from] SharesError),
    #[error("{0}")]
    LocalShares(#[from] LocalSharesError),
    #[error("{0}")]
    Upload(#[from] UploadError),
    #[error("{0}")]
    People(#[from] PeopleError),
    #[error("{0}")]
    Messages(#[from] MessagesError),
    #[error("{0}")]
    Rooms(#[from] RoomsError),
    #[error("{0}")]
    Wanted(#[from] WantedError),
    #[error("{0}")]
    Radar(#[from] RadarError),
    #[error("Add your Soulseek account before connecting.")]
    NotConfigured,
    #[error("Enter your Soulseek password.")]
    MissingPassword,
    #[error("Connect to Soulseek before starting a live search.")]
    SearchUnavailable,
    #[error("Connect to Soulseek before checking a wanted album.")]
    WantedUnavailable,
    #[error("Connect to Soulseek before scanning the Missing Shelf.")]
    RadarUnavailable,
    #[error("Connect to Soulseek before browsing a source folder.")]
    FolderUnavailable,
    #[error("Choose a valid Soulseek source folder.")]
    InvalidFolderRequest,
    #[error("The source did not answer the folder request in time.")]
    FolderTimeout,
    #[error("Connect to Soulseek before browsing a user's shares.")]
    SharesUnavailable,
    #[error("Choose a valid Soulseek username and share search.")]
    InvalidSharesRequest,
    #[error("The user did not answer the share-list request in time.")]
    SharesTimeout,
    #[error("Connect to Soulseek before opening a live user profile.")]
    PeopleUnavailable,
    #[error("Choose a valid Soulseek username.")]
    InvalidPerson,
    #[error("The user did not answer the profile request in time.")]
    ProfileTimeout,
    #[error("Connect to Soulseek before sending private messages.")]
    MessagesUnavailable,
    #[error("Connect to Soulseek before using public rooms.")]
    RoomsUnavailable,
    #[error("{0}")]
    InvalidSearch(String),
    #[error("Could not initialize connection diagnostics: {0}")]
    Diagnostics(#[from] std::io::Error),
}
