use super::protocol::FolderContentsResponse;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::sync::oneshot;

#[derive(Clone, Debug)]
pub struct FolderTicket {
    pub connection_token: u32,
    pub folder_token: u32,
    pub username: String,
    pub folder: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFileSnapshot {
    pub remote_filename: String,
    pub directory: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub bitrate: Option<u32>,
    pub duration_seconds: Option<u32>,
    pub vbr: Option<bool>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInspection {
    pub token: u32,
    pub username: String,
    pub requested_folder: String,
    pub files: Vec<FolderFileSnapshot>,
    pub received_at_ms: u64,
}

struct PendingFolder {
    ticket: FolderTicket,
    claimed: bool,
    response: oneshot::Sender<Result<FolderInspection, FolderError>>,
}

#[derive(Clone, Default)]
pub struct FolderHub {
    pending: Arc<Mutex<HashMap<u32, PendingFolder>>>,
}

impl FolderHub {
    pub fn start(
        &self,
        ticket: FolderTicket,
    ) -> oneshot::Receiver<Result<FolderInspection, FolderError>> {
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                ticket.folder_token,
                PendingFolder {
                    ticket,
                    claimed: false,
                    response: sender,
                },
            );
        receiver
    }

    pub fn requesting_for_username(&self, username: &str) -> Option<FolderTicket> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .find(|pending| {
                !pending.claimed && pending.ticket.username.eq_ignore_ascii_case(username)
            })
            .map(|pending| pending.ticket.clone())
    }

    pub fn claim_peer(&self, connection_token: u32) -> Option<FolderTicket> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let request = pending
            .values_mut()
            .find(|request| request.ticket.connection_token == connection_token)?;
        if request.claimed {
            return None;
        }
        request.claimed = true;
        Some(request.ticket.clone())
    }

    pub fn resolve(&self, username: &str, response: FolderContentsResponse) -> bool {
        let pending = {
            let mut requests = self
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(request) = requests.get(&response.token) else {
                return false;
            };
            if !request.ticket.username.eq_ignore_ascii_case(username)
                || normalize_remote_path(&request.ticket.folder)
                    != normalize_remote_path(&response.requested_folder)
            {
                return false;
            }
            requests.remove(&response.token)
        };
        let Some(pending) = pending else {
            return false;
        };

        let mut files = Vec::new();
        for folder in response.folders {
            let directory = normalize_remote_path(if folder.directory.trim().is_empty() {
                &response.requested_folder
            } else {
                &folder.directory
            });
            for file in folder.files {
                let normalized_file = normalize_remote_path(&file.filename);
                let filename = basename(&normalized_file);
                let remote_filename = if directory.is_empty()
                    || normalized_file.eq_ignore_ascii_case(&directory)
                    || normalized_file
                        .to_ascii_lowercase()
                        .starts_with(&format!("{}\\", directory.to_ascii_lowercase()))
                {
                    normalized_file
                } else {
                    format!("{directory}\\{normalized_file}")
                };
                if files.iter().any(|existing: &FolderFileSnapshot| {
                    existing
                        .remote_filename
                        .eq_ignore_ascii_case(&remote_filename)
                }) {
                    continue;
                }
                files.push(FolderFileSnapshot {
                    remote_filename,
                    directory: directory.clone(),
                    filename,
                    size_bytes: file.size_bytes,
                    extension: file.extension,
                    bitrate: file.bitrate,
                    duration_seconds: file.duration_seconds,
                    vbr: file.vbr,
                    sample_rate: file.sample_rate,
                    bit_depth: file.bit_depth,
                });
            }
        }
        files.sort_by(|left, right| {
            left.remote_filename
                .to_ascii_lowercase()
                .cmp(&right.remote_filename.to_ascii_lowercase())
        });

        let inspection = FolderInspection {
            token: response.token,
            username: pending.ticket.username,
            requested_folder: normalize_remote_path(&response.requested_folder),
            files,
            received_at_ms: timestamp_ms(),
        };
        let _ = pending.response.send(Ok(inspection));
        true
    }

    pub fn fail_connection(&self, connection_token: u32, message: String) -> bool {
        let token = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find(|(_, pending)| pending.ticket.connection_token == connection_token)
            .map(|(token, _)| *token);
        token.is_some_and(|token| self.fail_folder_token(token, message))
    }

    pub fn fail_folder_token(&self, folder_token: u32, message: String) -> bool {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&folder_token);
        if let Some(pending) = pending {
            let _ = pending.response.send(Err(FolderError::Request(message)));
            true
        } else {
            false
        }
    }

    pub fn connection_lost(&self) {
        let pending = std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        for (_, request) in pending {
            let _ = request.response.send(Err(FolderError::Request(
                "The Soulseek connection was interrupted while browsing the folder.".to_owned(),
            )));
        }
    }
}

fn normalize_remote_path(value: &str) -> String {
    value.replace('/', "\\").trim_matches('\\').to_owned()
}

fn basename(value: &str) -> String {
    normalize_remote_path(value)
        .rsplit('\\')
        .next()
        .unwrap_or("file")
        .to_owned()
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[derive(Clone, Debug, Error)]
pub enum FolderError {
    #[error("{0}")]
    Request(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::protocol::{FolderFile, FolderListing};

    #[tokio::test]
    async fn folder_responses_are_flattened_deduplicated_and_sorted() {
        let hub = FolderHub::default();
        let receiver = hub.start(FolderTicket {
            connection_token: 10,
            folder_token: 20,
            username: "source".to_owned(),
            folder: "Music\\Album".to_owned(),
        });
        let file = FolderFile {
            filename: "02 - Song.flac".to_owned(),
            size_bytes: 100,
            extension: "flac".to_owned(),
            bitrate: Some(2_304),
            duration_seconds: Some(180),
            vbr: Some(false),
            sample_rate: Some(96_000),
            bit_depth: Some(24),
        };
        assert!(hub.resolve(
            "source",
            FolderContentsResponse {
                token: 20,
                requested_folder: "Music\\Album".to_owned(),
                folders: vec![FolderListing {
                    directory: "Music\\Album".to_owned(),
                    files: vec![file.clone(), file],
                }],
            }
        ));
        let inspection = receiver.await.unwrap().unwrap();
        assert_eq!(inspection.files.len(), 1);
        assert_eq!(
            inspection.files[0].remote_filename,
            "Music\\Album\\02 - Song.flac"
        );
    }
}
