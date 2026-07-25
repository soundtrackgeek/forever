use super::protocol::{FolderFile, SharedFileListResponse};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::sync::oneshot;

const SHARE_SEARCH_LIMIT: usize = 500;
const SHARE_FOLDER_SEARCH_LIMIT: usize = 250;

#[derive(Clone, Debug)]
pub struct SharesTicket {
    pub connection_token: u32,
    pub username: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareDirectorySummary {
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    pub depth: u32,
    pub file_count: u32,
    pub total_size_bytes: u64,
    pub is_private: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSharesOverview {
    pub username: String,
    pub directories: Vec<ShareDirectorySummary>,
    pub total_file_count: u32,
    pub total_size_bytes: u64,
    pub public_directory_count: u32,
    pub private_directory_count: u32,
    pub received_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFileSnapshot {
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
    pub is_private: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFolderSnapshot {
    pub username: String,
    pub directory: String,
    pub is_private: bool,
    pub files: Vec<ShareFileSnapshot>,
    pub total_size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSearchSnapshot {
    pub username: String,
    pub query: String,
    pub extension: Option<String>,
    pub directories: Vec<ShareDirectorySummary>,
    pub files: Vec<ShareFileSnapshot>,
    pub truncated: bool,
}

struct CachedShares {
    overview: UserSharesOverview,
    folders: HashMap<String, ShareFolderSnapshot>,
}

struct PendingShares {
    ticket: SharesTicket,
    claimed: bool,
    response: oneshot::Sender<Result<UserSharesOverview, SharesError>>,
}

#[derive(Clone, Default)]
pub struct SharesHub {
    pending: Arc<Mutex<HashMap<u32, PendingShares>>>,
    cache: Arc<Mutex<HashMap<String, CachedShares>>>,
}

impl SharesHub {
    pub fn start(
        &self,
        ticket: SharesTicket,
    ) -> oneshot::Receiver<Result<UserSharesOverview, SharesError>> {
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                ticket.connection_token,
                PendingShares {
                    ticket,
                    claimed: false,
                    response: sender,
                },
            );
        receiver
    }

    pub fn cached(&self, username: &str) -> Option<UserSharesOverview> {
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&cache_key(username))
            .map(|cached| cached.overview.clone())
    }

    pub fn requesting_for_username(&self, username: &str) -> Option<SharesTicket> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .find(|pending| {
                !pending.claimed && pending.ticket.username.eq_ignore_ascii_case(username)
            })
            .map(|pending| pending.ticket.clone())
    }

    pub fn claim_peer(&self, connection_token: u32) -> Option<SharesTicket> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let request = pending.get_mut(&connection_token)?;
        if request.claimed {
            return None;
        }
        request.claimed = true;
        Some(request.ticket.clone())
    }

    pub fn resolve(
        &self,
        connection_token: u32,
        username: &str,
        response: SharedFileListResponse,
    ) -> bool {
        let pending = {
            let mut requests = self
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(request) = requests.get(&connection_token) else {
                return false;
            };
            if !request.ticket.username.eq_ignore_ascii_case(username) {
                return false;
            }
            requests.remove(&connection_token)
        };
        let Some(pending) = pending else {
            return false;
        };

        let received_at_ms = timestamp_ms();
        let mut folders = HashMap::new();
        for listing in response.directories {
            let directory = normalize_remote_path(&listing.directory);
            if directory.is_empty() {
                continue;
            }
            let mut seen = HashMap::<String, ShareFileSnapshot>::new();
            for file in listing.files {
                let snapshot = file_snapshot(&directory, file, listing.is_private);
                seen.entry(snapshot.remote_filename.to_ascii_lowercase())
                    .or_insert(snapshot);
            }
            let mut files: Vec<_> = seen.into_values().collect();
            files.sort_by(|left, right| {
                left.filename
                    .to_ascii_lowercase()
                    .cmp(&right.filename.to_ascii_lowercase())
            });
            let total_size_bytes = files
                .iter()
                .fold(0_u64, |total, file| total.saturating_add(file.size_bytes));
            folders.insert(
                folder_key(&directory, listing.is_private),
                ShareFolderSnapshot {
                    username: pending.ticket.username.clone(),
                    directory,
                    is_private: listing.is_private,
                    files,
                    total_size_bytes,
                },
            );
        }

        let mut directories: Vec<_> = folders
            .values()
            .map(|folder| ShareDirectorySummary {
                path: folder.directory.clone(),
                name: basename(&folder.directory),
                parent: parent_path(&folder.directory),
                depth: folder
                    .directory
                    .split('\\')
                    .count()
                    .try_into()
                    .unwrap_or(u32::MAX),
                file_count: folder.files.len().try_into().unwrap_or(u32::MAX),
                total_size_bytes: folder.total_size_bytes,
                is_private: folder.is_private,
            })
            .collect();
        directories.sort_by(|left, right| {
            left.path
                .to_ascii_lowercase()
                .cmp(&right.path.to_ascii_lowercase())
                .then(left.is_private.cmp(&right.is_private))
        });
        let total_file_count = directories.iter().fold(0_u32, |total, directory| {
            total.saturating_add(directory.file_count)
        });
        let total_size_bytes = directories.iter().fold(0_u64, |total, directory| {
            total.saturating_add(directory.total_size_bytes)
        });
        let public_directory_count = directories
            .iter()
            .filter(|directory| !directory.is_private)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let private_directory_count = directories
            .iter()
            .filter(|directory| directory.is_private)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let overview = UserSharesOverview {
            username: pending.ticket.username.clone(),
            directories,
            total_file_count,
            total_size_bytes,
            public_directory_count,
            private_directory_count,
            received_at_ms,
        };
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                cache_key(&pending.ticket.username),
                CachedShares {
                    overview: overview.clone(),
                    folders,
                },
            );
        let _ = pending.response.send(Ok(overview));
        true
    }

    pub fn folder(
        &self,
        username: &str,
        directory: &str,
    ) -> Result<ShareFolderSnapshot, SharesError> {
        let cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cached = cache
            .get(&cache_key(username))
            .ok_or(SharesError::NotCached)?;
        let normalized = normalize_remote_path(directory);
        cached
            .folders
            .get(&folder_key(&normalized, false))
            .or_else(|| cached.folders.get(&folder_key(&normalized, true)))
            .cloned()
            .ok_or(SharesError::FolderMissing)
    }

    pub fn search(
        &self,
        username: &str,
        query: &str,
        extension: Option<&str>,
    ) -> Result<ShareSearchSnapshot, SharesError> {
        let query = query.trim();
        let terms: Vec<_> = query
            .to_ascii_lowercase()
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        let extension = extension
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"))
            .map(|value| value.to_ascii_lowercase());
        let cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cached = cache
            .get(&cache_key(username))
            .ok_or(SharesError::NotCached)?;
        let directories = if terms.is_empty() {
            Vec::new()
        } else {
            cached
                .overview
                .directories
                .iter()
                .filter(|directory| {
                    let path = directory.path.to_ascii_lowercase();
                    terms.iter().all(|term| path.contains(term))
                })
                .take(SHARE_FOLDER_SEARCH_LIMIT)
                .cloned()
                .collect()
        };
        let mut files = Vec::new();
        let mut truncated = false;
        'folders: for folder in cached.folders.values() {
            for file in &folder.files {
                if extension
                    .as_ref()
                    .is_some_and(|value| !file.extension.eq_ignore_ascii_case(value))
                {
                    continue;
                }
                let haystack =
                    format!("{}\\{}", file.directory, file.filename).to_ascii_lowercase();
                if !terms.iter().all(|term| haystack.contains(term)) {
                    continue;
                }
                if files.len() >= SHARE_SEARCH_LIMIT {
                    truncated = true;
                    break 'folders;
                }
                files.push(file.clone());
            }
        }
        files.sort_by(|left, right| {
            left.remote_filename
                .to_ascii_lowercase()
                .cmp(&right.remote_filename.to_ascii_lowercase())
        });
        Ok(ShareSearchSnapshot {
            username: cached.overview.username.clone(),
            query: query.to_owned(),
            extension,
            directories,
            files,
            truncated,
        })
    }

    pub fn fail_connection(&self, connection_token: u32, message: String) -> bool {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&connection_token);
        if let Some(pending) = pending {
            let _ = pending.response.send(Err(SharesError::Request(message)));
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
            let _ = request.response.send(Err(SharesError::Request(
                "The Soulseek connection was interrupted while browsing this user's shares."
                    .to_owned(),
            )));
        }
    }
}

fn file_snapshot(directory: &str, file: FolderFile, is_private: bool) -> ShareFileSnapshot {
    let normalized_file = normalize_remote_path(&file.filename);
    let filename = basename(&normalized_file);
    let remote_filename = if normalized_file
        .to_ascii_lowercase()
        .starts_with(&format!("{}\\", directory.to_ascii_lowercase()))
    {
        normalized_file
    } else {
        format!("{directory}\\{normalized_file}")
    };
    ShareFileSnapshot {
        remote_filename,
        directory: directory.to_owned(),
        filename,
        size_bytes: file.size_bytes,
        extension: file.extension,
        bitrate: file.bitrate,
        duration_seconds: file.duration_seconds,
        vbr: file.vbr,
        sample_rate: file.sample_rate,
        bit_depth: file.bit_depth,
        is_private,
    }
}

fn normalize_remote_path(value: &str) -> String {
    value.replace('/', "\\").trim_matches('\\').to_owned()
}

fn basename(value: &str) -> String {
    normalize_remote_path(value)
        .rsplit('\\')
        .next()
        .unwrap_or("Shared folder")
        .to_owned()
}

fn parent_path(value: &str) -> Option<String> {
    normalize_remote_path(value)
        .rsplit_once('\\')
        .map(|(parent, _)| parent.to_owned())
}

fn cache_key(username: &str) -> String {
    username.trim().to_ascii_lowercase()
}

fn folder_key(directory: &str, is_private: bool) -> String {
    format!("{}\0{}", directory.to_ascii_lowercase(), is_private)
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
pub enum SharesError {
    #[error("{0}")]
    Request(String),
    #[error("Browse this user's shares before opening a folder.")]
    NotCached,
    #[error("That shared folder is no longer available.")]
    FolderMissing,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::protocol::{ShareListing, SharedFileListResponse};

    fn file(name: &str, size: u64) -> FolderFile {
        FolderFile {
            filename: name.to_owned(),
            size_bytes: size,
            extension: "flac".to_owned(),
            bitrate: Some(2_304),
            duration_seconds: Some(300),
            vbr: Some(false),
            sample_rate: Some(96_000),
            bit_depth: Some(24),
        }
    }

    #[tokio::test]
    async fn caches_summaries_and_serves_folder_and_search_views() {
        let hub = SharesHub::default();
        let receiver = hub.start(SharesTicket {
            connection_token: 10,
            username: "source".to_owned(),
        });
        assert!(hub.resolve(
            10,
            "source",
            SharedFileListResponse {
                directories: vec![
                    ShareListing {
                        directory: "Music\\Night Geometry".to_owned(),
                        files: vec![file("01 - Thresholds.flac", 100)],
                        is_private: false,
                    },
                    ShareListing {
                        directory: "Private Mixes".to_owned(),
                        files: vec![file("private.flac", 200)],
                        is_private: true,
                    },
                ],
            },
        ));
        let overview = receiver.await.unwrap().unwrap();
        assert_eq!(overview.total_file_count, 2);
        assert_eq!(overview.private_directory_count, 1);
        let folder = hub.folder("SOURCE", "Music\\Night Geometry").unwrap();
        assert_eq!(
            folder.files[0].remote_filename,
            "Music\\Night Geometry\\01 - Thresholds.flac"
        );
        let search = hub.search("source", "thresholds", Some("flac")).unwrap();
        assert_eq!(search.files.len(), 1);
        assert!(search.directories.is_empty());
        assert!(!search.truncated);

        let folder_search = hub.search("source", "night geometry", None).unwrap();
        assert_eq!(folder_search.directories.len(), 1);
        assert_eq!(folder_search.directories[0].name, "Night Geometry");
    }
}
