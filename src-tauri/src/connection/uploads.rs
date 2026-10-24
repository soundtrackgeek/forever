use super::{
    local_shares::IndexedFile,
    store::{self, DecodeError, JsonFile},
    upload_policy::{FairScheduler, UploadPolicy},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const UPLOAD_EVENT: &str = "forever://uploads";
const MAX_UPLOAD_QUEUE: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UploadStatus {
    Queued,
    Connecting,
    Uploading,
    Completed,
    Failed,
    Cancelled,
}

impl UploadStatus {
    pub(super) fn occupies_slot(self) -> bool {
        matches!(self, Self::Connecting | Self::Uploading)
    }

    fn finished(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSnapshot {
    pub id: String,
    pub username: String,
    pub remote_filename: String,
    pub filename: String,
    pub size_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub status: UploadStatus,
    pub queue_position: Option<u32>,
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(skip)]
    local_path: PathBuf,
    #[serde(skip)]
    connection_token: Option<u32>,
    #[serde(skip)]
    file_connection_token: Option<u32>,
    #[serde(skip)]
    transfer_token: Option<u32>,
    #[serde(skip)]
    control_claimed: bool,
    #[serde(skip)]
    file_claimed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQueueSnapshot {
    pub uploads: Vec<UploadSnapshot>,
    pub active_count: usize,
    pub queued_count: usize,
    pub session_uploaded_bytes: u64,
    pub persistence_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct UploadTicket {
    pub id: String,
    pub username: String,
    pub remote_filename: String,
    pub size_bytes: u64,
    pub local_path: PathBuf,
    pub connection_token: u32,
    pub transfer_token: u32,
}

type UploadTasks = HashMap<(String, u32), Arc<AtomicBool>>;

#[derive(Clone)]
pub struct UploadHub {
    publish_snapshot: Arc<dyn Fn(UploadQueueSnapshot) + Send + Sync>,
    path: JsonFile,
    scheduler: Arc<Mutex<FairScheduler>>,
    persistence_error: Arc<Mutex<Option<String>>>,
    uploads: Arc<RwLock<Vec<UploadSnapshot>>>,
    tasks: Arc<Mutex<UploadTasks>>,
    next_id: Arc<AtomicU64>,
    next_transfer_token: Arc<AtomicU32>,
}

impl UploadHub {
    pub fn active_count(&self) -> usize {
        self.uploads
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .filter(|u| u.status.occupies_slot())
            .count()
    }

    pub fn new(app: AppHandle, path: JsonFile, policy: UploadPolicy) -> Self {
        Self::load(
            Arc::new(move |snapshot| {
                let _ = app.emit(UPLOAD_EVENT, snapshot);
            }),
            path,
            policy,
        )
    }

    pub(super) fn load(
        publish_snapshot: Arc<dyn Fn(UploadQueueSnapshot) + Send + Sync>,
        path: JsonFile,
        policy: UploadPolicy,
    ) -> Self {
        let saved = path.load(UploadStore::default, decode_store);
        let scheduler = FairScheduler {
            served: saved.served,
            policy,
            ..FairScheduler::default()
        };
        let mut uploads = saved.uploads;
        for upload in &mut uploads {
            reset_pending(upload);
        }
        scheduler.refresh_positions(&mut uploads);
        Self {
            publish_snapshot,
            path,
            scheduler: Arc::new(Mutex::new(scheduler)),
            persistence_error: Arc::new(Mutex::new(None)),
            uploads: Arc::new(RwLock::new(uploads)),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(timestamp_ms())),
            next_transfer_token: Arc::new(AtomicU32::new(
                (timestamp_ms() as u32).wrapping_add(0x6000).max(1),
            )),
        }
    }

    pub fn snapshot(&self) -> UploadQueueSnapshot {
        let uploads = self
            .uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut snapshot = snapshot_from(&uploads);
        snapshot.persistence_error = self
            .persistence_error
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        snapshot
    }

    pub fn has_free_slot(&self, slots: usize) -> bool {
        self.uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|upload| upload.status.occupies_slot())
            .count()
            < slots
    }

    pub fn queued_count(&self) -> u32 {
        self.uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|upload| upload.status == UploadStatus::Queued)
            .count()
            .try_into()
            .unwrap_or(u32::MAX)
    }

    pub fn enqueue(
        &self,
        username: &str,
        file: IndexedFile,
    ) -> Result<UploadQueueSnapshot, UploadError> {
        if username.trim().is_empty() || username.len() > 100 {
            return Err(UploadError::InvalidPeer);
        }
        if file.remote_filename.is_empty() || file.remote_filename.len() > 32768 {
            return Err(UploadError::ChangedFile);
        }
        {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if uploads.iter().any(|upload| {
                !upload.status.finished()
                    && upload.username.eq_ignore_ascii_case(username)
                    && upload
                        .remote_filename
                        .eq_ignore_ascii_case(&file.remote_filename)
            }) {
                let mut snapshot = snapshot_from(&uploads);
                snapshot.persistence_error = self
                    .persistence_error
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .clone();
                return Ok(snapshot);
            }
            if uploads
                .iter()
                .filter(|upload| !upload.status.finished())
                .count()
                >= MAX_UPLOAD_QUEUE
            {
                return Err(UploadError::QueueFull);
            }
            let policy = self
                .scheduler
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .policy
                .clone();
            check_user_limits(&uploads, username, file.size_bytes, &policy)?;
            let now = timestamp_ms();
            let id_number = self.next_id.fetch_add(1, Ordering::SeqCst);
            uploads.push(UploadSnapshot {
                id: format!("upload-{now}-{id_number}"),
                username: username.to_owned(),
                remote_filename: file.remote_filename,
                filename: file.filename,
                size_bytes: file.size_bytes,
                transferred_bytes: 0,
                speed_bytes_per_second: 0,
                eta_seconds: None,
                status: UploadStatus::Queued,
                queue_position: None,
                error: None,
                created_at_ms: now,
                updated_at_ms: now,
                local_path: file.local_path,
                connection_token: None,
                file_connection_token: None,
                transfer_token: None,
                control_claimed: false,
                file_claimed: false,
            });
            self.refresh_queue_positions(&mut uploads);
            if let Err(error) = self.persist(&uploads) {
                uploads.pop();
                self.refresh_queue_positions(&mut uploads);
                drop(uploads);
                self.publish();
                return Err(error);
            }
        }
        self.publish();
        Ok(self.snapshot())
    }

    pub fn queue_position(&self, username: &str, remote_filename: &str) -> Option<u32> {
        self.uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|upload| {
                !upload.status.finished()
                    && upload.username.eq_ignore_ascii_case(username)
                    && upload.remote_filename.eq_ignore_ascii_case(remote_filename)
            })
            .map(|upload| upload.queue_position.unwrap_or(0))
    }

    pub fn activate_next(&self, connection_token: u32, slots: usize) -> Option<UploadTicket> {
        let ticket = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if uploads
                .iter()
                .filter(|upload| upload.status.occupies_slot())
                .count()
                >= slots
            {
                return None;
            }
            let previous_turn = self
                .scheduler
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .served
                .clone();
            let index = self
                .scheduler
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .take_next(&uploads)?;
            let previous = uploads[index].clone();
            let upload = &mut uploads[index];
            let transfer_token = self.take_transfer_token();
            upload.status = UploadStatus::Connecting;
            upload.connection_token = Some(connection_token);
            upload.transfer_token = Some(transfer_token);
            upload.control_claimed = false;
            upload.file_claimed = false;
            upload.queue_position = None;
            upload.error = None;
            upload.updated_at_ms = timestamp_ms();
            let ticket = ticket_from(upload, connection_token, transfer_token);
            self.refresh_queue_positions(&mut uploads);
            if self.persist(&uploads).is_err() {
                uploads[index] = previous;
                self.scheduler
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .served = previous_turn;
                self.refresh_queue_positions(&mut uploads);
                drop(uploads);
                self.publish();
                return None;
            }
            ticket
        };
        self.publish();
        Some(ticket)
    }

    pub fn requesting_control_for_username(&self, username: &str) -> Option<UploadTicket> {
        self.uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|upload| {
                upload.status == UploadStatus::Connecting
                    && !upload.control_claimed
                    && upload.file_connection_token.is_none()
                    && upload.username.eq_ignore_ascii_case(username)
            })
            .and_then(|upload| {
                Some(ticket_from(
                    upload,
                    upload.connection_token?,
                    upload.transfer_token?,
                ))
            })
    }

    pub fn claim_control(&self, connection_token: u32) -> Option<UploadTicket> {
        let ticket = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let upload = uploads.iter_mut().find(|upload| {
                upload.status == UploadStatus::Connecting
                    && !upload.control_claimed
                    && upload.connection_token == Some(connection_token)
            })?;
            upload.control_claimed = true;
            upload.updated_at_ms = timestamp_ms();
            let transfer_token = upload.transfer_token?;
            ticket_from(upload, connection_token, transfer_token)
        };
        self.publish();
        Some(ticket)
    }

    pub fn prepare_file_connection(&self, id: &str, connection_token: u32) -> Option<UploadTicket> {
        let ticket = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let upload = uploads
                .iter_mut()
                .find(|upload| upload.id == id && upload.status == UploadStatus::Connecting)?;
            upload.file_connection_token = Some(connection_token);
            upload.file_claimed = false;
            upload.updated_at_ms = timestamp_ms();
            let transfer_token = upload.transfer_token?;
            ticket_from(upload, connection_token, transfer_token)
        };
        self.publish();
        Some(ticket)
    }

    pub fn requesting_file_for_username(&self, username: &str) -> Option<UploadTicket> {
        self.uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|upload| {
                upload.status == UploadStatus::Connecting
                    && !upload.file_claimed
                    && upload.file_connection_token.is_some()
                    && upload.username.eq_ignore_ascii_case(username)
            })
            .and_then(|upload| {
                Some(ticket_from(
                    upload,
                    upload.file_connection_token?,
                    upload.transfer_token?,
                ))
            })
    }

    pub fn claim_file(&self, connection_token: u32) -> Option<UploadTicket> {
        let ticket = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let upload = uploads.iter_mut().find(|upload| {
                upload.status == UploadStatus::Connecting
                    && !upload.file_claimed
                    && upload.file_connection_token == Some(connection_token)
            })?;
            upload.file_claimed = true;
            upload.updated_at_ms = timestamp_ms();
            let transfer_token = upload.transfer_token?;
            ticket_from(upload, connection_token, transfer_token)
        };
        self.publish();
        Some(ticket)
    }

    pub fn begin_file(
        &self,
        id: &str,
        transfer_token: u32,
        file: IndexedFile,
    ) -> Result<UploadTicket, UploadError> {
        let ticket = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let upload = uploads
                .iter_mut()
                .find(|upload| upload.id == id && upload.status == UploadStatus::Connecting)
                .ok_or(UploadError::NotFound)?;
            if upload.transfer_token != Some(transfer_token) || file.size_bytes != upload.size_bytes
            {
                return Err(UploadError::ChangedFile);
            }
            upload.local_path = file.local_path;
            let metadata = fs::metadata(&upload.local_path)?;
            if !metadata.is_file() || metadata.len() != upload.size_bytes {
                return Err(UploadError::ChangedFile);
            }
            upload.status = UploadStatus::Uploading;
            upload.speed_bytes_per_second = 0;
            upload.eta_seconds = None;
            upload.updated_at_ms = timestamp_ms();
            let connection_token = upload.file_connection_token.unwrap_or_default();
            let transfer_token = upload.transfer_token.ok_or(UploadError::NotFound)?;
            ticket_from(upload, connection_token, transfer_token)
        };
        self.publish();
        Ok(ticket)
    }

    pub fn update_progress(&self, id: &str, transfer_token: u32, transferred: u64, speed: u64) {
        {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(upload) = uploads.iter_mut().find(|upload| upload.id == id) {
                if upload.status == UploadStatus::Uploading
                    && upload.transfer_token == Some(transfer_token)
                {
                    upload.transferred_bytes = transferred.min(upload.size_bytes);
                    upload.speed_bytes_per_second = speed;
                    upload.eta_seconds = (speed > 0).then(|| {
                        upload
                            .size_bytes
                            .saturating_sub(upload.transferred_bytes)
                            .div_ceil(speed)
                    });
                    upload.updated_at_ms = timestamp_ms();
                }
            }
        }
        self.publish();
    }

    pub fn complete(&self, id: &str, transfer_token: u32) -> bool {
        self.finish(id, UploadStatus::Completed, None, Some(transfer_token))
    }

    pub fn fail_connection(&self, connection_token: u32, message: String) -> bool {
        let attempt = self
            .uploads
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .find(|u| {
                u.status == UploadStatus::Connecting
                    && (u.connection_token == Some(connection_token)
                        || u.file_connection_token == Some(connection_token))
            })
            .and_then(|u| Some((u.id.clone(), u.transfer_token?)));
        attempt.is_some_and(|(id, token)| self.fail_attempt(&id, token, message))
    }

    pub fn cancel(&self, id: &str) -> Result<UploadQueueSnapshot, UploadError> {
        let finished = self
            .uploads
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|upload| upload.id == id)
            .map(|upload| upload.status.finished())
            .ok_or(UploadError::NotFound)?;
        if finished {
            self.uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|upload| upload.id != id);
            self.publish();
            return Ok(self.snapshot());
        }
        if !self.finish(id, UploadStatus::Cancelled, None, None) {
            return Err(UploadError::NotFound);
        }
        Ok(self.snapshot())
    }

    pub fn clear_finished(&self) -> UploadQueueSnapshot {
        {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            uploads.retain(|upload| !upload.status.finished());
            self.refresh_queue_positions(&mut uploads);
            let _ = self.persist(&uploads);
        }
        self.publish();
        self.snapshot()
    }

    pub fn connection_lost(&self) {
        {
            let mut uploads = self.uploads.write().unwrap_or_else(|p| p.into_inner());
            for upload in uploads.iter_mut().filter(|u| u.status.occupies_slot()) {
                self.abort(&upload.id);
                reset_pending(upload);
            }
            self.refresh_queue_positions(&mut uploads);
            let _ = self.persist(&uploads);
        }
        self.publish();
    }

    pub fn register_task(&self, id: String, token: u32, cancellation: Arc<AtomicBool>) -> bool {
        let uploads = self.uploads.read().unwrap_or_else(|p| p.into_inner());
        if !uploads.iter().any(|u| {
            u.id == id && u.status == UploadStatus::Uploading && u.transfer_token == Some(token)
        }) {
            cancellation.store(true, Ordering::SeqCst);
            return false;
        }
        self.tasks
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert((id, token), cancellation);
        true
    }

    pub fn unregister_task(&self, id: &str, token: u32) {
        self.tasks
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&(id.to_owned(), token));
    }

    fn take_transfer_token(&self) -> u32 {
        loop {
            let token = self.next_transfer_token.fetch_add(1, Ordering::SeqCst);
            if token != 0 {
                return token;
            }
        }
    }

    fn finish(
        &self,
        id: &str,
        status: UploadStatus,
        error: Option<String>,
        transfer_token: Option<u32>,
    ) -> bool {
        let changed = {
            let mut uploads = self
                .uploads
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(upload) = uploads.iter_mut().find(|upload| upload.id == id) else {
                return false;
            };
            if transfer_token.is_some_and(|token| upload.transfer_token != Some(token)) {
                return false;
            }
            self.abort(id);
            if upload.status.finished() && status != UploadStatus::Cancelled {
                return false;
            }
            upload.status = status;
            if status == UploadStatus::Completed {
                upload.transferred_bytes = upload.size_bytes;
                upload.eta_seconds = Some(0);
            } else {
                upload.eta_seconds = None;
            }
            upload.speed_bytes_per_second = 0;
            upload.queue_position = None;
            upload.error = error;
            upload.connection_token = None;
            upload.file_connection_token = None;
            upload.transfer_token = None;
            upload.updated_at_ms = timestamp_ms();
            self.refresh_queue_positions(&mut uploads);
            let _ = self.persist(&uploads);
            true
        };
        if changed {
            self.publish();
        }
        changed
    }

    fn abort(&self, id: &str) {
        self.tasks.lock().unwrap_or_else(|p| p.into_inner()).retain(
            |(task_id, _), cancellation| {
                if task_id == id {
                    cancellation.store(true, Ordering::SeqCst);
                    false
                } else {
                    true
                }
            },
        );
    }

    pub fn set_policy(&self, policy: UploadPolicy, favorites: Vec<String>) {
        {
            let mut scheduler = self.scheduler.lock().unwrap_or_else(|p| p.into_inner());
            scheduler.policy = policy;
            scheduler.favorites = Arc::new(
                favorites
                    .into_iter()
                    .map(|u| u.to_ascii_lowercase())
                    .collect(),
            );
        }
        self.reorder();
    }

    pub fn set_privileged(&self, users: Vec<String>) {
        self.scheduler
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .privileged = Arc::new(users.into_iter().map(|u| u.to_ascii_lowercase()).collect());
        self.reorder();
    }

    fn reorder(&self) {
        self.refresh_queue_positions(&mut self.uploads.write().unwrap_or_else(|p| p.into_inner()));
        self.publish();
    }

    pub fn fail_attempt(&self, id: &str, token: u32, message: String) -> bool {
        self.finish(id, UploadStatus::Failed, Some(message), Some(token))
    }

    fn refresh_queue_positions(&self, uploads: &mut [UploadSnapshot]) {
        self.scheduler
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .refresh_positions(uploads);
    }

    pub fn retry_save(&self) {
        if self
            .persistence_error
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_none()
        {
            return;
        }
        {
            let uploads = self.uploads.write().unwrap_or_else(|p| p.into_inner());
            let _ = self.persist(&uploads);
        }
        self.publish();
    }

    fn persist(&self, uploads: &[UploadSnapshot]) -> Result<(), UploadError> {
        let pending: Vec<_> = uploads
            .iter()
            .filter(|u| !u.status.finished())
            .cloned()
            .collect();
        let users: HashSet<_> = pending
            .iter()
            .map(|u| u.username.to_ascii_lowercase())
            .collect();
        let mut scheduler = self.scheduler.lock().unwrap_or_else(|p| p.into_inner());
        scheduler.served.retain(|user| users.contains(user));
        let result = self.path.save(&UploadStore {
            version: 1,
            uploads: pending,
            served: scheduler.served.clone(),
        });
        *self
            .persistence_error
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = result.as_ref().err().map(|e| {
            format!("Upload queue could not be saved: {e}. New uploads wait until saving succeeds.")
        });
        result.map_err(UploadError::Io)
    }

    fn publish(&self) {
        (self.publish_snapshot)(self.snapshot());
    }
}

fn ticket_from(
    upload: &UploadSnapshot,
    connection_token: u32,
    transfer_token: u32,
) -> UploadTicket {
    UploadTicket {
        id: upload.id.clone(),
        username: upload.username.clone(),
        remote_filename: upload.remote_filename.clone(),
        size_bytes: upload.size_bytes,
        local_path: upload.local_path.clone(),
        connection_token,
        transfer_token,
    }
}

fn snapshot_from(uploads: &[UploadSnapshot]) -> UploadQueueSnapshot {
    UploadQueueSnapshot {
        uploads: uploads.to_vec(),
        persistence_error: None,
        active_count: uploads
            .iter()
            .filter(|upload| upload.status.occupies_slot())
            .count(),
        queued_count: uploads
            .iter()
            .filter(|upload| upload.status == UploadStatus::Queued)
            .count(),
        session_uploaded_bytes: uploads
            .iter()
            .filter(|upload| upload.status == UploadStatus::Completed)
            .map(|upload| upload.size_bytes)
            .sum(),
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

#[derive(Debug, Error)]
pub enum UploadError {
    #[error("The requesting Soulseek user is not valid.")]
    InvalidPeer,
    #[error("Too many files")]
    QueueFull,
    #[error("Too many files")]
    TooManyFiles,
    #[error("Too many megabytes")]
    TooManyMegabytes,
    #[error("That upload is no longer available.")]
    NotFound,
    #[error("The shared file changed after it was indexed. Rescan your shares.")]
    ChangedFile,
    #[error("Forever could not read the shared file: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadStore {
    version: u32,
    uploads: Vec<UploadSnapshot>,
    served: HashSet<String>,
}

impl Default for UploadStore {
    fn default() -> Self {
        Self {
            version: 1,
            uploads: Vec::new(),
            served: HashSet::new(),
        }
    }
}

fn decode_store(bytes: &[u8]) -> Result<UploadStore, DecodeError> {
    let saved: UploadStore = store::decode(bytes, 1, None, &[])?;
    if saved.uploads.len() > MAX_UPLOAD_QUEUE || saved.served.len() > MAX_UPLOAD_QUEUE {
        return Err(DecodeError::Invalid(
            "Upload queue exceeds its bounds.".into(),
        ));
    }
    let mut ids = HashSet::new();
    let mut requests = HashSet::new();
    for upload in &saved.uploads {
        if upload.username.trim().is_empty()
            || upload.username.len() > 100
            || upload.remote_filename.is_empty()
            || upload.remote_filename.len() > 32768
            || upload.status.finished()
            || !ids.insert(&upload.id)
            || !requests.insert((
                upload.username.to_ascii_lowercase(),
                upload.remote_filename.to_ascii_lowercase(),
            ))
        {
            return Err(DecodeError::Invalid("Invalid pending upload.".into()));
        }
    }
    Ok(saved)
}

fn reset_pending(upload: &mut UploadSnapshot) {
    upload.status = UploadStatus::Queued;
    upload.transferred_bytes = 0;
    upload.speed_bytes_per_second = 0;
    upload.eta_seconds = None;
    upload.connection_token = None;
    upload.file_connection_token = None;
    upload.transfer_token = None;
    upload.control_claimed = false;
    upload.file_claimed = false;
    upload.error = None;
}

fn check_user_limits(
    uploads: &[UploadSnapshot],
    username: &str,
    size: u64,
    policy: &UploadPolicy,
) -> Result<(), UploadError> {
    let pending: Vec<_> = uploads
        .iter()
        .filter(|u| !u.status.finished() && u.username.eq_ignore_ascii_case(username))
        .collect();
    if pending.len() >= policy.max_files_per_user as usize {
        return Err(UploadError::TooManyFiles);
    }
    let bytes = pending
        .iter()
        .fold(size, |total, u| total.saturating_add(u.size_bytes));
    if bytes > u64::from(policy.max_megabytes_per_user) * 1_000_000 {
        return Err(UploadError::TooManyMegabytes);
    }
    Ok(())
}

impl UploadHub {
    pub(super) fn start_session_timer(
        &self,
        sender: tokio::sync::mpsc::Sender<super::session_timer::SessionEvent>,
    ) -> super::session_timer::SessionTimer {
        super::session_timer::spawn(
            std::time::Duration::from_secs(1),
            sender,
            super::session_timer::SessionEvent::Uploads,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub(dir: &std::path::Path) -> UploadHub {
        UploadHub::load(
            Arc::new(|_| {}),
            JsonFile::new(dir.join("uploads.json")),
            UploadPolicy::default(),
        )
    }

    fn file(name: &str, bytes: u64) -> IndexedFile {
        IndexedFile {
            local_path: PathBuf::from(name),
            remote_filename: name.into(),
            filename: name.into(),
            size_bytes: bytes,
            extension: "flac".into(),
            quality: Default::default(),
        }
    }

    fn queue(hub: &UploadHub, user: &str, count: u32) {
        for i in 0..count {
            hub.enqueue(user, file(&format!("{i}.flac"), 1)).unwrap();
        }
    }

    fn positions(hub: &UploadHub) -> Vec<(String, String, Option<u32>)> {
        hub.snapshot()
            .uploads
            .into_iter()
            .filter(|u| u.status == UploadStatus::Queued)
            .map(|u| (u.username, u.remote_filename, u.queue_position))
            .collect()
    }

    #[test]
    fn one_slot_rotates_users_and_keeps_each_users_fifo() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "A", 4);
        queue(&hub, "B", 2);
        queue(&hub, "C", 1);
        let mut actual = Vec::new();
        for token in 1..=7 {
            let ticket = hub.activate_next(token, 1).unwrap();
            actual.push((ticket.username.clone(), ticket.remote_filename.clone()));
            assert!(hub.activate_next(100, 1).is_none());
            hub.complete(&ticket.id, ticket.transfer_token);
        }
        assert_eq!(
            actual,
            [
                ("A", "0.flac"),
                ("B", "0.flac"),
                ("C", "0.flac"),
                ("A", "1.flac"),
                ("B", "1.flac"),
                ("A", "2.flac"),
                ("A", "3.flac")
            ]
            .map(|(u, f)| (u.into(), f.into()))
        );
    }

    #[test]
    fn new_user_gets_a_first_slot_before_priority_user_gets_another() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        hub.set_policy(
            UploadPolicy {
                prioritize_favorites: true,
                ..UploadPolicy::default()
            },
            vec!["a".into()],
        );
        queue(&hub, "A", 4);
        assert_eq!(hub.activate_next(1, 3).unwrap().username, "A");
        queue(&hub, "B", 2);
        queue(&hub, "C", 2);
        assert_eq!(hub.activate_next(2, 3).unwrap().username, "B");
        assert_eq!(hub.activate_next(3, 3).unwrap().username, "C");
        assert!(hub.activate_next(4, 3).is_none());
    }

    #[test]
    fn priority_orders_each_round_without_starving_ordinary_users() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "ordinary", 2);
        queue(&hub, "donor", 2);
        queue(&hub, "friend", 2);
        hub.set_policy(
            UploadPolicy {
                prioritize_favorites: true,
                prioritize_privileged: true,
                ..UploadPolicy::default()
            },
            vec!["FRIEND".into()],
        );
        hub.set_privileged(vec!["DONOR".into()]);
        assert_eq!(hub.queue_position("friend", "0.flac"), Some(1));
        let mut actual = Vec::new();
        for token in 1..=6 {
            let ticket = hub.activate_next(token, 1).unwrap();
            actual.push(ticket.username.clone());
            hub.complete(&ticket.id, ticket.transfer_token);
        }
        assert_eq!(
            actual,
            ["friend", "donor", "ordinary", "friend", "donor", "ordinary"]
        );
    }

    #[test]
    fn limits_count_active_files_case_insensitively_and_duplicates_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        hub.set_policy(
            UploadPolicy {
                max_files_per_user: 2,
                max_megabytes_per_user: 1,
                ..UploadPolicy::default()
            },
            vec![],
        );
        hub.enqueue("Alice", file("one", 600_000)).unwrap();
        let active = hub.activate_next(1, 1).unwrap();
        assert_eq!(
            hub.enqueue("ALICE", file("two", 400_001))
                .unwrap_err()
                .to_string(),
            "Too many megabytes"
        );
        hub.enqueue("alice", file("two", 400_000)).unwrap();
        hub.enqueue("ALICE", file("ONE", 600_000)).unwrap();
        assert_eq!(
            hub.enqueue("aLiCe", file("three", 1))
                .unwrap_err()
                .to_string(),
            "Too many files"
        );
        hub.enqueue("bob", file("one", 1)).unwrap();
        hub.complete(&active.id, active.transfer_token);
        hub.enqueue("alice", file("three", 600_000)).unwrap();
        assert_eq!(
            hub.enqueue("huge", file("huge", u64::MAX))
                .unwrap_err()
                .to_string(),
            "Too many megabytes"
        );
    }

    #[test]
    fn concurrent_admission_cannot_exceed_user_limit() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        hub.set_policy(
            UploadPolicy {
                max_files_per_user: 3,
                ..UploadPolicy::default()
            },
            vec![],
        );
        let joins: Vec<_> = (0..16)
            .map(|i| {
                let hub = hub.clone();
                std::thread::spawn(move || hub.enqueue("A", file(&i.to_string(), 1)).is_ok())
            })
            .collect();
        assert_eq!(
            joins
                .into_iter()
                .filter_map(|j| j.join().ok())
                .filter(|ok| *ok)
                .count(),
            3
        );
        assert_eq!(hub.queued_count(), 3);
    }

    #[test]
    fn queued_order_and_round_survive_restart_without_trusting_paths_or_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let original = hub(dir.path());
        queue(&original, "A", 3);
        queue(&original, "B", 2);
        let ticket = original.activate_next(1, 1).unwrap();
        original.complete(&ticket.id, ticket.transfer_token);
        let before = positions(&original);
        let restored = hub(dir.path());
        assert_eq!(before, positions(&restored));
        let next = restored.activate_next(2, 1).unwrap();
        assert_eq!(next.username, "B");
        assert!(next.local_path.as_os_str().is_empty());
        let interrupted = hub(dir.path());
        assert_eq!(interrupted.snapshot().active_count, 0);
        assert_eq!(interrupted.queued_count(), 4);
        assert!(interrupted.claim_control(2).is_none());
        assert!(!std::fs::read_to_string(dir.path().join("uploads.json"))
            .unwrap()
            .contains("localPath"));
    }

    #[test]
    fn cancellation_is_durable_and_progress_never_writes_the_queue() {
        let dir = tempfile::tempdir().unwrap();
        let original = hub(dir.path());
        queue(&original, "A", 2);
        let ticket = original.activate_next(1, 1).unwrap();
        original.uploads.write().unwrap()[0].status = UploadStatus::Uploading;
        let before = std::fs::read(dir.path().join("uploads.json")).unwrap();
        original.update_progress(&ticket.id, ticket.transfer_token, 1, 10);
        assert_eq!(
            before,
            std::fs::read(dir.path().join("uploads.json")).unwrap()
        );
        original.cancel(&ticket.id).unwrap();
        assert_eq!(hub(dir.path()).queued_count(), 1);
        assert!(original.snapshot().uploads[0].queue_position.is_none());
    }

    #[test]
    fn failed_admission_and_activation_roll_back_and_surface_save_error() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "A", 1);
        queue(&hub, "B", 1);
        std::fs::remove_file(dir.path().join("uploads.json")).unwrap();
        std::fs::create_dir(dir.path().join("uploads.json")).unwrap();
        assert!(hub.enqueue("C", file("1", 1)).is_err());
        assert_eq!(hub.queued_count(), 2);
        assert!(hub.activate_next(1, 1).is_none());
        assert!(hub.snapshot().persistence_error.is_some());
        assert_eq!(hub.queue_position("A", "0.flac"), Some(1));
        std::fs::remove_dir(dir.path().join("uploads.json")).unwrap();
        assert_eq!(hub.activate_next(2, 1).unwrap().username, "A");
        assert!(hub.snapshot().persistence_error.is_none());
    }

    #[test]
    fn corruption_recovers_backup_and_future_versions_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let original = hub(dir.path());
        queue(&original, "A", 2);
        let path = dir.path().join("uploads.json");
        std::fs::write(&path, b"{broken").unwrap();
        let restored = hub(dir.path());
        assert_eq!(restored.queued_count(), 1);
        assert_eq!(restored.path.notices().len(), 2);
        let future = br#"{"version":99,"uploads":[]}"#;
        std::fs::write(&path, future).unwrap();
        let restored = hub(dir.path());
        assert!(restored.enqueue("B", file("1", 1)).is_err());
        assert_eq!(std::fs::read(path).unwrap(), future);
    }

    #[test]
    fn reconnect_rejects_old_completion_progress_failure_and_task_registration() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "A", 1);
        let old = hub.activate_next(1, 1).unwrap();
        hub.connection_lost();
        let new = hub.activate_next(2, 1).unwrap();
        hub.uploads.write().unwrap()[0].status = UploadStatus::Uploading;
        let cancellation = Arc::new(AtomicBool::new(false));
        assert!(hub.register_task(new.id.clone(), new.transfer_token, cancellation.clone()));
        assert!(!hub.register_task(
            old.id.clone(),
            old.transfer_token,
            Arc::new(AtomicBool::new(false))
        ));
        assert!(!hub.complete(&old.id, old.transfer_token));
        assert!(!hub.fail_attempt(&old.id, old.transfer_token, "stale".into()));
        hub.update_progress(&old.id, old.transfer_token, 1, 100);
        hub.unregister_task(&old.id, old.transfer_token);
        assert_eq!(hub.snapshot().uploads[0].transferred_bytes, 0);
        hub.cancel(&new.id).unwrap();
        assert!(cancellation.load(Ordering::SeqCst));
    }

    #[test]
    fn final_file_validation_rejects_changed_size_and_wrong_request() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "A", 1);
        let ticket = hub.activate_next(1, 1).unwrap();
        assert!(hub
            .begin_file(&ticket.id, ticket.transfer_token, file("0.flac", 2))
            .is_err());
        assert!(hub
            .begin_file(&ticket.id, ticket.transfer_token, file("another", 1))
            .is_err());
        assert_eq!(hub.snapshot().uploads[0].status, UploadStatus::Connecting);
    }

    #[test]
    fn full_queue_is_bounded_and_large_single_user_backlog_does_not_hide_others() {
        let dir = tempfile::tempdir().unwrap();
        let hub = hub(dir.path());
        queue(&hub, "A", 1);
        {
            let mut uploads = hub.uploads.write().unwrap();
            let template = uploads[0].clone();
            for i in 1..500 {
                let mut upload = template.clone();
                upload.id = format!("upload-{i}");
                upload.remote_filename = format!("{i}.flac");
                if i == 499 {
                    upload.username = "B".into();
                }
                uploads.push(upload);
            }
            hub.refresh_queue_positions(&mut uploads);
        }
        assert_eq!(hub.queue_position("B", "499.flac"), Some(2));
        assert!(matches!(
            hub.enqueue("C", file("extra", 1)),
            Err(UploadError::QueueFull)
        ));
        let first = hub.activate_next(1, 1).unwrap();
        hub.complete(&first.id, first.transfer_token);
        assert_eq!(hub.activate_next(2, 1).unwrap().username, "B");
    }

    #[test]
    fn lower_limits_preserve_accepted_requests_and_failed_terminal_saves_retry() {
        let dir = tempfile::tempdir().unwrap();
        let original = hub(dir.path());
        queue(&original, "A", 2);
        original.set_policy(
            UploadPolicy {
                max_files_per_user: 1,
                ..UploadPolicy::default()
            },
            vec![],
        );
        assert_eq!(original.queued_count(), 2);
        assert!(original.enqueue("A", file("extra", 1)).is_err());
        let ids: Vec<_> = original
            .snapshot()
            .uploads
            .iter()
            .map(|u| u.id.clone())
            .collect();
        let path = dir.path().join("uploads.json");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        for id in ids {
            original.cancel(&id).unwrap();
        }
        assert!(original.snapshot().persistence_error.is_some());
        std::fs::remove_dir(&path).unwrap();
        original.retry_save();
        assert!(original.snapshot().persistence_error.is_none());
        assert_eq!(hub(dir.path()).queued_count(), 0);
    }
}
