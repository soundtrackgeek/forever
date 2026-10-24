//! Shared JSON persistence. A store handle serializes replacement and retains the
//! last validated bytes, so a damaged primary can never rotate over a good backup.
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreNotice {
    pub store: String,
    pub message: String,
}

#[derive(Default)]
struct FileState {
    last_good: Option<Vec<u8>>,
    blocked: Option<String>,
    notices: Vec<StoreNotice>,
}

#[derive(Clone)]
pub struct JsonFile {
    path: PathBuf,
    state: Arc<Mutex<FileState>>,
}

#[derive(Debug)]
pub enum DecodeError {
    Invalid(String),
    Unsupported(u64),
}

impl From<serde_json::Error> for DecodeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Invalid(error.to_string())
    }
}

pub type Migration = (u64, fn(Value) -> Result<Value, DecodeError>);

pub fn decode<T: DeserializeOwned>(
    bytes: &[u8],
    current: u32,
    unversioned: Option<u64>,
    migrations: &[Migration],
) -> Result<T, DecodeError> {
    let mut value: Value = serde_json::from_slice(bytes)?;
    let mut version = match value.get("version") {
        Some(version) => version.as_u64(),
        None => unversioned,
    }
    .ok_or_else(|| DecodeError::Invalid("Missing or invalid store version.".into()))?;
    while version != u64::from(current) {
        let Some((_, migrate)) = migrations.iter().find(|(from, _)| *from == version) else {
            return Err(DecodeError::Unsupported(version));
        };
        value = migrate(value)?;
        version += 1;
        if value.get("version").and_then(Value::as_u64) != Some(version) {
            return Err(DecodeError::Invalid(
                "Migration did not advance one version.".into(),
            ));
        }
    }
    Ok(serde_json::from_value(value)?)
}

impl JsonFile {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Arc::new(Mutex::new(FileState::default())),
        }
    }

    pub fn is_blocked(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .blocked
            .is_some()
    }

    pub fn block_changes(&self, reason: String) {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        self.block(&mut state, reason);
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn notices(&self) -> Vec<StoreNotice> {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .notices
            .clone()
    }

    fn notice(&self, state: &mut FileState, message: String) {
        state.notices.push(StoreNotice {
            store: self
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            message,
        });
    }

    fn block(&self, state: &mut FileState, reason: String) {
        self.notice(state, format!("{reason} This store is unavailable and changes cannot be saved this session. Its files have been preserved. Restart after resolving the problem."));
        state.blocked = Some(reason);
    }

    // Recovery is deliberately non-fatal. Unknown versions and I/O failures are
    // NOT corruption: leave their bytes alone and refuse all subsequent writes.
    pub fn load<T: Serialize>(
        &self,
        empty: impl Fn() -> T,
        decode: impl Fn(&[u8]) -> Result<T, DecodeError>,
    ) -> T {
        self.load_inner(empty, decode, true)
    }

    pub fn load_preserving<T: Serialize>(
        &self,
        empty: impl Fn() -> T,
        decode: impl Fn(&[u8]) -> Result<T, DecodeError>,
    ) -> T {
        self.load_inner(empty, decode, false)
    }

    fn load_inner<T: Serialize>(
        &self,
        empty: impl Fn() -> T,
        decode: impl Fn(&[u8]) -> Result<T, DecodeError>,
        migrate: bool,
    ) -> T {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.blocked.is_some() {
            return empty();
        }
        let mut damaged = false;
        for (path, backup) in [(&self.path, false), (&suffixed(&self.path, ".bak"), true)] {
            let bytes = match fs::read(path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => {
                    self.block(
                        &mut state,
                        format!("Could not read {}: {error}.", path.display()),
                    );
                    return empty();
                }
            };
            match decode(&bytes) {
                Ok(store) => {
                    let current = match if migrate {
                        serde_json::to_vec_pretty(&store)
                    } else {
                        Ok(bytes.clone())
                    } {
                        Ok(bytes) => bytes,
                        Err(error) => {
                            self.block(
                                &mut state,
                                format!("Could not encode the loaded store: {error}."),
                            );
                            return store;
                        }
                    };
                    state.last_good = (!backup).then_some(bytes.clone());
                    // Migrate once, or repair the primary without rotating corrupt
                    // bytes over the backup. Preserve pre-migration bytes in .bak.
                    let changed = serde_json::from_slice::<Value>(&current).ok()
                        != serde_json::from_slice::<Value>(&bytes).ok();
                    if backup || changed {
                        if let Err(error) =
                            commit(&self.path, &current, state.last_good.as_deref(), |_| Ok(()))
                        {
                            self.block(
                                &mut state,
                                format!("Could not save the recovered or migrated store: {error}."),
                            );
                        } else {
                            state.last_good = Some(current);
                        }
                    }
                    if backup {
                        self.notice(&mut state, "Restored the previous saved copy. The most recent changes may be missing.".into());
                    }
                    return store;
                }
                Err(DecodeError::Unsupported(version)) => {
                    self.block(&mut state, format!("Store version {version} is not supported by this Forever version. Open it with a compatible app version."));
                    return empty();
                }
                Err(DecodeError::Invalid(reason)) => {
                    match quarantine(path, &bytes) {
                        Ok(saved) => self.notice(
                            &mut state,
                            format!(
                                "Damaged data was preserved at {} ({reason}).",
                                saved.display()
                            ),
                        ),
                        Err(error) => {
                            self.block(
                                &mut state,
                                format!("Could not preserve damaged data: {error}."),
                            );
                            return empty();
                        }
                    }
                    damaged = true;
                }
            }
        }
        state.last_good = None;
        let store = empty();
        if damaged {
            self.notice(
                &mut state,
                "No usable backup was available. Started with empty/default data for this store."
                    .into(),
            );
            match serde_json::to_vec_pretty(&store)
                .map_err(io::Error::other)
                .and_then(|bytes| {
                    commit(&self.path, &bytes, None, |_| Ok(()))?;
                    Ok(bytes)
                }) {
                Ok(bytes) => state.last_good = Some(bytes),
                Err(error) => self.block(
                    &mut state,
                    format!("Could not save the reset store: {error}."),
                ),
            }
        }
        store
    }

    pub fn save(&self, value: &impl Serialize) -> io::Result<()> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(reason) = &state.blocked {
            return Err(io::Error::other(reason.clone()));
        }
        let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        commit(&self.path, &bytes, state.last_good.as_deref(), |_| Ok(()))?;
        state.last_good = Some(bytes);
        Ok(())
    }

    // Forgetting an account must also remove it from the recovery copy while
    // retaining the other sections. Both replacements use the usual crash-safe path.
    pub fn save_with_backup(
        &self,
        value: &impl Serialize,
        backup: &impl Serialize,
    ) -> io::Result<()> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(reason) = &state.blocked {
            return Err(io::Error::other(reason.clone()));
        }
        let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        let previous = serde_json::to_vec_pretty(backup).map_err(io::Error::other)?;
        commit(&self.path, &bytes, Some(&previous), |_| Ok(()))?;
        state.last_good = Some(bytes);
        Ok(())
    }

    // Remove the fallback first so a successfully forgotten profile cannot be
    // resurrected from .bak on the next launch.
    #[cfg(test)]
    pub fn delete(&self) -> io::Result<()> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(reason) = &state.blocked {
            return Err(io::Error::other(reason.clone()));
        }
        for path in [suffixed(&self.path, ".bak"), self.path.clone()] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        state.last_good = None;
        if self.path.parent().is_some_and(Path::exists) {
            sync_parent(&self.path)?;
        }
        Ok(())
    }
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    name.into()
}

fn temporary(path: &Path, bytes: &[u8], suffix: &str) -> io::Result<tempfile::NamedTempFile> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let mut file = tempfile::Builder::new()
        .prefix(&format!(
            "{}{suffix}",
            path.file_name().unwrap_or_default().to_string_lossy()
        ))
        .tempfile_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    Ok(file)
}

fn sync_parent(path: &Path) -> io::Result<()> {
    // Windows does not offer portable directory fsync. File data is synced
    // before same-directory atomic replacement; power-loss durability still
    // depends on the filesystem/device honoring flushes.
    #[cfg(unix)]
    fs::File::open(path.parent().unwrap_or(Path::new(".")))?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommitStage {
    Prepared,
    BackupSaved,
    Replaced,
}

fn commit(
    path: &Path,
    bytes: &[u8],
    previous: Option<&[u8]>,
    mut stage: impl FnMut(CommitStage) -> io::Result<()>,
) -> io::Result<()> {
    let file = temporary(path, bytes, ".tmp-")?;
    stage(CommitStage::Prepared)?;
    if let Some(previous) = previous {
        let backup = suffixed(path, ".bak");
        temporary(&backup, previous, ".tmp-")?
            .persist(&backup)
            .map_err(|error| error.error)?;
        sync_parent(path)?;
    }
    stage(CommitStage::BackupSaved)?;
    file.persist(path).map_err(|error| error.error)?;
    sync_parent(path)?;
    stage(CommitStage::Replaced)
}

fn quarantine(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let file = temporary(path, bytes, &format!(".corrupt-{timestamp}-"))?;
    let (_, saved) = file.keep().map_err(|error| error.error)?;
    sync_parent(path)?;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn empty() -> Value {
        json!({"version": 1, "items": []})
    }
    fn decode_test(bytes: &[u8]) -> Result<Value, DecodeError> {
        decode(bytes, 1, None, &[])
    }
    fn read(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }
    fn corrupt_copies(path: &Path) -> Vec<PathBuf> {
        fs::read_dir(path)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|p| p.to_string_lossy().contains(".corrupt-"))
            .collect()
    }

    #[test]
    fn rotates_one_backup_and_ignores_uncommitted_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let file = JsonFile::new(path.clone());
        assert_eq!(file.load(empty, decode_test), empty());
        for n in 1..=3 {
            file.save(&json!({"version":1,"items":[n]})).unwrap();
        }
        assert_eq!(read(&suffixed(&path, ".bak"))["items"], json!([2]));
        fs::write(suffixed(&path, ".tmp-orphan"), b"{").unwrap();
        assert_eq!(
            JsonFile::new(path).load(empty, decode_test)["items"],
            json!([3])
        );
        assert!(file.notices().is_empty());
    }

    #[test]
    fn quarantines_primary_restores_backup_and_preserves_backup_through_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let backup = suffixed(&path, ".bak");
        fs::write(&path, b"{truncated").unwrap();
        let bytes = br#"{"version":1,"items":["saved"]}"#;
        fs::write(&backup, bytes).unwrap();
        let file = JsonFile::new(path.clone());
        assert_eq!(file.load(empty, decode_test)["items"], json!(["saved"]));
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        let copies = corrupt_copies(dir.path());
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read(&copies[0]).unwrap(), b"{truncated");
        assert_eq!(file.notices().len(), 2);
        assert_eq!(read(&path)["items"], json!(["saved"]));
        assert!(JsonFile::new(path).load(empty, decode_test)["items"].is_array());
    }

    #[test]
    fn both_corrupt_or_missing_backups_start_empty_and_preserve_every_damaged_copy() {
        for has_backup in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("store.json");
            fs::write(&path, b"broken primary").unwrap();
            if has_backup {
                fs::write(suffixed(&path, ".bak"), b"broken backup").unwrap();
            }
            let file = JsonFile::new(path.clone());
            assert_eq!(file.load(empty, decode_test), empty());
            assert_eq!(
                corrupt_copies(dir.path()).len(),
                if has_backup { 2 } else { 1 }
            );
            assert_eq!(read(&path), empty());
            file.save(&json!({"version":1,"items":["new"]})).unwrap();
            assert_eq!(read(&suffixed(&path, ".bak")), empty());
        }
    }

    #[test]
    fn missing_primary_restores_backup_but_unknown_versions_never_reset_or_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let backup = suffixed(&path, ".bak");
        fs::write(&backup, serde_json::to_vec(&empty()).unwrap()).unwrap();
        assert_eq!(
            JsonFile::new(path.clone()).load(empty, decode_test),
            empty()
        );
        assert!(path.exists());
        for version in [0, 99] {
            let bytes = format!("{{\"version\":{version},\"future\":true}}").into_bytes();
            fs::write(&path, &bytes).unwrap();
            let file = JsonFile::new(path.clone());
            assert_eq!(file.load(empty, decode_test), empty());
            assert!(file.save(&empty()).is_err());
            assert!(file.delete().is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert!(corrupt_copies(dir.path()).is_empty());
            assert_eq!(file.notices().len(), 1);
        }
    }

    #[test]
    fn io_errors_are_not_treated_as_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        fs::create_dir(&path).unwrap();
        let file = JsonFile::new(path.clone());
        assert_eq!(file.load(empty, decode_test), empty());
        assert!(file.save(&empty()).is_err());
        assert!(path.is_dir());
        assert!(corrupt_copies(dir.path()).is_empty());
        assert!(file.notices()[0].message.contains("Could not read"));
    }

    #[test]
    fn failed_backup_replacement_keeps_primary_and_retry_can_succeed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let file = JsonFile::new(path.clone());
        file.save(&empty()).unwrap();
        fs::create_dir(suffixed(&path, ".bak")).unwrap();
        assert!(file.save(&json!({"version":1,"items":[1]})).is_err());
        assert_eq!(read(&path), empty());
        fs::remove_dir(suffixed(&path, ".bak")).unwrap();
        file.save(&json!({"version":1,"items":[2]})).unwrap();
        assert_eq!(read(&path)["items"], json!([2]));
        assert_eq!(read(&suffixed(&path, ".bak")), empty());
    }

    #[test]
    fn failed_migration_commit_keeps_original_and_blocks_later_saves() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let original = br#"{"version":1,"items":["keep"]}"#;
        fs::write(&path, original).unwrap();
        fs::create_dir(suffixed(&path, ".bak")).unwrap();
        let file = JsonFile::new(path.clone());
        let migrated = file.load(empty, |bytes| {
            decode::<Value>(
                bytes,
                2,
                None,
                &[(1, |mut value| {
                    value["version"] = 2.into();
                    Ok(value)
                })],
            )
        });
        assert_eq!(migrated["items"], json!(["keep"]));
        assert_eq!(migrated["version"], 2);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(file.save(&empty()).is_err());
        assert!(file.notices()[0].message.contains("Could not save"));
    }

    #[test]
    fn process_exit_at_each_commit_boundary_leaves_a_complete_generation() {
        for (stage, expected) in [("Prepared", 1), ("BackupSaved", 1), ("Replaced", 2)] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("store.json");
            fs::write(&path, br#"{"version":1,"items":[1]}"#).unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "connection::store::tests::crash_child",
                    "--nocapture",
                ])
                .env("FOREVER_STORE_CRASH_PATH", &path)
                .env("FOREVER_STORE_CRASH_STAGE", stage)
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(73), "{output:?}");
            let file = JsonFile::new(path.clone());
            assert_eq!(file.load(empty, decode_test)["items"], json!([expected]));
            if stage != "Prepared" {
                assert_eq!(read(&suffixed(&path, ".bak"))["items"], json!([1]));
            }
        }
    }

    #[test]
    fn crash_child() {
        let Some(path) = std::env::var_os("FOREVER_STORE_CRASH_PATH") else {
            return;
        };
        let path = PathBuf::from(path);
        let stop = std::env::var("FOREVER_STORE_CRASH_STAGE").unwrap();
        let previous = fs::read(&path).unwrap();
        commit(
            &path,
            br#"{"version":1,"items":[2]}"#,
            Some(&previous),
            |stage| {
                if format!("{stage:?}") == stop {
                    std::process::exit(73);
                }
                Ok(())
            },
        )
        .unwrap();
        panic!("did not reach requested crash boundary");
    }

    #[test]
    fn cloned_handles_serialize_concurrent_saves() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let file = JsonFile::new(path.clone());
        let handles: Vec<_> = (0..8)
            .map(|n| {
                let file = file.clone();
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        file.save(&json!({"version":1,"items":[n]})).unwrap();
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert!(read(&path)["items"][0].is_number());
        assert!(read(&suffixed(&path, ".bak"))["items"][0].is_number());
    }
}
