use super::protocol::{FolderFile, FolderListing, SearchFile, ShareListing};
use super::store::{self, DecodeError, JsonFile};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const SHARES_EVENT: &str = "forever://local-shares";
const STORE_VERSION: u32 = 2;
const MAX_SHARED_ROOTS: usize = 16;
const MAX_SHARED_FILES: usize = 250_000;
const MAX_SHARED_DIRECTORIES: usize = 50_000;
const MAX_SCAN_DEPTH: usize = 64;
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_PENDING_SEARCH_RESPONSES: usize = 256;
const SEARCH_RESPONSE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedRootConfig {
    id: String,
    path: String,
    alias: String,
    enabled: bool,
    added_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharingStore {
    version: u32,
    upload_slots: u8,
    roots: Vec<SharedRootConfig>,
}

impl Default for SharingStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            upload_slots: 1,
            roots: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRootSnapshot {
    pub id: String,
    pub path: String,
    pub alias: String,
    pub enabled: bool,
    pub file_count: u32,
    pub directory_count: u32,
    pub total_size_bytes: u64,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSharesSnapshot {
    pub roots: Vec<SharedRootSnapshot>,
    pub upload_slots: u8,
    pub scanning: bool,
    pub total_file_count: u32,
    pub total_directory_count: u32,
    pub total_size_bytes: u64,
    pub last_scan_at_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct IndexedFile {
    pub local_path: PathBuf,
    pub remote_filename: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
}

impl IndexedFile {
    pub fn folder_file(&self) -> FolderFile {
        FolderFile {
            filename: self.filename.clone(),
            size_bytes: self.size_bytes,
            extension: self.extension.clone(),
            bitrate: None,
            duration_seconds: None,
            vbr: None,
            sample_rate: None,
            bit_depth: None,
        }
    }

    pub fn search_file(&self) -> SearchFile {
        SearchFile {
            filename: self.remote_filename.clone(),
            size_bytes: self.size_bytes,
            extension: self.extension.clone(),
            bitrate: None,
            duration_seconds: None,
            vbr: None,
            sample_rate: None,
            bit_depth: None,
            is_private: false,
        }
    }
}

#[derive(Default)]
struct ShareIndex {
    files: HashMap<String, usize>,
    indexed_files: Vec<IndexedFile>,
    directories: BTreeMap<String, Vec<usize>>,
    word_index: HashMap<String, Vec<usize>>,
    roots: Vec<SharedRootSnapshot>,
    total_size_bytes: u64,
    last_scan_at_ms: Option<u64>,
    scanning: bool,
}

// One replaceable snapshot is shared by every peer task. Keep the last valid
// list across reconnects until the server replaces it (including with an empty
// list), so reconnecting cannot temporarily expose excluded paths.
#[derive(Clone, Default)]
struct ExcludedPhrases {
    current: Arc<RwLock<Arc<HashSet<String>>>>,
}

impl ExcludedPhrases {
    fn replace(&self, phrases: Vec<String>) {
        let phrases = phrases
            .into_iter()
            .filter(|phrase| !phrase.trim().is_empty())
            .map(|phrase| phrase.replace('/', "\\").to_lowercase())
            .collect();
        *self.current.write().unwrap_or_else(|p| p.into_inner()) = Arc::new(phrases);
    }

    fn snapshot(&self) -> Arc<HashSet<String>> {
        self.current
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    fn retain_search_files(&self, files: &mut Vec<SearchFile>) {
        let phrases = self.snapshot();
        files.retain(|file| path_is_visible(&file.filename, &phrases));
    }
}

fn path_is_visible(path: &str, phrases: &HashSet<String>) -> bool {
    if phrases.is_empty() {
        return true;
    }
    let path = path.replace('/', "\\").to_lowercase();
    !phrases.iter().any(|phrase| path.contains(phrase))
}

impl ShareIndex {
    fn search(&self, query: &str, phrases: &HashSet<String>) -> Vec<SearchFile> {
        matching_file_indices(self, &SearchTerms::parse(query))
            .into_iter()
            .filter_map(|file_index| self.indexed_files.get(file_index))
            .filter(|file| path_is_visible(&file.remote_filename, phrases))
            .take(MAX_SEARCH_RESULTS)
            .map(IndexedFile::search_file)
            .collect()
    }

    fn visible_folders(
        &self,
        requested: Option<&str>,
        phrases: &HashSet<String>,
    ) -> Vec<FolderListing> {
        let requested = requested.map(|path| remote_key(&normalize_remote_path(path)));
        self.directories
            .iter()
            .filter(|(directory, _)| {
                path_is_visible(directory, phrases)
                    && requested.as_ref().is_none_or(|requested| {
                        let key = remote_key(directory);
                        key == *requested || key.starts_with(&format!("{requested}\\"))
                    })
            })
            .filter_map(|(directory, files)| {
                let files: Vec<_> = files
                    .iter()
                    .filter_map(|file_index| self.indexed_files.get(*file_index))
                    .filter(|file| path_is_visible(&file.remote_filename, phrases))
                    .map(IndexedFile::folder_file)
                    .collect();
                // Do not advertise folders whose contents are all excluded.
                (!files.is_empty()).then(|| FolderListing {
                    directory: directory.clone(),
                    files,
                })
            })
            .collect()
    }
}

#[derive(Clone)]
pub struct LocalSharesHub {
    app: AppHandle,
    path: JsonFile,
    store: Arc<RwLock<SharingStore>>,
    index: Arc<RwLock<ShareIndex>>,
    next_id: Arc<AtomicU64>,
    pending_searches: Arc<Mutex<HashMap<u32, SearchResponseTicket>>>,
    excluded_phrases: ExcludedPhrases,
}

#[derive(Clone, Debug)]
pub struct SearchResponseTicket {
    pub connection_token: u32,
    pub username: String,
    pub search_token: u32,
    pub files: Vec<SearchFile>,
    pub origin: SearchResponseOrigin,
    queued_at: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchResponseOrigin {
    Server,
    Distributed,
}

impl LocalSharesHub {
    pub fn new(app: AppHandle, path: JsonFile) -> Result<Self, LocalSharesError> {
        let store = load_store(&path)?;
        let root_snapshots = store
            .roots
            .iter()
            .map(|root| SharedRootSnapshot {
                id: root.id.clone(),
                path: root.path.clone(),
                alias: root.alias.clone(),
                enabled: root.enabled,
                file_count: 0,
                directory_count: 0,
                total_size_bytes: 0,
                error: None,
            })
            .collect();
        let hub = Self {
            app,
            path,
            store: Arc::new(RwLock::new(store)),
            index: Arc::new(RwLock::new(ShareIndex {
                roots: root_snapshots,
                scanning: true,
                ..ShareIndex::default()
            })),
            next_id: Arc::new(AtomicU64::new(timestamp_ms())),
            pending_searches: Arc::new(Mutex::new(HashMap::new())),
            excluded_phrases: ExcludedPhrases::default(),
        };
        let scanner = hub.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = scanner.scan();
        });
        Ok(hub)
    }

    pub fn snapshot(&self) -> LocalSharesSnapshot {
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        LocalSharesSnapshot {
            roots: index.roots.clone(),
            upload_slots: store.upload_slots,
            scanning: index.scanning,
            total_file_count: index.indexed_files.len().try_into().unwrap_or(u32::MAX),
            total_directory_count: index.directories.len().try_into().unwrap_or(u32::MAX),
            total_size_bytes: index.total_size_bytes,
            last_scan_at_ms: index.last_scan_at_ms,
        }
    }

    pub fn upload_slots(&self) -> usize {
        usize::from(
            self.store
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .upload_slots,
        )
    }

    pub fn add_root(&self, path: &str) -> Result<LocalSharesSnapshot, LocalSharesError> {
        let canonical = canonical_directory(path)?;
        let comparison = comparable_path(&canonical);
        let mut store = self
            .store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if store.roots.len() >= MAX_SHARED_ROOTS {
            return Err(LocalSharesError::TooManyRoots);
        }
        if store.roots.iter().any(|root| {
            let existing = comparable_path(Path::new(&root.path));
            comparison == existing
                || comparison.starts_with(&format!("{existing}\\"))
                || existing.starts_with(&format!("{comparison}\\"))
        }) {
            return Err(LocalSharesError::OverlappingRoot);
        }

        let base_alias = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .map(sanitize_alias)
            .filter(|alias| !alias.is_empty())
            .unwrap_or_else(|| "Shared Music".to_owned());
        let alias = unique_alias(&base_alias, &store.roots);
        let now = timestamp_ms();
        let id = format!(
            "share-{now}-{}",
            self.next_id.fetch_add(1, Ordering::SeqCst)
        );
        store.roots.push(SharedRootConfig {
            id,
            path: canonical.to_string_lossy().into_owned(),
            alias,
            enabled: true,
            added_at_ms: now,
        });
        drop(store);
        self.persist()?;
        self.scan()
    }

    pub fn remove_root(&self, id: &str) -> Result<LocalSharesSnapshot, LocalSharesError> {
        let removed = {
            let mut store = self
                .store
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let before = store.roots.len();
            store.roots.retain(|root| root.id != id);
            store.roots.len() != before
        };
        if !removed {
            return Err(LocalSharesError::RootNotFound);
        }
        self.persist()?;
        self.scan()
    }

    pub fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<LocalSharesSnapshot, LocalSharesError> {
        let found = {
            let mut store = self
                .store
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match store.roots.iter_mut().find(|root| root.id == id) {
                Some(root) => {
                    root.enabled = enabled;
                    true
                }
                None => false,
            }
        };
        if !found {
            return Err(LocalSharesError::RootNotFound);
        }
        self.persist()?;
        self.scan()
    }

    pub fn set_upload_slots(
        &self,
        upload_slots: u8,
    ) -> Result<LocalSharesSnapshot, LocalSharesError> {
        if !(1..=3).contains(&upload_slots) {
            return Err(LocalSharesError::InvalidUploadSlots);
        }
        self.store
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .upload_slots = upload_slots;
        self.persist()?;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn scan(&self) -> Result<LocalSharesSnapshot, LocalSharesError> {
        {
            self.index
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .scanning = true;
        }
        self.publish();

        let roots = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .roots
            .clone();
        let mut next = ShareIndex {
            scanning: false,
            last_scan_at_ms: Some(timestamp_ms()),
            ..ShareIndex::default()
        };

        for root in roots {
            let mut root_snapshot = SharedRootSnapshot {
                id: root.id.clone(),
                path: root.path.clone(),
                alias: root.alias.clone(),
                enabled: root.enabled,
                file_count: 0,
                directory_count: 0,
                total_size_bytes: 0,
                error: None,
            };
            if root.enabled {
                if let Err(error) = scan_root(&root, &mut root_snapshot, &mut next) {
                    root_snapshot.error = Some(error.to_string());
                }
            }
            next.roots.push(root_snapshot);
        }
        let ShareIndex {
            indexed_files,
            directories,
            ..
        } = &mut next;
        for files in directories.values_mut() {
            files.sort_by(|left, right| {
                indexed_files[*left]
                    .filename
                    .cmp(&indexed_files[*right].filename)
            });
        }

        *self
            .index
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = next;
        self.publish();
        Ok(self.snapshot())
    }

    pub fn resolve_file(&self, remote_filename: &str) -> Option<IndexedFile> {
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        index
            .files
            .get(&remote_key(remote_filename))
            .and_then(|file_index| index.indexed_files.get(*file_index))
            .cloned()
    }

    pub fn search(&self, query: &str) -> Vec<SearchFile> {
        let phrases = self.excluded_phrases.snapshot();
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        index.search(query, &phrases)
    }

    pub fn set_excluded_phrases(&self, phrases: Vec<String>) {
        self.excluded_phrases.replace(phrases);
    }

    pub fn filter_search_response(&self, files: &mut Vec<SearchFile>) {
        self.excluded_phrases.retain_search_files(files);
    }

    pub fn share_list(&self) -> Vec<ShareListing> {
        let phrases = self.excluded_phrases.snapshot();
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        index
            .visible_folders(None, &phrases)
            .into_iter()
            .map(|folder| ShareListing {
                directory: folder.directory,
                files: folder.files,
                is_private: false,
            })
            .collect()
    }

    pub fn folder_list(&self, requested: &str) -> Vec<FolderListing> {
        let phrases = self.excluded_phrases.snapshot();
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        index.visible_folders(Some(requested), &phrases)
    }

    pub fn counts(&self) -> (u32, u32) {
        let index = self
            .index
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (
            index.directories.len().try_into().unwrap_or(u32::MAX),
            index.indexed_files.len().try_into().unwrap_or(u32::MAX),
        )
    }

    pub fn queue_search_response(
        &self,
        connection_token: u32,
        username: &str,
        search_token: u32,
        query: &str,
        origin: SearchResponseOrigin,
    ) -> Option<SearchResponseTicket> {
        let files = self.search(query);
        if files.is_empty() {
            return None;
        }
        let ticket = SearchResponseTicket {
            connection_token,
            username: username.to_owned(),
            search_token,
            files,
            origin,
            queued_at: Instant::now(),
        };
        let mut pending = self
            .pending_searches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.retain(|_, queued| queued.queued_at.elapsed() <= SEARCH_RESPONSE_TTL);
        if pending.len() >= MAX_PENDING_SEARCH_RESPONSES {
            return None;
        }
        pending.insert(connection_token, ticket.clone());
        Some(ticket)
    }

    pub fn requesting_search_for_username(&self, username: &str) -> Option<SearchResponseTicket> {
        self.pending_searches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .find(|ticket| ticket.username.eq_ignore_ascii_case(username))
            .cloned()
    }

    pub fn claim_search(&self, connection_token: u32) -> Option<SearchResponseTicket> {
        self.pending_searches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&connection_token)
    }

    pub fn fail_search(&self, connection_token: u32) {
        self.pending_searches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&connection_token);
    }

    pub fn connection_lost(&self) {
        self.pending_searches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }

    fn persist(&self) -> Result<(), LocalSharesError> {
        let store = self
            .store
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.path.save(&*store)?;
        Ok(())
    }

    fn publish(&self) {
        let _ = self.app.emit(SHARES_EVENT, self.snapshot());
    }
}

fn scan_root(
    root: &SharedRootConfig,
    snapshot: &mut SharedRootSnapshot,
    index: &mut ShareIndex,
) -> Result<(), LocalSharesError> {
    let root_path = PathBuf::from(&root.path);
    if !root_path.is_dir() {
        return Err(LocalSharesError::UnavailableRoot(root.path.clone()));
    }
    let mut stack = vec![(root_path.clone(), 0_usize)];
    let mut discovered_directories = 1_usize;
    while let Some((directory, depth)) = stack.pop() {
        if depth > MAX_SCAN_DEPTH {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                if directory == root_path {
                    return Err(error.into());
                }
                continue;
            }
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if is_hidden_name(&name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata_is_hidden(&metadata) {
                continue;
            }
            if file_type.is_dir() {
                discovered_directories = discovered_directories.saturating_add(1);
                if discovered_directories > MAX_SHARED_DIRECTORIES {
                    return Err(LocalSharesError::IndexLimit);
                }
                stack.push((path, depth + 1));
                continue;
            }
            if !file_type.is_file() || is_temporary_file(&path) {
                continue;
            }
            if metadata.len() == 0 {
                continue;
            }
            if index.files.len() >= MAX_SHARED_FILES {
                return Err(LocalSharesError::IndexLimit);
            }
            let relative = path.strip_prefix(&root_path).unwrap_or(&path);
            let Some(filename) = relative
                .file_name()
                .and_then(|value| value.to_str())
                .map(ToOwned::to_owned)
            else {
                continue;
            };
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_default();
            let relative_directory = relative.parent().unwrap_or_else(|| Path::new(""));
            let directory = if relative_directory.as_os_str().is_empty() {
                root.alias.clone()
            } else {
                format!(
                    "{}\\{}",
                    root.alias,
                    relative_directory.to_string_lossy().replace('/', "\\")
                )
            };
            if !index.directories.contains_key(&directory)
                && index.directories.len() >= MAX_SHARED_DIRECTORIES
            {
                return Err(LocalSharesError::IndexLimit);
            }
            let remote_filename = format!("{directory}\\{filename}");
            let remote_key = remote_key(&remote_filename);
            if index.files.contains_key(&remote_key) {
                continue;
            }
            let file = IndexedFile {
                local_path: path,
                remote_filename: remote_filename.clone(),
                filename,
                size_bytes: metadata.len(),
                extension,
            };
            let file_index = index.indexed_files.len();
            index.files.insert(remote_key, file_index);
            for word in search_words(&remote_filename) {
                index.word_index.entry(word).or_default().push(file_index);
            }
            index.indexed_files.push(file);
            index
                .directories
                .entry(directory)
                .or_default()
                .push(file_index);
            index.total_size_bytes = index.total_size_bytes.saturating_add(metadata.len());
            snapshot.file_count = snapshot.file_count.saturating_add(1);
            snapshot.total_size_bytes = snapshot.total_size_bytes.saturating_add(metadata.len());
        }
    }
    snapshot.directory_count = index
        .directories
        .keys()
        .filter(|directory| {
            let key = remote_key(directory);
            let alias = remote_key(&root.alias);
            key == alias || key.starts_with(&format!("{alias}\\"))
        })
        .count()
        .try_into()
        .unwrap_or(u32::MAX);
    Ok(())
}

fn load_store(path: &JsonFile) -> Result<SharingStore, LocalSharesError> {
    Ok(path.load(SharingStore::default, decode_store))
}

fn decode_store(bytes: &[u8]) -> Result<SharingStore, DecodeError> {
    let mut store: SharingStore =
        store::decode(bytes, STORE_VERSION, None, &[(1, migrate_v1_to_v2)])?;
    store.upload_slots = store.upload_slots.clamp(1, 3);
    Ok(store)
}

// Materialize the defaults introduced during v1 so v2 has an explicit schema.
fn migrate_v1_to_v2(value: serde_json::Value) -> Result<serde_json::Value, DecodeError> {
    let mut store: SharingStore = serde_json::from_value(value)?;
    store.version = 2;
    Ok(serde_json::to_value(store)?)
}

fn canonical_directory(path: &str) -> Result<PathBuf, LocalSharesError> {
    if path.trim().is_empty() {
        return Err(LocalSharesError::InvalidRoot);
    }
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(LocalSharesError::InvalidRoot);
    }
    Ok(canonical)
}

fn comparable_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn sanitize_alias(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

fn unique_alias(base: &str, roots: &[SharedRootConfig]) -> String {
    if !roots
        .iter()
        .any(|root| root.alias.eq_ignore_ascii_case(base))
    {
        return base.to_owned();
    }
    for suffix in 2..=MAX_SHARED_ROOTS + 1 {
        let candidate = format!("{base} {suffix}");
        if !roots
            .iter()
            .any(|root| root.alias.eq_ignore_ascii_case(&candidate))
        {
            return candidate;
        }
    }
    format!("{base} {}", timestamp_ms())
}

fn normalize_remote_path(value: &str) -> String {
    value.replace('/', "\\").trim_matches('\\').to_owned()
}

fn remote_key(value: &str) -> String {
    normalize_remote_path(value).to_ascii_lowercase()
}

#[derive(Default)]
struct SearchTerms {
    included: HashSet<String>,
    excluded: HashSet<String>,
    partial: HashSet<String>,
}

impl SearchTerms {
    fn parse(query: &str) -> Self {
        let mut terms = Self::default();
        for raw in query.split_whitespace() {
            let (destination, value) = if let Some(value) = raw.strip_prefix('-') {
                (&mut terms.excluded, value)
            } else if let Some(value) = raw.strip_prefix('*') {
                (&mut terms.partial, value)
            } else {
                (&mut terms.included, raw)
            };
            destination.extend(search_words(value));
        }
        terms
    }
}

fn search_words(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_lowercase())
        .collect()
}

fn matching_file_indices(index: &ShareIndex, terms: &SearchTerms) -> Vec<usize> {
    if terms.included.is_empty() {
        return Vec::new();
    }
    let mut included_lists = Vec::with_capacity(terms.included.len());
    for word in &terms.included {
        let Some(matches) = index.word_index.get(word) else {
            return Vec::new();
        };
        included_lists.push(matches);
    }
    included_lists.sort_by_key(|matches| matches.len());
    let mut matches: HashSet<usize> = included_lists[0].iter().copied().collect();
    for word_matches in included_lists.into_iter().skip(1) {
        matches.retain(|file_index| word_matches.binary_search(file_index).is_ok());
        if matches.is_empty() {
            return Vec::new();
        }
    }

    for partial in &terms.partial {
        let partial_matches: HashSet<usize> = index
            .word_index
            .iter()
            .filter(|(word, _)| word.ends_with(partial))
            .flat_map(|(_, indices)| indices.iter().copied())
            .collect();
        matches.retain(|file_index| partial_matches.contains(file_index));
        if matches.is_empty() {
            return Vec::new();
        }
    }

    for excluded in &terms.excluded {
        if let Some(excluded_matches) = index.word_index.get(excluded) {
            matches.retain(|file_index| excluded_matches.binary_search(file_index).is_err());
        }
    }

    let mut matches: Vec<usize> = matches.into_iter().collect();
    matches.sort_by(|left, right| {
        index.indexed_files[*left]
            .remote_filename
            .cmp(&index.indexed_files[*right].remote_filename)
    });
    matches
}

fn is_hidden_name(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

#[cfg(windows)]
fn metadata_is_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x2 != 0
}

#[cfg(not(windows))]
fn metadata_is_hidden(_metadata: &fs::Metadata) -> bool {
    false
}

fn is_temporary_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    name.ends_with(".part")
        || name.ends_with(".tmp")
        || name.ends_with(".temp")
        || name.ends_with(".crdownload")
        || name.ends_with('~')
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
pub enum LocalSharesError {
    #[error("Choose an existing folder to share.")]
    InvalidRoot,
    #[error("That folder overlaps another shared root. Choose only its parent or child.")]
    OverlappingRoot,
    #[error("Forever supports up to 16 shared roots.")]
    TooManyRoots,
    #[error("That shared root no longer exists.")]
    RootNotFound,
    #[error("Choose between one and three upload slots.")]
    InvalidUploadSlots,
    #[error("The share index reached its safety limit.")]
    IndexLimit,
    #[error("The shared folder is unavailable: {0}")]
    UnavailableRoot(String),
    #[error("Could not read or save sharing configuration: {0}")]
    Io(#[from] std::io::Error),
    #[error("Sharing configuration is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_for_paths(paths: &[&str]) -> ShareIndex {
        let mut index = ShareIndex::default();
        for path in paths {
            let (directory, filename) = path.rsplit_once('\\').unwrap();
            let file_index = index.indexed_files.len();
            index.files.insert(remote_key(path), file_index);
            index
                .directories
                .entry(directory.into())
                .or_default()
                .push(file_index);
            for word in search_words(path) {
                index.word_index.entry(word).or_default().push(file_index);
            }
            index.indexed_files.push(IndexedFile {
                local_path: PathBuf::from(path),
                remote_filename: (*path).into(),
                filename: filename.into(),
                size_bytes: 10,
                extension: "flac".into(),
            });
        }
        index
    }

    #[test]
    fn excluded_phrases_filter_full_paths_in_search_browse_and_folders() {
        let index = index_for_paths(&[
            "Music\\Blocked Artist\\Song.flac",
            "Music\\Allowed\\A Forbidden Song.flac",
            "Music\\Allowed\\Song.flac",
            "Music\\Allowed\\Live\\Song.flac",
            "Music\\Only Hidden\\Forbidden Song.flac",
            "Music\\Allowed Elsewhere\\Song.flac",
        ]);
        let excluded = ExcludedPhrases::default();
        excluded.replace(vec![
            "BLOCKED ARTIST".into(),
            "forbidden".into(),
            "allowed/live".into(),
        ]);
        let phrases = excluded.snapshot();
        let search = index.search("song", &phrases);
        assert_eq!(search.len(), 2);
        assert!(search
            .iter()
            .all(|file| !file.filename.contains("Forbidden")));
        let browse = index.visible_folders(None, &phrases);
        assert_eq!(browse.len(), 2);
        let folders = index.visible_folders(Some("music/allowed"), &phrases);
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].directory, "Music\\Allowed");
        assert_eq!(folders[0].files[0].filename, "Song.flac");
        assert!(index
            .visible_folders(Some("Music\\Blocked Artist"), &phrases)
            .is_empty());

        // The compressed wire counts and folder basenames must match filtering.
        use super::super::protocol::*;
        let shares: Vec<_> = browse
            .into_iter()
            .map(|folder| ShareListing {
                directory: folder.directory,
                files: folder.files,
                is_private: false,
            })
            .collect();
        let encoded = shared_file_list_response_frame(&shares).unwrap();
        let decoded = parse_shared_file_list_response(&Frame {
            code: SHARED_FILE_LIST_RESPONSE_CODE,
            payload: encoded[8..].to_vec(),
        })
        .unwrap();
        assert_eq!(decoded.directories, shares);
        let encoded = folder_contents_response_frame(7, "Music\\Allowed", &folders).unwrap();
        let decoded = parse_folder_contents_response(&Frame {
            code: FOLDER_CONTENTS_RESPONSE_CODE,
            payload: encoded[8..].to_vec(),
        })
        .unwrap();
        assert_eq!(decoded.folders, folders);
    }

    #[test]
    fn phrase_updates_replace_atomically_and_refilter_queued_responses_from_both_origins() {
        let index = index_for_paths(&["Music\\Björk\\Song.flac", "Music\\Other\\Song.flac"]);
        let excluded = ExcludedPhrases::default();
        let peer = excluded.clone();
        for origin in [
            SearchResponseOrigin::Server,
            SearchResponseOrigin::Distributed,
        ] {
            excluded.replace(vec![]);
            let mut ticket = SearchResponseTicket {
                connection_token: 1,
                username: "listener".into(),
                search_token: 2,
                files: index.search("song", &excluded.snapshot()),
                origin,
                queued_at: Instant::now(),
            };
            let old = excluded.snapshot();
            excluded.replace(vec!["BJÖRK".into(), "björk".into(), "".into(), "  ".into()]);
            assert!(old.is_empty());
            assert_eq!(peer.snapshot().len(), 1);
            peer.retain_search_files(&mut ticket.files);
            assert_eq!(ticket.files.len(), 1);
            assert_eq!(ticket.files[0].filename, "Music\\Other\\Song.flac");
            excluded.replace(vec!["song.flac".into()]);
            peer.retain_search_files(&mut ticket.files);
            assert!(ticket.files.is_empty());
            excluded.replace(vec![]);
            assert_eq!(index.search("song", &peer.snapshot()).len(), 2);
        }
        assert_eq!(index.indexed_files.len(), 2);
    }

    #[test]
    fn server_exclusions_apply_before_the_search_result_limit() {
        let paths: Vec<String> = (0..150)
            .map(|i| format!("Music\\Blocked\\Song {i:03}.flac"))
            .chain((0..120).map(|i| format!("Music\\Visible\\Song {i:03}.flac")))
            .collect();
        let index = index_for_paths(&paths.iter().map(String::as_str).collect::<Vec<_>>());
        let excluded = ExcludedPhrases::default();
        excluded.replace(vec!["blocked".into()]);
        let results = index.search("song", &excluded.snapshot());
        assert_eq!(results.len(), MAX_SEARCH_RESULTS);
        assert!(results
            .iter()
            .all(|file| file.filename.starts_with("Music\\Visible\\")));
        assert_eq!(
            index.visible_folders(None, &excluded.snapshot())[0]
                .files
                .len(),
            120
        );
    }

    #[test]
    fn corrupt_store_recovers_fixture_and_future_schema_is_write_protected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sharing.json");
        let bytes = include_bytes!("../../fixtures/stores/sharing-v1.json");
        std::fs::write(dir.path().join("sharing.json.bak"), bytes).unwrap();
        std::fs::write(&path, b"{truncated").unwrap();
        let file = JsonFile::new(path.clone());
        let recovered = load_store(&file).unwrap();
        assert_eq!(
            serde_json::to_value(&recovered).unwrap(),
            serde_json::to_value(decode_store(bytes).unwrap()).unwrap()
        );
        assert_eq!(file.notices().len(), 2);
        let future = br#"{"version":99,"future":"keep"}"#;
        std::fs::write(&path, future).unwrap();
        let file = JsonFile::new(path.clone());
        let fallback = load_store(&file).unwrap();
        assert!(file.save(&fallback).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), future);
    }

    #[test]
    fn migrates_legacy_fixture_and_keeps_original_backup() {
        let bytes = include_bytes!("../../fixtures/stores/sharing-v1.json");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sharing.json");
        std::fs::write(&path, bytes).unwrap();
        let file = JsonFile::new(path.clone());
        let store = load_store(&file).unwrap();
        assert_eq!(store.version, STORE_VERSION);
        assert_eq!(store.roots[0].alias, "My Music");
        assert!(!store.roots[0].enabled);
        assert_eq!(store.upload_slots, 2);
        assert!(file.notices().is_empty());
        assert_eq!(
            std::fs::read(dir.path().join("sharing.json.bak")).unwrap(),
            bytes
        );
        let migrated = std::fs::read(&path).unwrap();
        let again = load_store(&JsonFile::new(path)).unwrap();
        assert_eq!(
            serde_json::to_value(&store).unwrap(),
            serde_json::to_value(again).unwrap()
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&migrated).unwrap()["version"],
            STORE_VERSION
        );
    }

    #[test]
    fn aliases_are_safe_and_unique() {
        let roots = vec![SharedRootConfig {
            id: "one".to_owned(),
            path: "C:\\Music".to_owned(),
            alias: "Music".to_owned(),
            enabled: true,
            added_at_ms: 0,
        }];
        assert_eq!(sanitize_alias("My:Music?"), "My_Music_");
        assert_eq!(unique_alias("Music", &roots), "Music 2");
    }

    #[test]
    fn temporary_files_are_excluded() {
        assert!(is_temporary_file(Path::new("album.flac.part")));
        assert!(is_temporary_file(Path::new("cover.tmp")));
        assert!(!is_temporary_file(Path::new("album.flac")));
    }

    #[test]
    fn scanner_indexes_complete_release_folders_safely() {
        let root_path = std::env::temp_dir().join(format!(
            "forever-share-test-{}-{}",
            std::process::id(),
            timestamp_ms()
        ));
        fs::create_dir_all(root_path.join("Album")).unwrap();
        fs::write(root_path.join("Album").join("track.flac"), [1_u8, 2, 3]).unwrap();
        fs::write(root_path.join("Album").join("partial.flac.part"), [1_u8]).unwrap();
        fs::write(root_path.join("Album").join("cover.jpg"), [1_u8]).unwrap();
        fs::write(root_path.join("Album").join("booklet.pdf"), [1_u8]).unwrap();
        fs::write(root_path.join("Album").join("rip log"), [1_u8]).unwrap();
        fs::write(root_path.join(".hidden.flac"), [1_u8]).unwrap();

        let root = SharedRootConfig {
            id: "scan".to_owned(),
            path: root_path.to_string_lossy().into_owned(),
            alias: "Safe Music".to_owned(),
            enabled: true,
            added_at_ms: 0,
        };
        let mut snapshot = SharedRootSnapshot {
            id: root.id.clone(),
            path: root.path.clone(),
            alias: root.alias.clone(),
            enabled: true,
            file_count: 0,
            directory_count: 0,
            total_size_bytes: 0,
            error: None,
        };
        let mut index = ShareIndex::default();
        scan_root(&root, &mut snapshot, &mut index).unwrap();

        assert_eq!(snapshot.file_count, 4);
        assert!(index.files.contains_key("safe music\\album\\track.flac"));
        assert!(index.files.contains_key("safe music\\album\\cover.jpg"));
        assert!(index.files.contains_key("safe music\\album\\booklet.pdf"));
        assert!(index.files.contains_key("safe music\\album\\rip log"));
        assert_eq!(index.files.len(), 4);
        fs::remove_dir_all(root_path).unwrap();
    }

    #[test]
    fn search_index_supports_required_excluded_and_partial_words() {
        let root_path = std::env::temp_dir().join(format!(
            "forever-search-test-{}-{}",
            std::process::id(),
            timestamp_ms()
        ));
        fs::create_dir_all(root_path.join("Album")).unwrap();
        fs::write(root_path.join("Album").join("Night Geometry.flac"), [1_u8]).unwrap();
        fs::write(
            root_path.join("Album").join("Night Geometry Live.flac"),
            [1_u8],
        )
        .unwrap();
        fs::write(root_path.join("Album").join("Day Geometry.flac"), [1_u8]).unwrap();

        let root = SharedRootConfig {
            id: "search".to_owned(),
            path: root_path.to_string_lossy().into_owned(),
            alias: "Safe Music".to_owned(),
            enabled: true,
            added_at_ms: 0,
        };
        let mut snapshot = SharedRootSnapshot {
            id: root.id.clone(),
            path: root.path.clone(),
            alias: root.alias.clone(),
            enabled: true,
            file_count: 0,
            directory_count: 0,
            total_size_bytes: 0,
            error: None,
        };
        let mut index = ShareIndex::default();
        scan_root(&root, &mut snapshot, &mut index).unwrap();

        let matches = matching_file_indices(&index, &SearchTerms::parse("NIGHT geometry -live"));
        assert_eq!(matches.len(), 1);
        assert!(index.indexed_files[matches[0]]
            .remote_filename
            .ends_with("Night Geometry.flac"));

        let partial = matching_file_indices(&index, &SearchTerms::parse("night *metry"));
        assert_eq!(partial.len(), 2);
        assert!(matching_file_indices(&index, &SearchTerms::parse("-live")).is_empty());
        fs::remove_dir_all(root_path).unwrap();
    }

    #[test]
    fn remote_paths_are_normalized_without_local_roots() {
        assert_eq!(
            remote_key("\\Music/Album/Track.flac"),
            "music\\album\\track.flac"
        );
    }
}
