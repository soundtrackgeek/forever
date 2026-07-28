use super::soundcheck::{inspect_file, SoundcheckResult, SoundcheckStatus};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const TRANSFER_EVENT: &str = "forever://transfers";
const STORE_VERSION: u32 = 1;
const MAX_AUTOMATIC_RETRIES: u32 = 3;
const DEFAULT_MAX_CONCURRENT_DOWNLOADS: u8 = 3;
const MAX_CONCURRENT_DOWNLOADS: u8 = 6;
const DEFAULT_RELAY_SUGGESTION_MINUTES: u32 = 10;
const RELAY_SUGGESTION_MINUTES: [u32; 6] = [0, 5, 10, 20, 30, 60];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferSafetyState {
    #[default]
    Running,
    Draining,
    PausedForRestart,
}

impl TransferSafetyState {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Draining,
            2 => Self::PausedForRestart,
            _ => Self::Running,
        }
    }

    fn as_u8(self) -> u8 {
        match self {
            Self::Running => 0,
            Self::Draining => 1,
            Self::PausedForRestart => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransferPreparationMode {
    PauseNow,
    FinishCurrentFiles,
}

fn default_max_concurrent_downloads() -> u8 {
    DEFAULT_MAX_CONCURRENT_DOWNLOADS
}

fn default_relay_suggestion_minutes() -> u32 {
    DEFAULT_RELAY_SUGGESTION_MINUTES
}

fn default_soundcheck_enabled() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Queued,
    Retrying,
    Requesting,
    RemotelyQueued,
    Connecting,
    Downloading,
    Paused,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VerificationStatus {
    #[default]
    Pending,
    Verified,
    Missing,
    SizeMismatch,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAlternativeFile {
    pub title: String,
    pub remote_filename: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAlternativeSource {
    pub username: String,
    pub remote_folder: String,
    pub files: Vec<ReleaseAlternativeFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRepairSnapshot {
    pub reason: String,
    pub original_username: Option<String>,
    pub original_remote_filename: Option<String>,
    pub requested_at_ms: u64,
    #[serde(default)]
    pub repaired_at_ms: Option<u64>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchReleaseFileRequest {
    pub release_id: String,
    #[serde(default)]
    pub target_transfer_id: Option<String>,
    #[serde(default)]
    pub target_track_number: Option<u32>,
    pub title: String,
    pub username: String,
    pub remote_filename: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub allow_incompatible: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl TransferStatus {
    fn occupies_slot(self) -> bool {
        matches!(
            self,
            Self::Requesting | Self::RemotelyQueued | Self::Connecting | Self::Downloading
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSnapshot {
    pub id: String,
    #[serde(default)]
    pub release_id: Option<String>,
    #[serde(default)]
    pub release_title: Option<String>,
    #[serde(default)]
    pub release_folder: Option<String>,
    #[serde(default)]
    pub file_index: Option<u32>,
    #[serde(default)]
    pub file_count: Option<u32>,
    #[serde(default)]
    pub expected_track_count: Option<u32>,
    #[serde(default)]
    pub release_group_id: Option<String>,
    pub title: String,
    pub username: String,
    pub remote_filename: String,
    pub size_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub status: TransferStatus,
    pub queue_position: Option<u32>,
    pub local_path: String,
    pub error: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub retry_at_ms: Option<u64>,
    #[serde(default)]
    pub waiting_since_ms: Option<u64>,
    #[serde(default)]
    pub verification_status: VerificationStatus,
    #[serde(default)]
    pub verification_message: Option<String>,
    #[serde(default)]
    pub verified_at_ms: Option<u64>,
    #[serde(default)]
    pub filed_at_ms: Option<u64>,
    #[serde(default)]
    pub soundcheck: Option<SoundcheckResult>,
    #[serde(default)]
    pub patch_repair: Option<PatchRepairSnapshot>,
    #[serde(default)]
    pub alternative_sources: Vec<ReleaseAlternativeSource>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(skip)]
    connection_token: Option<u32>,
    #[serde(skip)]
    transfer_token: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferQueueSnapshot {
    pub transfers: Vec<TransferSnapshot>,
    pub active_count: usize,
    pub max_concurrent_downloads: u8,
    pub relay_suggestion_minutes: u32,
    pub soundcheck_enabled: bool,
    pub safety_state: TransferSafetyState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTransferRequest {
    pub title: String,
    pub username: String,
    pub remote_filename: String,
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueReleaseFileRequest {
    pub title: String,
    pub remote_filename: String,
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueReleaseRequest {
    pub title: String,
    pub username: String,
    pub remote_folder: String,
    pub files: Vec<EnqueueReleaseFileRequest>,
    #[serde(default)]
    pub expected_track_count: Option<u32>,
    #[serde(default)]
    pub release_group_id: Option<String>,
    #[serde(default)]
    pub alternatives: Vec<ReleaseAlternativeSource>,
}

#[derive(Clone, Debug)]
pub struct TransferTicket {
    pub id: String,
    pub username: String,
    pub remote_filename: String,
    pub connection_token: u32,
}

#[derive(Clone, Debug)]
pub struct DownloadPlan {
    pub id: String,
    pub partial_path: PathBuf,
    pub final_path: PathBuf,
    pub size_bytes: u64,
    pub offset: u64,
}

#[derive(Serialize, Deserialize)]
struct TransferStore {
    version: u32,
    #[serde(default = "default_max_concurrent_downloads")]
    max_concurrent_downloads: u8,
    #[serde(default = "default_relay_suggestion_minutes")]
    relay_suggestion_minutes: u32,
    #[serde(default = "default_soundcheck_enabled")]
    soundcheck_enabled: bool,
    transfers: Vec<TransferSnapshot>,
}

#[derive(Clone)]
pub struct TransferHub {
    app: AppHandle,
    path: PathBuf,
    transfers: Arc<RwLock<Vec<TransferSnapshot>>>,
    max_concurrent_downloads: Arc<AtomicU8>,
    relay_suggestion_minutes: Arc<AtomicU32>,
    soundcheck_enabled: Arc<AtomicBool>,
    safety_state: Arc<AtomicU8>,
    tasks: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    next_id: Arc<AtomicU64>,
}

impl TransferHub {
    pub fn new(app: AppHandle, path: PathBuf) -> Result<Self, TransferError> {
        let store = load_store(&path)?;
        let mut transfers = store.transfers;
        for transfer in &mut transfers {
            reconcile_transfer_after_restart(transfer);
            if store.soundcheck_enabled
                && transfer.status == TransferStatus::Completed
                && transfer.verification_status == VerificationStatus::Verified
                && transfer.soundcheck.is_none()
            {
                refresh_soundcheck(transfer, false);
            }
        }

        let hub = Self {
            app,
            path,
            transfers: Arc::new(RwLock::new(transfers)),
            max_concurrent_downloads: Arc::new(AtomicU8::new(store.max_concurrent_downloads)),
            relay_suggestion_minutes: Arc::new(AtomicU32::new(store.relay_suggestion_minutes)),
            soundcheck_enabled: Arc::new(AtomicBool::new(store.soundcheck_enabled)),
            safety_state: Arc::new(AtomicU8::new(TransferSafetyState::Running.as_u8())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(timestamp_ms())),
        };
        hub.persist()?;
        Ok(hub)
    }

    pub fn snapshot(&self) -> TransferQueueSnapshot {
        let transfers = self
            .transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let active_count = transfers
            .iter()
            .filter(|transfer| transfer.status.occupies_slot())
            .count();
        TransferQueueSnapshot {
            transfers,
            active_count,
            max_concurrent_downloads: self.max_concurrent_downloads.load(Ordering::SeqCst),
            relay_suggestion_minutes: self.relay_suggestion_minutes.load(Ordering::SeqCst),
            soundcheck_enabled: self.soundcheck_enabled.load(Ordering::SeqCst),
            safety_state: self.safety_state(),
        }
    }

    pub fn safety_state(&self) -> TransferSafetyState {
        TransferSafetyState::from_u8(self.safety_state.load(Ordering::SeqCst))
    }

    pub fn begin_restart_preparation(
        &self,
        mode: TransferPreparationMode,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        let next_state = match mode {
            TransferPreparationMode::PauseNow => TransferSafetyState::PausedForRestart,
            TransferPreparationMode::FinishCurrentFiles => TransferSafetyState::Draining,
        };
        self.safety_state
            .store(next_state.as_u8(), Ordering::SeqCst);

        let ids_to_abort = {
            let transfers = self
                .transfers
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            transfers
                .iter()
                .filter(|transfer| {
                    transfer.status != TransferStatus::Completed
                        && (mode == TransferPreparationMode::PauseNow
                            || transfer.status != TransferStatus::Downloading)
                })
                .map(|transfer| transfer.id.clone())
                .collect::<Vec<_>>()
        };
        for id in ids_to_abort {
            self.abort(&id);
        }

        self.mutate(|transfers| {
            prepare_transfers_for_restart(transfers, mode);
        })?;
        Ok(self.snapshot())
    }

    pub fn finish_restart_preparation(&self) -> Result<TransferQueueSnapshot, TransferError> {
        self.safety_state.store(
            TransferSafetyState::PausedForRestart.as_u8(),
            Ordering::SeqCst,
        );
        self.mutate(|transfers| {
            for transfer in transfers {
                if transfer.status != TransferStatus::Completed {
                    let was_active = transfer.status.occupies_slot();
                    refresh_partial_size(transfer);
                    if was_active {
                        transfer.status = TransferStatus::Queued;
                        reset_runtime_state(transfer);
                        transfer.error = None;
                        transfer.retry_at_ms = None;
                    }
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        })?;
        Ok(self.snapshot())
    }

    pub fn cancel_restart_preparation(&self) -> Result<TransferQueueSnapshot, TransferError> {
        self.safety_state
            .store(TransferSafetyState::Running.as_u8(), Ordering::SeqCst);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn active_task_count(&self) -> usize {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    pub fn set_max_concurrent_downloads(
        &self,
        max_concurrent_downloads: u8,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        if !(1..=MAX_CONCURRENT_DOWNLOADS).contains(&max_concurrent_downloads) {
            return Err(TransferError::InvalidConcurrentDownloads);
        }
        self.max_concurrent_downloads
            .store(max_concurrent_downloads, Ordering::SeqCst);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn set_relay_suggestion_minutes(
        &self,
        relay_suggestion_minutes: u32,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        if !RELAY_SUGGESTION_MINUTES.contains(&relay_suggestion_minutes) {
            return Err(TransferError::InvalidRelaySuggestionMinutes);
        }
        self.relay_suggestion_minutes
            .store(relay_suggestion_minutes, Ordering::SeqCst);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn set_soundcheck_enabled(
        &self,
        enabled: bool,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        self.soundcheck_enabled.store(enabled, Ordering::SeqCst);
        if enabled {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for transfer in transfers.iter_mut().filter(|transfer| {
                transfer.status == TransferStatus::Completed
                    && transfer.verification_status == VerificationStatus::Verified
                    && transfer.soundcheck.is_none()
            }) {
                refresh_soundcheck(transfer, false);
            }
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn enqueue(
        &self,
        request: EnqueueTransferRequest,
        download_directory: &Path,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        validate_request(&request)?;
        fs::create_dir_all(download_directory)?;
        let local_path = unique_target_path(
            download_directory,
            &request.remote_filename,
            &self
                .transfers
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        let now = timestamp_ms();
        let id_number = self.next_id.fetch_add(1, Ordering::SeqCst);
        let transfer = TransferSnapshot {
            id: format!("download-{now}-{id_number}"),
            release_id: None,
            release_title: None,
            release_folder: None,
            file_index: None,
            file_count: None,
            expected_track_count: None,
            release_group_id: None,
            title: request.title.trim().to_owned(),
            username: request.username,
            remote_filename: normalize_remote_filename(&request.remote_filename),
            size_bytes: request.size_bytes,
            transferred_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            status: TransferStatus::Queued,
            queue_position: None,
            local_path: local_path.to_string_lossy().into_owned(),
            error: None,
            retry_count: 0,
            retry_at_ms: None,
            waiting_since_ms: None,
            verification_status: VerificationStatus::Pending,
            verification_message: None,
            verified_at_ms: None,
            filed_at_ms: None,
            soundcheck: None,
            patch_repair: None,
            alternative_sources: Vec::new(),
            created_at_ms: now,
            updated_at_ms: now,
            connection_token: None,
            transfer_token: None,
        };
        self.mutate(|transfers| transfers.push(transfer))?;
        Ok(self.snapshot())
    }

    pub fn enqueue_release(
        &self,
        request: EnqueueReleaseRequest,
        download_directory: &Path,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        validate_release_request(&request)?;
        let mut transfers = self
            .transfers
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if unfinished_release_uses_source(&transfers, &request) {
            return Err(TransferError::DuplicateReleaseSource);
        }
        let existing = transfers.clone();
        fs::create_dir_all(download_directory)?;

        let now = timestamp_ms();
        let id_number = self.next_id.fetch_add(1, Ordering::SeqCst);
        let release_id = format!("release-{now}-{id_number}");
        let release_title = request.title.trim().to_owned();
        let release_directory =
            unique_release_directory(download_directory, &release_title, &existing);
        fs::create_dir_all(&release_directory)?;

        let file_count = u32::try_from(request.files.len()).unwrap_or(u32::MAX);
        let alternatives = request.alternatives.clone();
        let mut release_transfers = Vec::with_capacity(request.files.len());
        for (index, file) in request.files.into_iter().enumerate() {
            let local_path = unique_target_path(
                &release_directory,
                &file.remote_filename,
                &existing
                    .iter()
                    .chain(release_transfers.iter())
                    .cloned()
                    .collect::<Vec<_>>(),
            );
            let file_id = self.next_id.fetch_add(1, Ordering::SeqCst);
            release_transfers.push(TransferSnapshot {
                id: format!("download-{now}-{file_id}"),
                release_id: Some(release_id.clone()),
                release_title: Some(release_title.clone()),
                release_folder: Some(release_directory.to_string_lossy().into_owned()),
                file_index: Some(u32::try_from(index + 1).unwrap_or(u32::MAX)),
                file_count: Some(file_count),
                expected_track_count: request.expected_track_count,
                release_group_id: request.release_group_id.clone(),
                title: file.title.trim().to_owned(),
                username: request.username.clone(),
                remote_filename: normalize_remote_filename(&file.remote_filename),
                size_bytes: file.size_bytes,
                transferred_bytes: 0,
                speed_bytes_per_second: 0,
                eta_seconds: None,
                status: TransferStatus::Queued,
                queue_position: None,
                local_path: local_path.to_string_lossy().into_owned(),
                error: None,
                retry_count: 0,
                retry_at_ms: None,
                waiting_since_ms: None,
                verification_status: VerificationStatus::Pending,
                verification_message: None,
                verified_at_ms: None,
                filed_at_ms: None,
                soundcheck: None,
                patch_repair: None,
                alternative_sources: alternatives.clone(),
                created_at_ms: now.saturating_add(index as u64),
                updated_at_ms: now,
                connection_token: None,
                transfer_token: None,
            });
        }
        transfers.extend(release_transfers);
        drop(transfers);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn pause(&self, id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        self.abort(id);
        let mut found = false;
        self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| transfer.id == id) {
                found = true;
                if transfer.status != TransferStatus::Completed {
                    transfer.status = TransferStatus::Paused;
                    transfer.speed_bytes_per_second = 0;
                    transfer.eta_seconds = None;
                    transfer.waiting_since_ms = None;
                    transfer.connection_token = None;
                    transfer.transfer_token = None;
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        })?;
        if !found {
            return Err(TransferError::NotFound);
        }
        Ok(self.snapshot())
    }

    pub fn resume(&self, id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        let mut found = false;
        self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| transfer.id == id) {
                found = true;
                if matches!(
                    transfer.status,
                    TransferStatus::Paused | TransferStatus::Failed | TransferStatus::Retrying
                ) {
                    refresh_partial_size(transfer);
                    transfer.status = TransferStatus::Queued;
                    transfer.speed_bytes_per_second = 0;
                    transfer.eta_seconds = None;
                    transfer.queue_position = None;
                    transfer.error = None;
                    transfer.retry_count = 0;
                    transfer.retry_at_ms = None;
                    transfer.waiting_since_ms = None;
                    transfer.verification_status = VerificationStatus::Pending;
                    transfer.verification_message = None;
                    transfer.verified_at_ms = None;
                    transfer.soundcheck = None;
                    transfer.connection_token = None;
                    transfer.transfer_token = None;
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        })?;
        if !found {
            return Err(TransferError::NotFound);
        }
        Ok(self.snapshot())
    }

    pub fn cancel(&self, id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        self.abort(id);
        let removed = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let index = transfers
                .iter()
                .position(|transfer| transfer.id == id)
                .ok_or(TransferError::NotFound)?;
            transfers.remove(index)
        };
        if removed.status != TransferStatus::Completed {
            schedule_partial_cleanup(partial_path(Path::new(&removed.local_path)));
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn pause_release(&self, release_id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        self.mutate_release(release_id, |transfer| {
            if transfer.status != TransferStatus::Completed {
                transfer.status = TransferStatus::Paused;
                reset_runtime_state(transfer);
            }
        })
    }

    pub fn resume_release(&self, release_id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        self.mutate_release(release_id, |transfer| {
            if matches!(
                transfer.status,
                TransferStatus::Paused | TransferStatus::Failed | TransferStatus::Retrying
            ) {
                refresh_partial_size(transfer);
                transfer.status = TransferStatus::Queued;
                transfer.error = None;
                transfer.retry_count = 0;
                transfer.retry_at_ms = None;
                transfer.verification_status = VerificationStatus::Pending;
                transfer.verification_message = None;
                transfer.verified_at_ms = None;
                transfer.soundcheck = None;
                reset_runtime_state(transfer);
            }
        })
    }

    pub fn cancel_release(&self, release_id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        let ids: Vec<String> = self
            .transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            .map(|transfer| transfer.id.clone())
            .collect();
        if ids.is_empty() {
            return Err(TransferError::ReleaseNotFound);
        }
        for id in &ids {
            self.abort(id);
        }
        let removed = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut removed = Vec::new();
            transfers.retain(|transfer| {
                if transfer.release_id.as_deref() == Some(release_id) {
                    removed.push(transfer.clone());
                    false
                } else {
                    true
                }
            });
            removed
        };
        for transfer in removed {
            if transfer.status != TransferStatus::Completed {
                schedule_partial_cleanup(partial_path(Path::new(&transfer.local_path)));
            }
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn reorder_release(
        &self,
        release_id: &str,
        before_transfer_id: Option<&str>,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            reorder_queued_release(&mut transfers, release_id, before_transfer_id)?;
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn verify_release(&self, release_id: &str) -> Result<TransferQueueSnapshot, TransferError> {
        let mut found = false;
        self.mutate(|transfers| {
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            {
                found = true;
                if transfer.status == TransferStatus::Completed {
                    refresh_verification(transfer);
                }
            }
        })?;
        if !found {
            return Err(TransferError::ReleaseNotFound);
        }
        Ok(self.snapshot())
    }

    pub fn verify_completed(&self) -> Result<TransferQueueSnapshot, TransferError> {
        self.mutate(|transfers| {
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.status == TransferStatus::Completed)
            {
                refresh_verification(transfer);
            }
        })?;
        Ok(self.snapshot())
    }

    pub fn soundcheck_release(
        &self,
        release_id: &str,
        deep: bool,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        let mut found = false;
        let mut completed = true;
        self.mutate(|transfers| {
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            {
                found = true;
                if transfer.status != TransferStatus::Completed {
                    completed = false;
                    continue;
                }
                refresh_verification(transfer);
                if transfer.verification_status == VerificationStatus::Verified {
                    refresh_soundcheck(transfer, deep);
                }
            }
        })?;
        if !found {
            return Err(TransferError::ReleaseNotFound);
        }
        if !completed {
            return Err(TransferError::ReleaseNotCompleted);
        }
        Ok(self.snapshot())
    }

    pub fn retry_release_issues(
        &self,
        release_id: &str,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        let mut found = false;
        let mut recoverable = false;
        self.mutate(|transfers| {
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            {
                found = true;
                if transfer.status == TransferStatus::Completed {
                    refresh_verification(transfer);
                }
                let missing = transfer.status == TransferStatus::Completed
                    && transfer.verification_status == VerificationStatus::Missing;
                if missing || transfer.status == TransferStatus::Failed {
                    recoverable = true;
                    if missing {
                        transfer.transferred_bytes = 0;
                    } else {
                        refresh_partial_size(transfer);
                    }
                    transfer.status = TransferStatus::Queued;
                    transfer.speed_bytes_per_second = 0;
                    transfer.eta_seconds = None;
                    transfer.queue_position = None;
                    transfer.error = None;
                    transfer.retry_count = 0;
                    transfer.retry_at_ms = None;
                    transfer.waiting_since_ms = None;
                    transfer.verification_status = VerificationStatus::Pending;
                    transfer.verification_message = None;
                    transfer.verified_at_ms = None;
                    transfer.soundcheck = None;
                    transfer.connection_token = None;
                    transfer.transfer_token = None;
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        })?;
        if !found {
            return Err(TransferError::ReleaseNotFound);
        }
        if !recoverable {
            return Err(TransferError::NoRecoverableIssues);
        }
        Ok(self.snapshot())
    }

    pub fn switch_release_source(
        &self,
        release_id: &str,
        username: &str,
        remote_folder: &str,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        let active_ids = self
            .transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|transfer| {
                transfer.release_id.as_deref() == Some(release_id)
                    && transfer.status.occupies_slot()
            })
            .map(|transfer| transfer.id.clone())
            .collect::<Vec<_>>();
        for id in active_ids {
            self.abort(&id);
        }
        let mut transfers = self
            .transfers
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let release_indices = transfers
            .iter()
            .enumerate()
            .filter_map(|(index, transfer)| {
                (transfer.release_id.as_deref() == Some(release_id)).then_some(index)
            })
            .collect::<Vec<_>>();
        if release_indices.is_empty() {
            return Err(TransferError::ReleaseNotFound);
        }
        let requested_folder = normalize_remote_folder(remote_folder);
        let alternative = release_indices
            .iter()
            .flat_map(|index| transfers[*index].alternative_sources.iter())
            .find(|source| {
                source.username.eq_ignore_ascii_case(username)
                    && normalize_remote_folder(&source.remote_folder)
                        .eq_ignore_ascii_case(&requested_folder)
            })
            .cloned()
            .ok_or(TransferError::AlternativeSourceNotFound)?;

        let first = &transfers[release_indices[0]];
        let previous = ReleaseAlternativeSource {
            username: first.username.clone(),
            remote_folder: remote_parent(&first.remote_filename),
            files: release_indices
                .iter()
                .map(|index| {
                    let transfer = &transfers[*index];
                    ReleaseAlternativeFile {
                        title: transfer.title.clone(),
                        remote_filename: transfer.remote_filename.clone(),
                        size_bytes: transfer.size_bytes,
                    }
                })
                .collect(),
        };
        let mut switched = 0;
        for index in &release_indices {
            let transfer = &mut transfers[*index];
            let mut failed_soundcheck = false;
            if transfer.status == TransferStatus::Completed {
                refresh_verification(transfer);
                failed_soundcheck = transfer
                    .soundcheck
                    .as_ref()
                    .is_some_and(|result| result.status == SoundcheckStatus::Failed);
                if transfer.verification_status != VerificationStatus::Missing && !failed_soundcheck
                {
                    continue;
                }
            }
            let Some((file, exact_mirror)) = matching_alternative_file(transfer, &alternative)
            else {
                continue;
            };
            if failed_soundcheck {
                preserve_rejected_file(Path::new(&transfer.local_path))?;
            }
            if !exact_mirror {
                let partial = partial_path(Path::new(&transfer.local_path));
                if partial.exists() {
                    fs::remove_file(partial)?;
                }
            }
            transfer.username = alternative.username.clone();
            transfer.remote_filename = normalize_remote_filename(&file.remote_filename);
            transfer.title = file.title.clone();
            transfer.size_bytes = file.size_bytes;
            transfer.status = TransferStatus::Queued;
            transfer.transferred_bytes =
                if exact_mirror && partial_path(Path::new(&transfer.local_path)).exists() {
                    fs::metadata(partial_path(Path::new(&transfer.local_path)))
                        .map(|metadata| metadata.len().min(transfer.size_bytes))
                        .unwrap_or(0)
                } else {
                    0
                };
            reset_runtime_state(transfer);
            transfer.error = None;
            transfer.retry_count = 0;
            transfer.retry_at_ms = None;
            transfer.waiting_since_ms = None;
            transfer.verification_status = VerificationStatus::Pending;
            transfer.verification_message = None;
            transfer.verified_at_ms = None;
            transfer.soundcheck = None;
            transfer.updated_at_ms = timestamp_ms();
            switched += 1;
        }
        if switched == 0 {
            return Err(TransferError::AlternativeSourceMismatch);
        }
        for index in release_indices {
            let transfer = &mut transfers[index];
            transfer.alternative_sources.retain(|source| {
                !(source.username.eq_ignore_ascii_case(&alternative.username)
                    && normalize_remote_folder(&source.remote_folder)
                        .eq_ignore_ascii_case(&requested_folder))
            });
            if !transfer.alternative_sources.iter().any(|source| {
                source.username.eq_ignore_ascii_case(&previous.username)
                    && normalize_remote_folder(&source.remote_folder)
                        .eq_ignore_ascii_case(&previous.remote_folder)
            }) {
                transfer.alternative_sources.push(previous.clone());
            }
        }
        drop(transfers);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn relay_release_source(
        &self,
        release_id: &str,
        source: ReleaseAlternativeSource,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        validate_alternative_source(&source)?;
        {
            let transfers = self
                .transfers
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let release = transfers
                .iter()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
                .collect::<Vec<_>>();
            if release.is_empty() {
                return Err(TransferError::ReleaseNotFound);
            }
            let compatible = release.iter().any(|transfer| {
                (transfer.status != TransferStatus::Completed
                    || transfer.verification_status == VerificationStatus::Missing
                    || transfer
                        .soundcheck
                        .as_ref()
                        .is_some_and(|result| result.status == SoundcheckStatus::Failed))
                    && matching_alternative_file(transfer, &source).is_some()
            });
            if !compatible {
                return Err(TransferError::AlternativeSourceMismatch);
            }
        }
        let username = source.username.clone();
        let remote_folder = source.remote_folder.clone();
        {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut found = false;
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            {
                found = true;
                transfer.alternative_sources.retain(|candidate| {
                    !(candidate.username.eq_ignore_ascii_case(&username)
                        && normalize_remote_folder(&candidate.remote_folder)
                            .eq_ignore_ascii_case(&normalize_remote_folder(&remote_folder)))
                });
                transfer.alternative_sources.push(source.clone());
            }
            if !found {
                return Err(TransferError::ReleaseNotFound);
            }
        }
        self.switch_release_source(release_id, &username, &remote_folder)
    }

    pub fn patch_release_file(
        &self,
        request: PatchReleaseFileRequest,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        validate_patch_request(&request)?;

        let mut transfers = self
            .transfers
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let release_indices = transfers
            .iter()
            .enumerate()
            .filter_map(|(index, transfer)| {
                (transfer.release_id.as_deref() == Some(request.release_id.as_str()))
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        if release_indices.is_empty() {
            return Err(TransferError::ReleaseNotFound);
        }
        if release_indices.iter().any(|index| {
            let transfer = &transfers[*index];
            request.target_transfer_id.as_deref() != Some(transfer.id.as_str())
                && transfer.username.eq_ignore_ascii_case(&request.username)
                && transfer
                    .remote_filename
                    .eq_ignore_ascii_case(&normalize_remote_filename(&request.remote_filename))
        }) {
            return Err(TransferError::PatchCandidateAlreadyQueued);
        }

        let now = timestamp_ms();
        let normalized_remote = normalize_remote_filename(&request.remote_filename);
        let candidate_extension =
            audio_extension(&normalized_remote).ok_or(TransferError::InvalidPatchCandidate)?;
        let warnings = normalized_patch_warnings(&request.warnings);

        if let Some(target_id) = request.target_transfer_id.as_deref() {
            let target_index = release_indices
                .iter()
                .copied()
                .find(|index| transfers[*index].id == target_id)
                .ok_or(TransferError::NotFound)?;
            let reason =
                patch_issue_reason(&transfers[target_index]).ok_or(TransferError::NoPatchIssue)?;
            let current_extension = audio_extension(&transfers[target_index].remote_filename)
                .ok_or(TransferError::InvalidPatchTarget)?;
            if !current_extension.eq_ignore_ascii_case(candidate_extension)
                && !request.allow_incompatible
            {
                return Err(TransferError::IncompatiblePatchCandidate);
            }

            let replacement_path = if current_extension.eq_ignore_ascii_case(candidate_extension) {
                PathBuf::from(&transfers[target_index].local_path)
            } else {
                let directory = Path::new(&transfers[target_index].local_path)
                    .parent()
                    .map(Path::to_path_buf)
                    .or_else(|| {
                        transfers[target_index]
                            .release_folder
                            .as_deref()
                            .map(PathBuf::from)
                    })
                    .ok_or(TransferError::InvalidPatchTarget)?;
                unique_target_path(&directory, &normalized_remote, &transfers)
            };
            preserve_rejected_file(Path::new(&transfers[target_index].local_path))?;
            let old_partial = partial_path(Path::new(&transfers[target_index].local_path));
            if old_partial.exists() {
                fs::remove_file(old_partial)?;
            }

            for index in &release_indices {
                transfers[*index].filed_at_ms = None;
            }

            let transfer = &mut transfers[target_index];
            let original_username = transfer.username.clone();
            let original_remote_filename = transfer.remote_filename.clone();
            transfer.username = request.username.trim().to_owned();
            transfer.remote_filename = normalized_remote;
            transfer.title = request.title.trim().to_owned();
            transfer.size_bytes = request.size_bytes;
            transfer.transferred_bytes = 0;
            transfer.status = TransferStatus::Queued;
            transfer.local_path = replacement_path.to_string_lossy().into_owned();
            transfer.error = None;
            transfer.retry_count = 0;
            transfer.retry_at_ms = None;
            transfer.verification_status = VerificationStatus::Pending;
            transfer.verification_message = None;
            transfer.verified_at_ms = None;
            transfer.filed_at_ms = None;
            transfer.soundcheck = None;
            transfer.patch_repair = Some(PatchRepairSnapshot {
                reason,
                original_username: Some(original_username),
                original_remote_filename: Some(original_remote_filename),
                requested_at_ms: now,
                repaired_at_ms: None,
                warnings,
            });
            reset_runtime_state(transfer);
            transfer.updated_at_ms = now;
        } else {
            let track_number = request
                .target_track_number
                .filter(|number| (1..=300).contains(number))
                .ok_or(TransferError::InvalidPatchTarget)?;
            let mut format_counts = HashMap::<String, usize>::new();
            for index in &release_indices {
                if let Some(extension) = audio_extension(&transfers[*index].remote_filename) {
                    *format_counts
                        .entry(extension.to_ascii_lowercase())
                        .or_default() += 1;
                }
            }
            if format_counts
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .is_some_and(|(format, _)| {
                    !format.eq_ignore_ascii_case(candidate_extension) && !request.allow_incompatible
                })
            {
                return Err(TransferError::IncompatiblePatchCandidate);
            }
            if release_indices.iter().any(|index| {
                let transfer = &transfers[*index];
                audio_extension(&transfer.remote_filename).is_some()
                    && transfer_track_number(transfer) == Some(track_number)
            }) {
                return Err(TransferError::NoPatchIssue);
            }
            let first = transfers[release_indices[0]].clone();
            if first
                .expected_track_count
                .is_some_and(|expected| track_number > expected)
            {
                return Err(TransferError::InvalidPatchTarget);
            }
            let release_directory = first
                .release_folder
                .as_deref()
                .map(PathBuf::from)
                .or_else(|| Path::new(&first.local_path).parent().map(Path::to_path_buf))
                .ok_or(TransferError::InvalidPatchTarget)?;
            fs::create_dir_all(&release_directory)?;
            let local_path = unique_target_path(&release_directory, &normalized_remote, &transfers);
            let file_count =
                u32::try_from(release_indices.len().saturating_add(1)).unwrap_or(u32::MAX);
            for index in &release_indices {
                transfers[*index].file_count = Some(file_count);
                transfers[*index].filed_at_ms = None;
            }
            let file_id = self.next_id.fetch_add(1, Ordering::SeqCst);
            transfers.push(TransferSnapshot {
                id: format!("download-{now}-{file_id}"),
                release_id: Some(request.release_id),
                release_title: first.release_title,
                release_folder: Some(release_directory.to_string_lossy().into_owned()),
                file_index: Some(track_number),
                file_count: Some(file_count),
                expected_track_count: first.expected_track_count,
                release_group_id: first.release_group_id,
                title: request.title.trim().to_owned(),
                username: request.username.trim().to_owned(),
                remote_filename: normalized_remote,
                size_bytes: request.size_bytes,
                transferred_bytes: 0,
                speed_bytes_per_second: 0,
                eta_seconds: None,
                status: TransferStatus::Queued,
                queue_position: None,
                local_path: local_path.to_string_lossy().into_owned(),
                error: None,
                retry_count: 0,
                retry_at_ms: None,
                waiting_since_ms: None,
                verification_status: VerificationStatus::Pending,
                verification_message: None,
                verified_at_ms: None,
                filed_at_ms: None,
                soundcheck: None,
                patch_repair: Some(PatchRepairSnapshot {
                    reason: format!("Track {track_number} was missing from the completed release."),
                    original_username: None,
                    original_remote_filename: None,
                    requested_at_ms: now,
                    repaired_at_ms: None,
                    warnings,
                }),
                alternative_sources: first.alternative_sources,
                created_at_ms: now,
                updated_at_ms: now,
                connection_token: None,
                transfer_token: None,
            });
        }

        drop(transfers);
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn clear_completed(&self) -> Result<TransferQueueSnapshot, TransferError> {
        self.mutate(|transfers| {
            let completed_release_ids: Vec<String> = transfers
                .iter()
                .filter_map(|transfer| transfer.release_id.clone())
                .filter(|release_id| {
                    transfers
                        .iter()
                        .filter(|transfer| {
                            transfer.release_id.as_deref() == Some(release_id.as_str())
                        })
                        .all(|transfer| transfer.status == TransferStatus::Completed)
                })
                .collect();
            transfers.retain(|transfer| {
                if transfer.release_id.is_none() {
                    return transfer.status != TransferStatus::Completed;
                }
                !transfer.release_id.as_ref().is_some_and(|release_id| {
                    completed_release_ids
                        .iter()
                        .any(|completed| completed == release_id)
                })
            });
        })?;
        Ok(self.snapshot())
    }

    pub fn set_release_filed(
        &self,
        release_id: &str,
        filed: bool,
    ) -> Result<TransferQueueSnapshot, TransferError> {
        {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            set_release_filed_state(&mut transfers, release_id, filed, timestamp_ms())?;
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn clear_release_history(
        &self,
        release_ids: &[String],
    ) -> Result<TransferQueueSnapshot, TransferError> {
        {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            remove_completed_release_history(&mut transfers, release_ids)?;
        }
        self.persist_and_publish()?;
        Ok(self.snapshot())
    }

    pub fn reveal_path(&self, id: &str) -> Result<String, TransferError> {
        self.transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|transfer| transfer.id == id)
            .map(|transfer| transfer.local_path.clone())
            .ok_or(TransferError::NotFound)
    }

    pub fn reveal_release_path(&self, release_id: &str) -> Result<String, TransferError> {
        self.verify_release(release_id)?;
        self.transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|transfer| transfer.release_id.as_deref() == Some(release_id))
            .and_then(|transfer| {
                transfer.release_folder.clone().or_else(|| {
                    Path::new(&transfer.local_path)
                        .parent()
                        .map(|path| path.to_string_lossy().into_owned())
                })
            })
            .ok_or(TransferError::ReleaseNotFound)
    }

    pub fn activate_next(&self, connection_token: u32) -> Option<TransferTicket> {
        if self.safety_state() != TransferSafetyState::Running {
            return None;
        }
        let ticket = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let now = timestamp_ms();
            let index = next_download_index(
                &transfers,
                self.max_concurrent_downloads.load(Ordering::SeqCst),
                now,
            )?;
            let transfer = &mut transfers[index];
            transfer.status = TransferStatus::Requesting;
            transfer.connection_token = Some(connection_token);
            transfer.transfer_token = None;
            transfer.queue_position = None;
            transfer.error = None;
            transfer.retry_at_ms = None;
            transfer.waiting_since_ms = Some(now);
            transfer.updated_at_ms = now;
            TransferTicket {
                id: transfer.id.clone(),
                username: transfer.username.clone(),
                remote_filename: transfer.remote_filename.clone(),
                connection_token,
            }
        };
        let _ = self.persist_and_publish();
        Some(ticket)
    }

    pub fn requesting_for_username(&self, username: &str) -> Option<TransferTicket> {
        self.transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|transfer| {
                transfer.status == TransferStatus::Requesting
                    && transfer.username.eq_ignore_ascii_case(username)
            })
            .and_then(|transfer| {
                Some(TransferTicket {
                    id: transfer.id.clone(),
                    username: transfer.username.clone(),
                    remote_filename: transfer.remote_filename.clone(),
                    connection_token: transfer.connection_token?,
                })
            })
    }

    pub fn claim_peer(&self, connection_token: u32) -> Option<TransferTicket> {
        let ticket = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let transfer = transfers.iter_mut().find(|transfer| {
                transfer.status == TransferStatus::Requesting
                    && transfer.connection_token == Some(connection_token)
            })?;
            transfer.status = TransferStatus::RemotelyQueued;
            transfer.updated_at_ms = timestamp_ms();
            TransferTicket {
                id: transfer.id.clone(),
                username: transfer.username.clone(),
                remote_filename: transfer.remote_filename.clone(),
                connection_token,
            }
        };
        let _ = self.persist_and_publish();
        Some(ticket)
    }

    pub fn accept_upload_request(
        &self,
        username: &str,
        remote_filename: &str,
        transfer_token: u32,
        size_bytes: u64,
    ) -> Option<String> {
        let id = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let normalized = normalize_remote_filename(remote_filename);
            let transfer = transfers.iter_mut().find(|transfer| {
                transfer.status == TransferStatus::RemotelyQueued
                    && transfer.username.eq_ignore_ascii_case(username)
                    && transfer.remote_filename.eq_ignore_ascii_case(&normalized)
                    && transfer.size_bytes == size_bytes
            })?;
            transfer.status = TransferStatus::Connecting;
            transfer.transfer_token = Some(transfer_token);
            transfer.queue_position = None;
            transfer.updated_at_ms = timestamp_ms();
            transfer.id.clone()
        };
        let _ = self.persist_and_publish();
        Some(id)
    }

    pub fn set_queue_position(&self, username: &str, filename: &str, position: u32) {
        let normalized = normalize_remote_filename(filename);
        let _ = self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| {
                transfer.status == TransferStatus::RemotelyQueued
                    && transfer.username.eq_ignore_ascii_case(username)
                    && transfer.remote_filename.eq_ignore_ascii_case(&normalized)
            }) {
                transfer.queue_position = Some(position);
                transfer.updated_at_ms = timestamp_ms();
            }
        });
    }

    pub fn fail_for_filename(&self, username: &str, filename: &str, message: String) -> bool {
        let normalized = normalize_remote_filename(filename);
        self.fail_matching(message, |transfer| {
            transfer.username.eq_ignore_ascii_case(username)
                && transfer.remote_filename.eq_ignore_ascii_case(&normalized)
                && transfer.status.occupies_slot()
        })
    }

    pub fn retry_for_filename(&self, username: &str, filename: &str, message: String) -> bool {
        let normalized = normalize_remote_filename(filename);
        self.retry_matching(message, |transfer| {
            transfer.username.eq_ignore_ascii_case(username)
                && transfer.remote_filename.eq_ignore_ascii_case(&normalized)
                && transfer.status.occupies_slot()
        })
    }

    pub fn retry_connection(&self, connection_token: u32, message: String) -> bool {
        self.retry_matching(message, |transfer| {
            transfer.connection_token == Some(connection_token)
                && transfer.status == TransferStatus::Requesting
        })
    }

    pub fn fail_id(&self, id: &str, message: String) -> bool {
        self.fail_matching(message, |transfer| transfer.id == id)
    }

    pub fn retry_id(&self, id: &str, message: String) -> bool {
        self.retry_matching(message, |transfer| transfer.id == id)
    }

    pub fn fail_transfer_token(&self, transfer_token: u32, message: String) -> bool {
        self.fail_matching(message, |transfer| {
            transfer.transfer_token == Some(transfer_token)
                && matches!(
                    transfer.status,
                    TransferStatus::Connecting | TransferStatus::Downloading
                )
        })
    }

    pub fn begin_file(&self, transfer_token: u32) -> Result<DownloadPlan, TransferError> {
        let plan = {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let transfer = transfers
                .iter_mut()
                .find(|transfer| {
                    transfer.status == TransferStatus::Connecting
                        && transfer.transfer_token == Some(transfer_token)
                })
                .ok_or(TransferError::UnexpectedFileConnection)?;
            let final_path = PathBuf::from(&transfer.local_path);
            let partial_path = partial_path(&final_path);
            let offset = match fs::metadata(&partial_path) {
                Ok(metadata) => metadata.len(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
                Err(error) => return Err(error.into()),
            };
            if offset > transfer.size_bytes {
                return Err(TransferError::PartialTooLarge);
            }
            transfer.status = TransferStatus::Downloading;
            transfer.transferred_bytes = offset;
            transfer.speed_bytes_per_second = 0;
            transfer.eta_seconds = None;
            transfer.waiting_since_ms = None;
            transfer.updated_at_ms = timestamp_ms();
            DownloadPlan {
                id: transfer.id.clone(),
                partial_path,
                final_path,
                size_bytes: transfer.size_bytes,
                offset,
            }
        };
        self.persist_and_publish()?;
        Ok(plan)
    }

    pub fn update_progress(&self, id: &str, transferred: u64, speed: u64) {
        let _ = self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| transfer.id == id) {
                if transfer.status == TransferStatus::Downloading {
                    transfer.transferred_bytes = transferred.min(transfer.size_bytes);
                    transfer.speed_bytes_per_second = speed;
                    transfer.eta_seconds = (speed > 0).then(|| {
                        transfer
                            .size_bytes
                            .saturating_sub(transfer.transferred_bytes)
                            .div_ceil(speed)
                    });
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        });
    }

    pub fn complete(&self, id: &str) -> Result<(), TransferError> {
        let mut found = false;
        self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| transfer.id == id) {
                found = true;
                transfer.status = TransferStatus::Completed;
                transfer.transferred_bytes = transfer.size_bytes;
                transfer.speed_bytes_per_second = 0;
                transfer.eta_seconds = Some(0);
                transfer.queue_position = None;
                transfer.error = None;
                transfer.retry_count = 0;
                transfer.retry_at_ms = None;
                transfer.waiting_since_ms = None;
                transfer.connection_token = None;
                transfer.transfer_token = None;
                transfer.updated_at_ms = timestamp_ms();
                refresh_verification(transfer);
                let patch_repair = transfer.patch_repair.is_some();
                if patch_repair || self.soundcheck_enabled.load(Ordering::SeqCst) {
                    refresh_soundcheck(transfer, patch_repair);
                }
                if let Some(repair) = transfer.patch_repair.as_mut() {
                    repair.repaired_at_ms = Some(timestamp_ms());
                }
            }
        })?;
        if !found {
            return Err(TransferError::NotFound);
        }
        Ok(())
    }

    pub fn connection_lost(&self) {
        let ids: Vec<String> = self
            .transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|transfer| transfer.status.occupies_slot())
            .map(|transfer| transfer.id.clone())
            .collect();
        for id in ids {
            self.abort(&id);
        }
        let _ = self.mutate(|transfers| {
            for transfer in transfers {
                if transfer.status.occupies_slot() {
                    refresh_partial_size(transfer);
                    transfer.status = TransferStatus::Queued;
                    transfer.speed_bytes_per_second = 0;
                    transfer.eta_seconds = None;
                    transfer.queue_position = None;
                    transfer.error = None;
                    transfer.retry_at_ms = None;
                    transfer.waiting_since_ms = None;
                    transfer.connection_token = None;
                    transfer.transfer_token = None;
                    transfer.updated_at_ms = timestamp_ms();
                }
            }
        });
    }

    pub fn register_task(&self, id: String, cancellation: Arc<AtomicBool>) {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, cancellation);
    }

    pub fn unregister_task(&self, id: &str) {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id);
    }

    fn abort(&self, id: &str) {
        if let Some(cancellation) = self
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id)
        {
            cancellation.store(true, Ordering::SeqCst);
        }
    }

    fn mutate_release(
        &self,
        release_id: &str,
        mut mutation: impl FnMut(&mut TransferSnapshot),
    ) -> Result<TransferQueueSnapshot, TransferError> {
        let ids: Vec<String> = self
            .transfers
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            .map(|transfer| transfer.id.clone())
            .collect();
        if ids.is_empty() {
            return Err(TransferError::ReleaseNotFound);
        }
        for id in ids {
            self.abort(&id);
        }
        self.mutate(|transfers| {
            for transfer in transfers
                .iter_mut()
                .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
            {
                mutation(transfer);
                transfer.updated_at_ms = timestamp_ms();
            }
        })?;
        Ok(self.snapshot())
    }

    fn fail_matching(&self, message: String, matches: impl Fn(&TransferSnapshot) -> bool) -> bool {
        let mut changed = false;
        let _ = self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| matches(transfer)) {
                refresh_partial_size(transfer);
                transfer.status = TransferStatus::Failed;
                transfer.speed_bytes_per_second = 0;
                transfer.eta_seconds = None;
                transfer.queue_position = None;
                transfer.error = Some(message);
                transfer.retry_at_ms = None;
                transfer.waiting_since_ms = None;
                transfer.connection_token = None;
                transfer.transfer_token = None;
                transfer.updated_at_ms = timestamp_ms();
                changed = true;
            }
        });
        changed
    }

    fn retry_matching(&self, message: String, matches: impl Fn(&TransferSnapshot) -> bool) -> bool {
        let mut changed = false;
        let _ = self.mutate(|transfers| {
            if let Some(transfer) = transfers.iter_mut().find(|transfer| matches(transfer)) {
                refresh_partial_size(transfer);
                transfer.retry_count = transfer.retry_count.saturating_add(1);
                transfer.speed_bytes_per_second = 0;
                transfer.eta_seconds = None;
                transfer.queue_position = None;
                transfer.connection_token = None;
                transfer.transfer_token = None;
                transfer.waiting_since_ms = None;
                transfer.updated_at_ms = timestamp_ms();
                if transfer.retry_count <= MAX_AUTOMATIC_RETRIES {
                    transfer.status = TransferStatus::Retrying;
                    transfer.retry_at_ms = Some(
                        transfer
                            .updated_at_ms
                            .saturating_add(automatic_retry_delay_ms(transfer.retry_count)),
                    );
                    transfer.error = Some(message);
                } else {
                    transfer.status = TransferStatus::Failed;
                    transfer.retry_at_ms = None;
                    transfer.error = Some(format!(
                        "Automatic recovery stopped after {MAX_AUTOMATIC_RETRIES} tries. {message}"
                    ));
                }
                changed = true;
            }
        });
        changed
    }

    fn mutate(
        &self,
        mutation: impl FnOnce(&mut Vec<TransferSnapshot>),
    ) -> Result<bool, TransferError> {
        {
            let mut transfers = self
                .transfers
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let before = transfers.len();
            mutation(&mut transfers);
            if transfers.len() == before && transfers.is_empty() {
                return Ok(false);
            }
        }
        self.persist_and_publish()?;
        Ok(true)
    }

    fn persist_and_publish(&self) -> Result<(), TransferError> {
        self.persist()?;
        let _ = self.app.emit(TRANSFER_EVENT, self.snapshot());
        Ok(())
    }

    fn persist(&self) -> Result<(), TransferError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let store = TransferStore {
            version: STORE_VERSION,
            max_concurrent_downloads: self.max_concurrent_downloads.load(Ordering::SeqCst),
            relay_suggestion_minutes: self.relay_suggestion_minutes.load(Ordering::SeqCst),
            soundcheck_enabled: self.soundcheck_enabled.load(Ordering::SeqCst),
            transfers: self
                .transfers
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone(),
        };
        fs::write(&self.path, serde_json::to_vec_pretty(&store)?)?;
        Ok(())
    }
}

fn schedule_partial_cleanup(path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        for _ in 0..20 {
            match tokio::fs::remove_file(&path).await {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(_) => return,
            }
        }
    });
}

fn prepare_transfers_for_restart(
    transfers: &mut [TransferSnapshot],
    mode: TransferPreparationMode,
) {
    let now = timestamp_ms();
    for transfer in transfers {
        if transfer.status == TransferStatus::Completed {
            continue;
        }
        let keep_downloading = mode == TransferPreparationMode::FinishCurrentFiles
            && transfer.status == TransferStatus::Downloading;
        if keep_downloading {
            continue;
        }
        if transfer.status.occupies_slot() {
            refresh_partial_size(transfer);
            transfer.status = TransferStatus::Queued;
            reset_runtime_state(transfer);
            transfer.error = None;
            transfer.retry_at_ms = None;
            transfer.updated_at_ms = now;
        }
    }
}

fn set_release_filed_state(
    transfers: &mut [TransferSnapshot],
    release_id: &str,
    filed: bool,
    now: u64,
) -> Result<(), TransferError> {
    let release = transfers
        .iter()
        .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
        .collect::<Vec<_>>();
    if release.is_empty() {
        return Err(TransferError::ReleaseNotFound);
    }
    if release
        .iter()
        .any(|transfer| transfer.status != TransferStatus::Completed)
    {
        return Err(TransferError::ReleaseNotCompleted);
    }

    for transfer in transfers
        .iter_mut()
        .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
    {
        transfer.filed_at_ms = filed.then_some(now);
    }
    Ok(())
}

fn remove_completed_release_history(
    transfers: &mut Vec<TransferSnapshot>,
    release_ids: &[String],
) -> Result<(), TransferError> {
    if release_ids.is_empty() || release_ids.len() > 300 {
        return Err(TransferError::InvalidReleaseSelection);
    }
    let requested = release_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    for release_id in &requested {
        let release = transfers
            .iter()
            .filter(|transfer| transfer.release_id.as_deref() == Some(*release_id))
            .collect::<Vec<_>>();
        if release.is_empty() {
            return Err(TransferError::ReleaseNotFound);
        }
        if release
            .iter()
            .any(|transfer| transfer.status != TransferStatus::Completed)
        {
            return Err(TransferError::ReleaseNotCompleted);
        }
    }
    transfers.retain(|transfer| {
        !transfer
            .release_id
            .as_deref()
            .is_some_and(|release_id| requested.contains(release_id))
    });
    Ok(())
}

fn reconcile_transfer_after_restart(transfer: &mut TransferSnapshot) {
    let final_path = Path::new(&transfer.local_path);
    let final_file_complete = transfer.status != TransferStatus::Completed
        && fs::metadata(final_path)
            .map(|metadata| metadata.is_file() && metadata.len() == transfer.size_bytes)
            .unwrap_or(false);
    if final_file_complete {
        transfer.status = TransferStatus::Completed;
        transfer.transferred_bytes = transfer.size_bytes;
        transfer.speed_bytes_per_second = 0;
        transfer.eta_seconds = Some(0);
        transfer.error = None;
        transfer.retry_at_ms = None;
        transfer.waiting_since_ms = None;
        transfer.connection_token = None;
        transfer.transfer_token = None;
        refresh_verification(transfer);
        return;
    }

    if transfer.status.occupies_slot() {
        transfer.status = TransferStatus::Queued;
        transfer.speed_bytes_per_second = 0;
        transfer.eta_seconds = None;
        transfer.error = None;
        transfer.connection_token = None;
        transfer.transfer_token = None;
    }
    refresh_partial_size(transfer);
    if transfer.status == TransferStatus::Completed {
        refresh_verification(transfer);
    }
}

fn validate_request(request: &EnqueueTransferRequest) -> Result<(), TransferError> {
    if request.title.trim().is_empty()
        || request.username.trim().is_empty()
        || request.remote_filename.trim().is_empty()
    {
        return Err(TransferError::InvalidRequest);
    }
    if request.size_bytes == 0 {
        return Err(TransferError::InvalidSize);
    }
    Ok(())
}

fn validate_release_request(request: &EnqueueReleaseRequest) -> Result<(), TransferError> {
    if request.title.trim().is_empty()
        || request.username.trim().is_empty()
        || request.remote_folder.trim().is_empty()
        || request.files.is_empty()
        || request.files.len() > 5_000
        || request
            .expected_track_count
            .is_some_and(|count| count == 0 || count > 5_000)
        || request.release_group_id.as_deref().is_some_and(|id| {
            id.len() != 36
                || id
                    .chars()
                    .enumerate()
                    .any(|(index, character)| match index {
                        8 | 13 | 18 | 23 => character != '-',
                        _ => !character.is_ascii_hexdigit(),
                    })
        })
        || request.files.iter().any(|file| {
            file.title.trim().is_empty()
                || file.remote_filename.trim().is_empty()
                || file.size_bytes == 0
        })
        || request.alternatives.len() > 12
        || request.alternatives.iter().any(|source| {
            source.username.trim().is_empty()
                || source.remote_folder.trim().is_empty()
                || source.files.is_empty()
                || source.files.len() > 5_000
                || source.files.iter().any(|file| {
                    file.title.trim().is_empty()
                        || file.remote_filename.trim().is_empty()
                        || file.size_bytes == 0
                })
        })
    {
        return Err(TransferError::InvalidReleaseRequest);
    }
    Ok(())
}

fn validate_alternative_source(source: &ReleaseAlternativeSource) -> Result<(), TransferError> {
    if source.username.trim().is_empty()
        || source.remote_folder.trim().is_empty()
        || source.files.is_empty()
        || source.files.len() > 5_000
        || source.files.iter().any(|file| {
            file.title.trim().is_empty()
                || file.remote_filename.trim().is_empty()
                || file.size_bytes == 0
        })
    {
        return Err(TransferError::InvalidAlternativeSource);
    }
    Ok(())
}

fn unfinished_release_uses_source(
    transfers: &[TransferSnapshot],
    request: &EnqueueReleaseRequest,
) -> bool {
    let requested_folder = normalize_remote_folder(&request.remote_folder);
    let unfinished_releases: HashSet<&str> = transfers
        .iter()
        .filter(|transfer| transfer.status != TransferStatus::Completed)
        .filter_map(|transfer| transfer.release_id.as_deref())
        .collect();

    transfers.iter().any(|transfer| {
        transfer
            .release_id
            .as_deref()
            .is_some_and(|release_id| unfinished_releases.contains(release_id))
            && transfer.username.eq_ignore_ascii_case(&request.username)
            && remote_parent(&transfer.remote_filename).eq_ignore_ascii_case(&requested_folder)
    })
}

fn reorder_queued_release(
    transfers: &mut Vec<TransferSnapshot>,
    release_id: &str,
    before_transfer_id: Option<&str>,
) -> Result<(), TransferError> {
    let release: Vec<&TransferSnapshot> = transfers
        .iter()
        .filter(|transfer| transfer.release_id.as_deref() == Some(release_id))
        .collect();
    if release.is_empty() {
        return Err(TransferError::ReleaseNotFound);
    }
    if release
        .iter()
        .any(|transfer| transfer.status.occupies_slot())
        || !release
            .iter()
            .any(|transfer| transfer.status == TransferStatus::Queued)
    {
        return Err(TransferError::ReleaseNotQueued);
    }
    if before_transfer_id
        .is_some_and(|target_id| release.iter().any(|transfer| transfer.id == target_id))
    {
        return Ok(());
    }
    if let Some(target_id) = before_transfer_id {
        let target = transfers
            .iter()
            .find(|transfer| transfer.id == target_id)
            .ok_or(TransferError::InvalidReleaseOrder)?;
        if target.status != TransferStatus::Queued {
            return Err(TransferError::InvalidReleaseOrder);
        }
        let target_release_id = target
            .release_id
            .as_deref()
            .ok_or(TransferError::InvalidReleaseOrder)?;
        if transfers.iter().any(|transfer| {
            transfer.release_id.as_deref() == Some(target_release_id)
                && transfer.status.occupies_slot()
        }) {
            return Err(TransferError::InvalidReleaseOrder);
        }
    }

    let mut moving = Vec::new();
    let mut remaining = Vec::with_capacity(transfers.len());
    for transfer in std::mem::take(transfers) {
        if transfer.release_id.as_deref() == Some(release_id) {
            moving.push(transfer);
        } else {
            remaining.push(transfer);
        }
    }
    let insertion = before_transfer_id
        .and_then(|target_id| {
            remaining
                .iter()
                .position(|transfer| transfer.id == target_id)
        })
        .unwrap_or(remaining.len());
    remaining.splice(insertion..insertion, moving);
    *transfers = remaining;
    Ok(())
}

fn reset_runtime_state(transfer: &mut TransferSnapshot) {
    transfer.speed_bytes_per_second = 0;
    transfer.eta_seconds = None;
    transfer.queue_position = None;
    transfer.connection_token = None;
    transfer.transfer_token = None;
    transfer.waiting_since_ms = None;
}

fn next_download_index(
    transfers: &[TransferSnapshot],
    max_concurrent_downloads: u8,
    now: u64,
) -> Option<usize> {
    let active_count = transfers
        .iter()
        .filter(|transfer| transfer.status.occupies_slot())
        .count();
    if active_count >= usize::from(max_concurrent_downloads) {
        return None;
    }
    let active_usernames = transfers
        .iter()
        .filter(|transfer| transfer.status.occupies_slot())
        .map(|transfer| transfer.username.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    transfers.iter().position(|transfer| {
        !active_usernames.contains(&transfer.username.to_ascii_lowercase())
            && (transfer.status == TransferStatus::Queued
                || (transfer.status == TransferStatus::Retrying
                    && transfer.retry_at_ms.is_none_or(|retry_at| retry_at <= now)))
    })
}

fn load_store(path: &Path) -> Result<TransferStore, TransferError> {
    if !path.exists() {
        return Ok(TransferStore {
            version: STORE_VERSION,
            max_concurrent_downloads: DEFAULT_MAX_CONCURRENT_DOWNLOADS,
            relay_suggestion_minutes: DEFAULT_RELAY_SUGGESTION_MINUTES,
            soundcheck_enabled: true,
            transfers: Vec::new(),
        });
    }
    let store = serde_json::from_slice::<TransferStore>(&fs::read(path)?)?;
    if store.version != STORE_VERSION {
        return Err(TransferError::UnsupportedStoreVersion(store.version));
    }
    if !(1..=MAX_CONCURRENT_DOWNLOADS).contains(&store.max_concurrent_downloads) {
        return Err(TransferError::InvalidConcurrentDownloads);
    }
    if !RELAY_SUGGESTION_MINUTES.contains(&store.relay_suggestion_minutes) {
        return Err(TransferError::InvalidRelaySuggestionMinutes);
    }
    Ok(store)
}

fn refresh_partial_size(transfer: &mut TransferSnapshot) {
    if transfer.status == TransferStatus::Completed {
        transfer.transferred_bytes = transfer.size_bytes;
        return;
    }
    transfer.transferred_bytes = fs::metadata(partial_path(Path::new(&transfer.local_path)))
        .map(|metadata| metadata.len().min(transfer.size_bytes))
        .unwrap_or(0);
}

fn refresh_verification(transfer: &mut TransferSnapshot) {
    if transfer.status != TransferStatus::Completed {
        transfer.verification_status = VerificationStatus::Pending;
        transfer.verification_message = None;
        transfer.verified_at_ms = None;
        transfer.soundcheck = None;
        return;
    }
    let path = Path::new(&transfer.local_path);
    match fs::metadata(path) {
        Ok(metadata) if metadata.len() == transfer.size_bytes => {
            transfer.verification_status = VerificationStatus::Verified;
            transfer.verification_message = None;
            transfer.verified_at_ms = Some(timestamp_ms());
        }
        Ok(metadata) => {
            transfer.verification_status = VerificationStatus::SizeMismatch;
            transfer.verification_message = Some(format!(
                "Expected {} bytes, but the completed file contains {} bytes.",
                transfer.size_bytes,
                metadata.len()
            ));
            transfer.verified_at_ms = Some(timestamp_ms());
            transfer.soundcheck = None;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            transfer.verification_status = VerificationStatus::Missing;
            transfer.verification_message =
                Some("The completed file is no longer present in the download folder.".to_owned());
            transfer.verified_at_ms = Some(timestamp_ms());
            transfer.soundcheck = None;
        }
        Err(error) => {
            transfer.verification_status = VerificationStatus::SizeMismatch;
            transfer.verification_message = Some(format!(
                "Forever could not inspect the completed file: {error}"
            ));
            transfer.verified_at_ms = Some(timestamp_ms());
            transfer.soundcheck = None;
        }
    }
}

fn refresh_soundcheck(transfer: &mut TransferSnapshot, deep: bool) {
    transfer.soundcheck = if transfer.status == TransferStatus::Completed
        && transfer.verification_status == VerificationStatus::Verified
    {
        inspect_file(Path::new(&transfer.local_path), deep, timestamp_ms())
    } else {
        None
    };
}

fn audio_extension(filename: &str) -> Option<&str> {
    let extension = Path::new(filename).extension()?.to_str()?;
    [
        "aac", "aif", "aiff", "alac", "ape", "caf", "flac", "m4a", "mp4", "mp3", "oga", "ogg",
        "opus", "wav", "wma", "wv",
    ]
    .iter()
    .any(|candidate| candidate.eq_ignore_ascii_case(extension))
    .then_some(extension)
}

fn transfer_track_number(transfer: &TransferSnapshot) -> Option<u32> {
    transfer
        .soundcheck
        .as_ref()
        .and_then(|result| result.track_number)
        .or_else(|| {
            safe_basename(&transfer.remote_filename)
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>()
                .parse::<u32>()
                .ok()
                .filter(|number| *number > 0)
        })
}

fn patch_issue_reason(transfer: &TransferSnapshot) -> Option<String> {
    if transfer.status == TransferStatus::Failed {
        return Some(
            transfer
                .error
                .clone()
                .unwrap_or_else(|| "The original transfer failed.".to_owned()),
        );
    }
    match transfer.verification_status {
        VerificationStatus::Missing => {
            return Some("The completed file is missing from the release folder.".to_owned())
        }
        VerificationStatus::SizeMismatch => {
            return Some(
                transfer
                    .verification_message
                    .clone()
                    .unwrap_or_else(|| "The completed file has an unexpected size.".to_owned()),
            )
        }
        VerificationStatus::Pending | VerificationStatus::Verified => {}
    }
    transfer.soundcheck.as_ref().and_then(|result| {
        (result.status == SoundcheckStatus::Failed).then(|| {
            result
                .issues
                .first()
                .cloned()
                .unwrap_or_else(|| "Soundcheck could not read the original audio.".to_owned())
        })
    })
}

fn normalized_patch_warnings(warnings: &[String]) -> Vec<String> {
    warnings
        .iter()
        .map(|warning| warning.trim())
        .filter(|warning| !warning.is_empty())
        .map(|warning| warning.chars().take(180).collect::<String>())
        .collect::<HashSet<_>>()
        .into_iter()
        .take(6)
        .collect()
}

fn validate_patch_request(request: &PatchReleaseFileRequest) -> Result<(), TransferError> {
    if request.release_id.trim().is_empty()
        || request.release_id.len() > 256
        || request.username.trim().is_empty()
        || request.username.len() > 256
        || request.title.trim().is_empty()
        || request.title.len() > 1_024
        || request.remote_filename.trim().is_empty()
        || request.remote_filename.len() > 4_096
        || request.size_bytes == 0
        || request.target_transfer_id.is_some() == request.target_track_number.is_some()
    {
        return Err(TransferError::InvalidPatchCandidate);
    }
    if audio_extension(&request.remote_filename).is_none() {
        return Err(TransferError::InvalidPatchCandidate);
    }
    Ok(())
}

fn automatic_retry_delay_ms(attempt: u32) -> u64 {
    match attempt {
        0 | 1 => 5_000,
        2 => 15_000,
        _ => 45_000,
    }
}

fn matching_alternative_file<'a>(
    transfer: &TransferSnapshot,
    source: &'a ReleaseAlternativeSource,
) -> Option<(&'a ReleaseAlternativeFile, bool)> {
    if let Some(file) = source.files.iter().find(|file| {
        file.size_bytes == transfer.size_bytes
            && safe_basename(&file.remote_filename)
                .eq_ignore_ascii_case(&safe_basename(&transfer.remote_filename))
    }) {
        return Some((file, true));
    }
    let current_name = safe_basename(&transfer.remote_filename);
    let current_path = Path::new(&current_name);
    let current_stem = current_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&current_name);
    let current_extension = current_path.extension().and_then(|value| value.to_str());
    if let Some(file) = source.files.iter().find(|file| {
        let candidate_name = safe_basename(&file.remote_filename);
        let candidate = Path::new(&candidate_name);
        candidate
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(|stem| stem.eq_ignore_ascii_case(current_stem))
            && candidate
                .extension()
                .and_then(|value| value.to_str())
                .zip(current_extension)
                .is_some_and(|(left, right)| left.eq_ignore_ascii_case(right))
    }) {
        return Some((file, false));
    }
    let index = transfer.file_index?.checked_sub(1)? as usize;
    let file = source.files.get(index)?;
    let candidate_name = safe_basename(&file.remote_filename);
    let same_extension = Path::new(&candidate_name)
        .extension()
        .and_then(|value| value.to_str())
        .zip(current_extension)
        .is_some_and(|(left, right)| left.eq_ignore_ascii_case(right));
    same_extension.then_some((file, false))
}

fn partial_path(final_path: &Path) -> PathBuf {
    let mut value = final_path.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

fn preserve_rejected_file(path: &Path) -> Result<(), TransferError> {
    if !path.exists() {
        return Ok(());
    }
    let mut candidate = PathBuf::from(format!("{}.soundcheck-rejected", path.to_string_lossy()));
    let mut suffix = 2_u32;
    while candidate.exists() {
        candidate = PathBuf::from(format!(
            "{}.soundcheck-rejected-{suffix}",
            path.to_string_lossy()
        ));
        suffix = suffix.saturating_add(1);
    }
    fs::rename(path, candidate)?;
    Ok(())
}

fn unique_target_path(
    directory: &Path,
    remote_filename: &str,
    transfers: &[TransferSnapshot],
) -> PathBuf {
    let safe_name = safe_basename(remote_filename);
    let candidate = directory.join(&safe_name);
    if path_available(&candidate, transfers) {
        return candidate;
    }

    let path = Path::new(&safe_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..10_000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if path_available(&candidate, transfers) {
            return candidate;
        }
    }
    directory.join(format!("download-{}.bin", timestamp_ms()))
}

fn unique_release_directory(
    directory: &Path,
    title: &str,
    transfers: &[TransferSnapshot],
) -> PathBuf {
    let safe_title = safe_path_segment(title);
    for index in 1..10_000 {
        let name = if index == 1 {
            safe_title.clone()
        } else {
            format!("{safe_title} ({index})")
        };
        let candidate = directory.join(name);
        let used = candidate.exists()
            || transfers.iter().any(|transfer| {
                transfer.release_folder.as_ref().is_some_and(|folder| {
                    Path::new(folder)
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&candidate.to_string_lossy())
                })
            });
        if !used {
            return candidate;
        }
    }
    directory.join(format!("release-{}", timestamp_ms()))
}

fn path_available(candidate: &Path, transfers: &[TransferSnapshot]) -> bool {
    !candidate.exists()
        && !partial_path(candidate).exists()
        && !transfers.iter().any(|transfer| {
            Path::new(&transfer.local_path)
                .to_string_lossy()
                .eq_ignore_ascii_case(&candidate.to_string_lossy())
        })
}

fn normalize_remote_filename(value: &str) -> String {
    value.replace('/', "\\")
}

fn normalize_remote_folder(value: &str) -> String {
    normalize_remote_filename(value)
        .trim_matches('\\')
        .trim_end_matches('\\')
        .to_owned()
}

fn remote_parent(remote_filename: &str) -> String {
    let normalized = normalize_remote_filename(remote_filename);
    normalized
        .rsplit_once('\\')
        .map(|(folder, _)| normalize_remote_folder(folder))
        .unwrap_or_default()
}

fn safe_basename(remote_filename: &str) -> String {
    let normalized = normalize_remote_filename(remote_filename);
    let raw = normalized
        .split('\\')
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("download");
    let mut name: String = raw
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    name = name.trim().trim_end_matches(['.', ' ']).to_owned();
    if name.is_empty() || name == "." || name == ".." {
        name = "download".to_owned();
    }
    let stem = Path::new(&name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&name)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    if reserved {
        name.insert(0, '_');
    }
    if name.chars().count() > 180 {
        name = name.chars().take(180).collect();
        name = name.trim_end_matches(['.', ' ']).to_owned();
    }
    name
}

fn safe_path_segment(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim().trim_end_matches(['.', ' ']);
    let sanitized = if sanitized.is_empty() {
        "Release"
    } else {
        sanitized
    };
    sanitized.chars().take(120).collect()
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
pub enum TransferError {
    #[error("Choose a valid Soulseek file before downloading.")]
    InvalidRequest,
    #[error("The selected Soulseek file has an invalid size.")]
    InvalidSize,
    #[error("That transfer is no longer in the queue.")]
    NotFound,
    #[error("That release is no longer in the queue.")]
    ReleaseNotFound,
    #[error("Only completed releases can be filed or removed from Arrival Desk.")]
    ReleaseNotCompleted,
    #[error("Choose between 1 and 300 completed releases to remove from Arrival Desk.")]
    InvalidReleaseSelection,
    #[error("That release has no missing or failed files that can be retried safely.")]
    NoRecoverableIssues,
    #[error("That alternative source is no longer available for this release.")]
    AlternativeSourceNotFound,
    #[error("The alternative source did not contain compatible files for the unfinished release.")]
    AlternativeSourceMismatch,
    #[error("Choose a complete, valid folder before relaying this release to another source.")]
    InvalidAlternativeSource,
    #[error("Choose one valid audio file from a live Patch Bay result.")]
    InvalidPatchCandidate,
    #[error("That file is not a repairable track in this completed release.")]
    InvalidPatchTarget,
    #[error("Soundcheck does not report a repairable issue for that track.")]
    NoPatchIssue,
    #[error("That replacement is already part of this release.")]
    PatchCandidateAlreadyQueued,
    #[error("That replacement changes the audio format. Review and accept the compatibility warning first.")]
    IncompatiblePatchCandidate,
    #[error("That exact listener and folder are already in the release queue.")]
    DuplicateReleaseSource,
    #[error("Only a queued release can be reordered.")]
    ReleaseNotQueued,
    #[error("That release cannot be moved to the requested queue position.")]
    InvalidReleaseOrder,
    #[error("Choose between 1 and 6 simultaneous download users.")]
    InvalidConcurrentDownloads,
    #[error("Choose Off, 5, 10, 20, 30, or 60 minutes for Signal Relay suggestions.")]
    InvalidRelaySuggestionMinutes,
    #[error("Choose at least one valid file before downloading the release.")]
    InvalidReleaseRequest,
    #[error("The incoming Soulseek file connection did not match the active download.")]
    UnexpectedFileConnection,
    #[error(
        "The partial file is larger than the expected Soulseek file. Remove it before retrying."
    )]
    PartialTooLarge,
    #[error("Transfer data uses an unsupported format version ({0}).")]
    UnsupportedStoreVersion(u32),
    #[error("Could not read or save transfer data: {0}")]
    Io(#[from] std::io::Error),
    #[error("Transfer data is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release_transfer(
        id: &str,
        release_id: &str,
        username: &str,
        remote_filename: &str,
        status: TransferStatus,
        file_index: u32,
    ) -> TransferSnapshot {
        TransferSnapshot {
            id: id.to_owned(),
            release_id: Some(release_id.to_owned()),
            release_title: Some(release_id.to_owned()),
            release_folder: Some(format!("C:\\Downloads\\{release_id}")),
            file_index: Some(file_index),
            file_count: Some(2),
            expected_track_count: Some(2),
            release_group_id: None,
            title: remote_filename.to_owned(),
            username: username.to_owned(),
            remote_filename: remote_filename.to_owned(),
            size_bytes: 100,
            transferred_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            status,
            queue_position: None,
            local_path: format!("C:\\Downloads\\{release_id}\\{id}.flac"),
            error: None,
            retry_count: 0,
            retry_at_ms: None,
            waiting_since_ms: None,
            verification_status: VerificationStatus::Pending,
            verification_message: None,
            verified_at_ms: None,
            filed_at_ms: None,
            soundcheck: None,
            patch_repair: None,
            alternative_sources: Vec::new(),
            created_at_ms: u64::from(file_index),
            updated_at_ms: u64::from(file_index),
            connection_token: None,
            transfer_token: None,
        }
    }

    #[test]
    fn remote_paths_are_reduced_to_safe_local_filenames() {
        assert_eq!(safe_basename("Music\\Artist\\Track.flac"), "Track.flac");
        assert_eq!(safe_basename("../../CON.mp3"), "_CON.mp3");
        assert_eq!(safe_basename("folder\\bad<name>?.wav"), "bad_name__.wav");
        assert_eq!(safe_basename("folder\\..."), "download");
    }

    #[test]
    fn collision_paths_never_overwrite_existing_files_or_queue_entries() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("Track.flac"), b"existing").unwrap();
        let transfers = vec![TransferSnapshot {
            id: "one".to_owned(),
            release_id: None,
            release_title: None,
            release_folder: None,
            file_index: None,
            file_count: None,
            expected_track_count: None,
            release_group_id: None,
            title: "Track".to_owned(),
            username: "peer".to_owned(),
            remote_filename: "Track.flac".to_owned(),
            size_bytes: 10,
            transferred_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            status: TransferStatus::Queued,
            queue_position: None,
            local_path: directory
                .path()
                .join("Track (2).flac")
                .to_string_lossy()
                .into_owned(),
            error: None,
            retry_count: 0,
            retry_at_ms: None,
            waiting_since_ms: None,
            verification_status: VerificationStatus::Pending,
            verification_message: None,
            verified_at_ms: None,
            filed_at_ms: None,
            soundcheck: None,
            patch_repair: None,
            alternative_sources: Vec::new(),
            created_at_ms: 0,
            updated_at_ms: 0,
            connection_token: None,
            transfer_token: None,
        }];

        assert_eq!(
            unique_target_path(directory.path(), "Track.flac", &transfers),
            directory.path().join("Track (3).flac")
        );
    }

    #[test]
    fn rejected_soundcheck_files_are_preserved_without_overwriting_history() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Track.flac");
        fs::write(&path, b"first rejected payload").unwrap();
        preserve_rejected_file(&path).unwrap();
        assert_eq!(
            fs::read(directory.path().join("Track.flac.soundcheck-rejected")).unwrap(),
            b"first rejected payload"
        );

        fs::write(&path, b"second rejected payload").unwrap();
        preserve_rejected_file(&path).unwrap();
        assert_eq!(
            fs::read(directory.path().join("Track.flac.soundcheck-rejected-2")).unwrap(),
            b"second rejected payload"
        );
    }

    #[test]
    fn patch_requests_require_one_repair_target_and_live_audio() {
        let valid = PatchReleaseFileRequest {
            release_id: "release-one".to_owned(),
            target_transfer_id: Some("track-two".to_owned()),
            target_track_number: None,
            title: "02 - Repaired.flac".to_owned(),
            username: "repair-source".to_owned(),
            remote_filename: "Music\\Album\\02 - Repaired.flac".to_owned(),
            size_bytes: 42,
            allow_incompatible: false,
            warnings: Vec::new(),
        };
        assert!(validate_patch_request(&valid).is_ok());

        let mut ambiguous = valid;
        ambiguous.target_track_number = Some(2);
        assert!(matches!(
            validate_patch_request(&ambiguous),
            Err(TransferError::InvalidPatchCandidate)
        ));
        ambiguous.target_transfer_id = None;
        ambiguous.remote_filename = "Music\\Album\\cover.jpg".to_owned();
        assert!(matches!(
            validate_patch_request(&ambiguous),
            Err(TransferError::InvalidPatchCandidate)
        ));
    }

    #[test]
    fn patch_reason_preserves_the_original_soundcheck_failure() {
        let mut transfer = release_transfer(
            "track-two",
            "release-one",
            "original-source",
            "Music\\Album\\02 - Broken.flac",
            TransferStatus::Completed,
            2,
        );
        transfer.verification_status = VerificationStatus::Verified;
        transfer.soundcheck = Some(SoundcheckResult {
            status: SoundcheckStatus::Failed,
            issues: vec!["Decoder stopped before the final frame.".to_owned()],
            ..SoundcheckResult::default()
        });

        assert_eq!(
            patch_issue_reason(&transfer).as_deref(),
            Some("Decoder stopped before the final frame.")
        );
    }

    #[test]
    fn persisted_transfers_keep_resume_progress_without_runtime_tokens() {
        let directory = tempfile::tempdir().unwrap();
        let final_path = directory.path().join("Track.flac");
        fs::write(partial_path(&final_path), vec![7_u8; 37]).unwrap();
        let mut transfer = TransferSnapshot {
            id: "resume-me".to_owned(),
            release_id: None,
            release_title: None,
            release_folder: None,
            file_index: None,
            file_count: None,
            expected_track_count: None,
            release_group_id: None,
            title: "Track.flac".to_owned(),
            username: "peer".to_owned(),
            remote_filename: "Music\\Track.flac".to_owned(),
            size_bytes: 100,
            transferred_bytes: 0,
            speed_bytes_per_second: 0,
            eta_seconds: None,
            status: TransferStatus::Queued,
            queue_position: None,
            local_path: final_path.to_string_lossy().into_owned(),
            error: None,
            retry_count: 0,
            retry_at_ms: None,
            waiting_since_ms: None,
            verification_status: VerificationStatus::Pending,
            verification_message: None,
            verified_at_ms: None,
            filed_at_ms: None,
            soundcheck: None,
            patch_repair: None,
            alternative_sources: Vec::new(),
            created_at_ms: 1,
            updated_at_ms: 2,
            connection_token: Some(77),
            transfer_token: Some(88),
        };
        refresh_partial_size(&mut transfer);
        assert_eq!(transfer.transferred_bytes, 37);

        let store_path = directory.path().join("transfers.json");
        let serialized = serde_json::to_vec_pretty(&TransferStore {
            version: STORE_VERSION,
            max_concurrent_downloads: DEFAULT_MAX_CONCURRENT_DOWNLOADS,
            relay_suggestion_minutes: DEFAULT_RELAY_SUGGESTION_MINUTES,
            soundcheck_enabled: true,
            transfers: vec![transfer],
        })
        .unwrap();
        fs::write(&store_path, &serialized).unwrap();
        let raw = String::from_utf8(serialized).unwrap();
        assert!(!raw.contains("connectionToken"));
        assert!(!raw.contains("transferToken"));
        assert_eq!(
            load_store(&store_path).unwrap().transfers[0].transferred_bytes,
            37
        );
    }

    #[test]
    fn safe_passage_drains_only_current_file_writers() {
        let mut transfers = vec![
            release_transfer(
                "writing",
                "release-writing",
                "listener-a",
                "Music\\Writing\\01.flac",
                TransferStatus::Downloading,
                1,
            ),
            release_transfer(
                "contacting",
                "release-contacting",
                "listener-b",
                "Music\\Contacting\\01.flac",
                TransferStatus::Requesting,
                1,
            ),
            release_transfer(
                "queued",
                "release-queued",
                "listener-c",
                "Music\\Queued\\01.flac",
                TransferStatus::Queued,
                1,
            ),
            release_transfer(
                "done",
                "release-done",
                "listener-d",
                "Music\\Done\\01.flac",
                TransferStatus::Completed,
                1,
            ),
        ];
        transfers[1].connection_token = Some(42);
        transfers[1].waiting_since_ms = Some(timestamp_ms());

        prepare_transfers_for_restart(&mut transfers, TransferPreparationMode::FinishCurrentFiles);

        assert_eq!(transfers[0].status, TransferStatus::Downloading);
        assert_eq!(transfers[1].status, TransferStatus::Queued);
        assert_eq!(transfers[1].connection_token, None);
        assert_eq!(transfers[1].waiting_since_ms, None);
        assert_eq!(transfers[2].status, TransferStatus::Queued);
        assert_eq!(transfers[3].status, TransferStatus::Completed);
    }

    #[test]
    fn safe_passage_pause_requeues_every_unfinished_file() {
        let mut transfers = vec![release_transfer(
            "writing",
            "release-writing",
            "listener-a",
            "Music\\Writing\\01.flac",
            TransferStatus::Downloading,
            1,
        )];
        transfers[0].speed_bytes_per_second = 1_000;
        transfers[0].eta_seconds = Some(5);

        prepare_transfers_for_restart(&mut transfers, TransferPreparationMode::PauseNow);

        assert_eq!(transfers[0].status, TransferStatus::Queued);
        assert_eq!(transfers[0].speed_bytes_per_second, 0);
        assert_eq!(transfers[0].eta_seconds, None);
    }

    #[test]
    fn restart_reconciles_a_finalized_file_before_resuming_the_queue() {
        let directory = tempfile::tempdir().unwrap();
        let final_path = directory.path().join("finished.flac");
        fs::write(&final_path, vec![4_u8; 100]).unwrap();
        let mut transfer = release_transfer(
            "renamed",
            "release-renamed",
            "listener",
            "Music\\Album\\finished.flac",
            TransferStatus::Downloading,
            1,
        );
        transfer.local_path = final_path.to_string_lossy().into_owned();
        transfer.transferred_bytes = 80;

        reconcile_transfer_after_restart(&mut transfer);

        assert_eq!(transfer.status, TransferStatus::Completed);
        assert_eq!(transfer.transferred_bytes, 100);
        assert_eq!(transfer.verification_status, VerificationStatus::Verified);
    }

    #[test]
    fn release_requests_validate_every_file_and_use_safe_unique_folders() {
        let request = EnqueueReleaseRequest {
            title: "Night: Geometry".to_owned(),
            username: "source".to_owned(),
            remote_folder: "Music\\Night Geometry".to_owned(),
            files: vec![EnqueueReleaseFileRequest {
                title: "01 - Thresholds.flac".to_owned(),
                remote_filename: "Music\\Night Geometry\\01 - Thresholds.flac".to_owned(),
                size_bytes: 112_400_000,
            }],
            expected_track_count: Some(1),
            release_group_id: None,
            alternatives: Vec::new(),
        };
        assert!(validate_release_request(&request).is_ok());

        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("Night_ Geometry")).unwrap();
        assert_eq!(
            unique_release_directory(directory.path(), &request.title, &[]),
            directory.path().join("Night_ Geometry (2)")
        );
    }

    #[test]
    fn exact_unfinished_release_sources_are_not_queued_twice() {
        let request = EnqueueReleaseRequest {
            title: "Hysteria".to_owned(),
            username: "listener".to_owned(),
            remote_folder: "Music/Hysteria".to_owned(),
            files: vec![EnqueueReleaseFileRequest {
                title: "01 - Women.flac".to_owned(),
                remote_filename: "Music\\Hysteria\\01 - Women.flac".to_owned(),
                size_bytes: 100,
            }],
            expected_track_count: Some(1),
            release_group_id: None,
            alternatives: Vec::new(),
        };
        let queued = release_transfer(
            "queued",
            "release-one",
            "Listener",
            "Music\\Hysteria\\01 - Women.flac",
            TransferStatus::Queued,
            1,
        );
        assert!(unfinished_release_uses_source(
            std::slice::from_ref(&queued),
            &request,
        ));

        let mut completed = queued;
        completed.status = TransferStatus::Completed;
        assert!(!unfinished_release_uses_source(&[completed], &request));

        let other_user = EnqueueReleaseRequest {
            username: "another-listener".to_owned(),
            ..request
        };
        assert!(!unfinished_release_uses_source(
            &[release_transfer(
                "queued",
                "release-one",
                "listener",
                "Music\\Hysteria\\01 - Women.flac",
                TransferStatus::Queued,
                1,
            )],
            &other_user,
        ));
    }

    #[test]
    fn queued_releases_move_as_persistable_file_order_blocks() {
        let mut transfers = vec![
            release_transfer(
                "one-a",
                "release-one",
                "one",
                "Music\\One\\01.flac",
                TransferStatus::Queued,
                1,
            ),
            release_transfer(
                "one-b",
                "release-one",
                "one",
                "Music\\One\\02.flac",
                TransferStatus::Queued,
                2,
            ),
            release_transfer(
                "two-a",
                "release-two",
                "two",
                "Music\\Two\\01.flac",
                TransferStatus::Queued,
                1,
            ),
            release_transfer(
                "three-a",
                "release-three",
                "three",
                "Music\\Three\\01.flac",
                TransferStatus::Queued,
                1,
            ),
        ];

        reorder_queued_release(&mut transfers, "release-three", Some("two-a")).unwrap();
        assert_eq!(
            transfers
                .iter()
                .map(|transfer| transfer.id.as_str())
                .collect::<Vec<_>>(),
            vec!["one-a", "one-b", "three-a", "two-a"]
        );

        reorder_queued_release(&mut transfers, "release-one", None).unwrap();
        assert_eq!(
            transfers
                .iter()
                .map(|transfer| transfer.id.as_str())
                .collect::<Vec<_>>(),
            vec!["three-a", "two-a", "one-a", "one-b"]
        );
    }

    #[test]
    fn active_releases_cannot_be_reordered() {
        let mut transfers = vec![release_transfer(
            "active",
            "release-active",
            "listener",
            "Music\\Active\\01.flac",
            TransferStatus::Downloading,
            1,
        )];

        assert!(matches!(
            reorder_queued_release(&mut transfers, "release-active", None),
            Err(TransferError::ReleaseNotQueued)
        ));
    }

    #[test]
    fn download_lanes_skip_busy_users_and_respect_the_configured_limit() {
        let transfers = vec![
            release_transfer(
                "active-a",
                "release-a",
                "listener-a",
                "A\\01.flac",
                TransferStatus::RemotelyQueued,
                1,
            ),
            release_transfer(
                "same-user",
                "release-b",
                "LISTENER-A",
                "B\\01.flac",
                TransferStatus::Queued,
                1,
            ),
            release_transfer(
                "other-user",
                "release-c",
                "listener-b",
                "C\\01.flac",
                TransferStatus::Queued,
                1,
            ),
        ];
        assert_eq!(next_download_index(&transfers, 3, timestamp_ms()), Some(2));
        assert_eq!(next_download_index(&transfers, 1, timestamp_ms()), None);
    }

    #[test]
    fn queued_release_cannot_be_inserted_inside_an_active_release() {
        let mut transfers = vec![
            release_transfer(
                "active-current",
                "release-active",
                "active-listener",
                "Music\\Active\\01.flac",
                TransferStatus::Downloading,
                1,
            ),
            release_transfer(
                "active-next",
                "release-active",
                "active-listener",
                "Music\\Active\\02.flac",
                TransferStatus::Queued,
                2,
            ),
            release_transfer(
                "queued",
                "release-queued",
                "queued-listener",
                "Music\\Queued\\01.flac",
                TransferStatus::Queued,
                1,
            ),
        ];

        assert!(matches!(
            reorder_queued_release(&mut transfers, "release-queued", Some("active-next")),
            Err(TransferError::InvalidReleaseOrder)
        ));
    }

    #[test]
    fn completed_files_are_verified_without_modifying_their_contents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("01.flac");
        fs::write(&path, vec![9_u8; 100]).unwrap();
        let mut transfer = release_transfer(
            "verified",
            "release-verified",
            "listener",
            "Music\\Album\\01.flac",
            TransferStatus::Completed,
            1,
        );
        transfer.local_path = path.to_string_lossy().into_owned();
        refresh_verification(&mut transfer);
        assert_eq!(transfer.verification_status, VerificationStatus::Verified);
        assert_eq!(fs::read(&path).unwrap(), vec![9_u8; 100]);

        fs::remove_file(&path).unwrap();
        refresh_verification(&mut transfer);
        assert_eq!(transfer.verification_status, VerificationStatus::Missing);

        fs::write(&path, vec![9_u8; 60]).unwrap();
        refresh_verification(&mut transfer);
        assert_eq!(
            transfer.verification_status,
            VerificationStatus::SizeMismatch
        );
    }

    #[test]
    fn alternative_sources_prefer_exact_filename_and_size_matches() {
        let transfer = release_transfer(
            "track",
            "release",
            "first",
            "Music\\Album\\01 - Signal.flac",
            TransferStatus::Failed,
            1,
        );
        let source = ReleaseAlternativeSource {
            username: "second".to_owned(),
            remote_folder: "Archive\\Album".to_owned(),
            files: vec![
                ReleaseAlternativeFile {
                    title: "wrong-size".to_owned(),
                    remote_filename: "Archive\\Album\\01 - Signal.flac".to_owned(),
                    size_bytes: 99,
                },
                ReleaseAlternativeFile {
                    title: "exact".to_owned(),
                    remote_filename: "Archive\\Album\\01 - Signal.flac".to_owned(),
                    size_bytes: 100,
                },
            ],
        };
        assert_eq!(
            matching_alternative_file(&transfer, &source)
                .map(|(file, exact)| (file.title.as_str(), exact)),
            Some(("exact", true))
        );
    }

    #[test]
    fn relay_sources_restart_non_identical_partial_files() {
        let transfer = release_transfer(
            "track",
            "release",
            "first",
            "Music\\Album\\01 - Signal.flac",
            TransferStatus::RemotelyQueued,
            1,
        );
        let renamed = ReleaseAlternativeSource {
            username: "second".to_owned(),
            remote_folder: "Archive\\Album".to_owned(),
            files: vec![ReleaseAlternativeFile {
                title: "01 Signal.flac".to_owned(),
                remote_filename: "Archive\\Album\\01 Signal.flac".to_owned(),
                size_bytes: 120,
            }],
        };
        assert_eq!(
            matching_alternative_file(&transfer, &renamed)
                .map(|(file, exact)| (file.title.as_str(), exact)),
            Some(("01 Signal.flac", false))
        );
    }

    #[test]
    fn transfer_store_defaults_signal_relay_to_ten_minutes() {
        let value = serde_json::json!({
            "version": STORE_VERSION,
            "max_concurrent_downloads": 3,
            "transfers": []
        });
        let store: TransferStore = serde_json::from_value(value).unwrap();
        assert_eq!(store.relay_suggestion_minutes, 10);
        assert!(RELAY_SUGGESTION_MINUTES.contains(&0));
        assert!(RELAY_SUGGESTION_MINUTES.contains(&30));
    }

    #[test]
    fn completed_releases_can_be_marked_filed_and_reopened() {
        let mut transfers = vec![
            release_transfer(
                "one",
                "release-arrival",
                "listener",
                "Album\\01.flac",
                TransferStatus::Completed,
                1,
            ),
            release_transfer(
                "two",
                "release-arrival",
                "listener",
                "Album\\02.flac",
                TransferStatus::Completed,
                2,
            ),
        ];

        set_release_filed_state(&mut transfers, "release-arrival", true, 42).unwrap();
        assert!(transfers
            .iter()
            .all(|transfer| transfer.filed_at_ms == Some(42)));
        assert_eq!(transfers[0].updated_at_ms, 1);
        assert_eq!(transfers[1].updated_at_ms, 2);

        set_release_filed_state(&mut transfers, "release-arrival", false, 43).unwrap();
        assert!(transfers
            .iter()
            .all(|transfer| transfer.filed_at_ms.is_none()));

        transfers[0].status = TransferStatus::Queued;
        assert!(matches!(
            set_release_filed_state(&mut transfers, "release-arrival", true, 44),
            Err(TransferError::ReleaseNotCompleted)
        ));
    }

    #[test]
    fn arrival_history_removes_only_selected_completed_releases() {
        let mut transfers = vec![
            release_transfer(
                "filed",
                "release-filed",
                "listener",
                "Filed\\01.flac",
                TransferStatus::Completed,
                1,
            ),
            release_transfer(
                "kept",
                "release-kept",
                "listener",
                "Kept\\01.flac",
                TransferStatus::Completed,
                1,
            ),
        ];

        remove_completed_release_history(&mut transfers, &["release-filed".to_owned()]).unwrap();

        assert_eq!(transfers.len(), 1);
        assert_eq!(transfers[0].release_id.as_deref(), Some("release-kept"));
    }

    #[test]
    fn automatic_recovery_uses_three_bounded_delays() {
        assert_eq!(automatic_retry_delay_ms(1), 5_000);
        assert_eq!(automatic_retry_delay_ms(2), 15_000);
        assert_eq!(automatic_retry_delay_ms(3), 45_000);
        assert_eq!(MAX_AUTOMATIC_RETRIES, 3);
    }
}
