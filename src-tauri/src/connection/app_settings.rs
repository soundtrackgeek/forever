//! The single authority for preferences. Operational stores retain their own data.
use super::{
    downloads,
    local_shares::SharingStore,
    settings::{ConnectionProfile, SettingsError, SettingsStore},
    store::{self, DecodeError, JsonFile},
    wanted::{self, WantedPreferences},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvancedFilters {
    pub minimum_bitrate: Option<f64>,
    pub minimum_sample_rate: Option<f64>,
    pub minimum_bit_depth: Option<f64>,
    pub maximum_queue: Option<f64>,
    pub minimum_size_mb: Option<f64>,
    pub maximum_size_mb: Option<f64>,
    pub results_per_user: Option<f64>,
    pub free_slot_only: bool,
    pub hide_blocked_ignored: bool,
    pub extensions: String,
    pub excluded_words: String,
    pub countries: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialPreset {
    pub id: String,
    pub mode: String,
    pub query: String,
    pub search_filter: String,
    pub search_sort: String,
    pub search_layout: String,
    pub album_filter: String,
    pub advanced_filters: AdvancedFilters,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentSearch {
    pub mode: String,
    pub query: String,
    pub closed_at_ms: u64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialMemory {
    pub pinned: Vec<DialPreset>,
    pub recent: Vec<RecentSearch>,
}
impl DialMemory {
    fn validate(&self) -> Result<(), String> {
        let mode = |s: &str| ["files", "albums"].contains(&s);
        let mut ids = std::collections::HashSet::new();
        if self.pinned.len() > 8 || self.recent.len() > 8 {
            return Err("Dial Memory holds at most eight presets and recent searches.".into());
        }
        for p in &self.pinned {
            let a = &p.advanced_filters;
            if p.id.is_empty()
                || p.id.len() > 128
                || !ids.insert(&p.id)
                || !mode(&p.mode)
                || p.query.is_empty()
                || p.query.len() > 2000
                || !["all", "lossless", "compressed"].contains(&p.search_filter.as_str())
                || !["list", "grid"].contains(&p.search_layout.as_str())
                || !["all", "studio", "live", "compilation", "ep"]
                    .contains(&p.album_filter.as_str())
                || ![
                    "best",
                    "ready",
                    "busy",
                    "fast",
                    "slow",
                    "small",
                    "large",
                    "nameAsc",
                    "nameDesc",
                    "userAsc",
                    "userDesc",
                    "qualityDesc",
                    "qualityAsc",
                    "tracksDesc",
                    "tracksAsc",
                    "formatAsc",
                    "formatDesc",
                ]
                .contains(&p.search_sort.as_str())
                || [
                    a.minimum_bitrate,
                    a.minimum_sample_rate,
                    a.minimum_bit_depth,
                    a.maximum_queue,
                    a.minimum_size_mb,
                    a.maximum_size_mb,
                    a.results_per_user,
                ]
                .into_iter()
                .flatten()
                .any(|n| !n.is_finite() || n < 0.0)
                || [&a.extensions, &a.excluded_words, &a.countries]
                    .iter()
                    .any(|s| s.len() > 2000)
            {
                return Err("Invalid Dial Memory preset.".into());
            }
        }
        if self
            .recent
            .iter()
            .any(|s| !mode(&s.mode) || s.query.is_empty() || s.query.len() > 2000)
        {
            return Err("Invalid recent search.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferSettings {
    #[serde(default)]
    pub bandwidth: super::bandwidth::BandwidthSettings,
    #[serde(default)]
    pub filing: super::filing::FilingSettings,
    pub max_concurrent_downloads: u8,
    pub relay_suggestion_minutes: u32,
    #[serde(default)]
    pub auto_mirror_minutes: u32,
    pub soundcheck_enabled: bool,
}
impl Default for TransferSettings {
    fn default() -> Self {
        Self {
            bandwidth: super::bandwidth::BandwidthSettings::default(),
            filing: super::filing::FilingSettings::default(),
            max_concurrent_downloads: 3,
            relay_suggestion_minutes: 10,
            auto_mirror_minutes: 0,
            soundcheck_enabled: true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WantedSettings {
    pub interval_minutes: u32,
    pub default_preferences: WantedPreferences,
}
impl Default for WantedSettings {
    fn default() -> Self {
        Self {
            interval_minutes: 30,
            default_preferences: WantedPreferences::default(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub update_check_interval_minutes: u32,
    #[serde(default)]
    pub update_channel: crate::updater::UpdateChannel,
    pub message_notifications_enabled: bool,
    pub room_notifications_enabled: bool,
    pub music_brainz_fallback_track_count: u16,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            update_check_interval_minutes: 360,
            update_channel: crate::updater::UpdateChannel::Stable,
            message_notifications_enabled: true,
            room_notifications_enabled: true,
            music_brainz_fallback_track_count: 10,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSettings {
    pub close_to_tray: bool,
    pub start_in_tray: bool,
}
impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_in_tray: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub desktop: DesktopSettings,
    pub version: u32,
    pub revision: u64,
    pub webview_migrated: bool,
    pub connection: Option<ConnectionProfile>,
    pub transfers: TransferSettings,
    pub sharing: SharingStore,
    pub wanted: WantedSettings,
    pub archive_database_path: Option<PathBuf>,
    pub preferences: Preferences,
    pub dial_memory: DialMemory,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            desktop: DesktopSettings::default(),
            version: 1,
            revision: 0,
            webview_migrated: false,
            connection: None,
            transfers: TransferSettings::default(),
            sharing: SharingStore::default(),
            wanted: WantedSettings::default(),
            archive_database_path: None,
            preferences: Preferences::default(),
            dial_memory: DialMemory::default(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        self.transfers.filing.validate()?;
        self.transfers.bandwidth.validate()?;
        if self.revision > 9_007_199_254_740_991 {
            return Err("Invalid settings revision.".into());
        }
        if self.version != 1 {
            return Err("Unsupported settings version.".into());
        }
        if let Some(profile) = &self.connection {
            profile.validate().map_err(|e| e.to_string())?;
        }
        if !(1..=6).contains(&self.transfers.max_concurrent_downloads)
            || ![0, 5, 10, 20, 30, 60].contains(&self.transfers.relay_suggestion_minutes)
            || ![0, 5, 10, 20, 30, 60].contains(&self.transfers.auto_mirror_minutes)
        {
            return Err("Invalid download lanes or relay delay.".into());
        }
        if ![0, 15, 30, 60].contains(&self.wanted.interval_minutes) {
            return Err("Invalid Wanted interval.".into());
        }
        wanted::validate_preferences(&self.wanted.default_preferences)
            .map_err(|e| e.to_string())?;
        self.sharing.validate()?;
        self.dial_memory.validate()?;
        if let Some(path) = &self.archive_database_path {
            crate::archive::settings::validate_path(path)?;
        }
        if ![0, 1, 5, 15, 30, 60, 360].contains(&self.preferences.update_check_interval_minutes)
            || !(1..=250).contains(&self.preferences.music_brainz_fallback_track_count)
        {
            return Err("Invalid update interval or MusicBrainz fallback count.".into());
        }
        Ok(())
    }
}
fn decode(bytes: &[u8]) -> Result<Settings, DecodeError> {
    let settings: Settings = store::decode(bytes, 1, None, &[])?;
    settings.validate().map_err(DecodeError::Invalid)?;
    reject_unknown_fields(
        &serde_json::from_slice(bytes)?,
        &serde_json::to_value(&settings)?,
    )?;
    Ok(settings)
}

fn reject_unknown_fields(
    input: &serde_json::Value,
    typed: &serde_json::Value,
) -> Result<(), DecodeError> {
    match (input, typed) {
        (serde_json::Value::Object(input), serde_json::Value::Object(typed)) => {
            for (key, value) in input {
                let expected = typed.get(key).ok_or_else(|| {
                    DecodeError::Invalid(format!("Unknown settings field: {key}"))
                })?;
                reject_unknown_fields(value, expected)?;
            }
        }
        (serde_json::Value::Array(input), serde_json::Value::Array(typed)) => {
            for (value, expected) in input.iter().zip(typed) {
                reject_unknown_fields(value, expected)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Clone)]
pub struct AppSettings {
    file: JsonFile,
    state: Arc<Mutex<Settings>>,
}
impl AppSettings {
    pub fn open(file: JsonFile, legacy: &[JsonFile]) -> Self {
        // Only migrate if neither the authoritative file nor its backup exists.
        // Corruption recovery must never resurrect a forgotten legacy account.
        let exists = file.path().exists()
            || PathBuf::from(format!("{}.bak", file.path().display())).exists();
        let mut current = file.load(Settings::default, decode);
        if !exists && !file.is_blocked() {
            current.connection = SettingsStore::new(legacy[0].clone())
                .load()
                .unwrap_or_default();
            current.transfers = downloads::legacy_settings(&legacy[1]);
            current.sharing = super::local_shares::legacy_settings(&legacy[2]);
            current.wanted = wanted::legacy_settings(&legacy[6]);
            current.archive_database_path = crate::archive::settings::legacy_path(&legacy[9]);
            if legacy.iter().any(JsonFile::is_blocked) {
                file.block_changes("A legacy settings store could not be migrated. Resolve its storage notice and restart.".into());
            } else if let Err(error) = current
                .validate()
                .and_then(|()| file.save(&current).map_err(|e| e.to_string()))
            {
                file.block_changes(format!("Could not migrate settings: {error}"));
            }
        }
        Self {
            file,
            state: Arc::new(Mutex::new(current)),
        }
    }
    pub fn get(&self) -> Settings {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    pub fn file(&self) -> JsonFile {
        self.file.clone()
    }
    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<Settings, SettingsError> {
        let mut current = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if self.file.is_blocked() {
            return Err(SettingsError::Validation(
                "Settings are unavailable this session. Resolve the storage notice and restart."
                    .into(),
            ));
        }
        let mut next = current.clone();
        change(&mut next);
        next.revision = current.revision;
        if next == *current {
            return Ok(current.clone());
        }
        next.revision += 1;
        next.validate().map_err(SettingsError::Validation)?;
        if current.connection.is_some() && next.connection.is_none() {
            let mut backup = current.clone();
            backup.connection = None;
            self.file.save_with_backup(&next, &backup)?;
        } else {
            self.file.save(&next)?;
        }
        *current = next.clone();
        Ok(next)
    }
    pub fn load(&self) -> Result<Option<ConnectionProfile>, SettingsError> {
        Ok(self.get().connection)
    }
    pub fn save(&self, profile: &ConnectionProfile) -> Result<(), SettingsError> {
        profile.validate()?;
        std::fs::create_dir_all(&profile.download_directory)?;
        self.update(|s| s.connection = Some(profile.clone()))?;
        Ok(())
    }
    pub fn delete(&self) -> Result<(), SettingsError> {
        self.update(|s| s.connection = None)?;
        Ok(())
    }
    pub fn save_sharing(&self, sharing: &SharingStore) -> std::io::Result<()> {
        self.update(|s| s.sharing = sharing.clone())
            .map_err(std::io::Error::other)?;
        Ok(())
    }
}

// Fields are independently optional. Section patches merge with the latest value,
// so two unrelated controls cannot overwrite each other's settings.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub close_to_tray: Option<bool>,
    pub start_in_tray: Option<bool>,
    pub bandwidth: Option<super::bandwidth::BandwidthSettings>,
    pub filing: Option<super::filing::FilingSettings>,
    pub max_concurrent_downloads: Option<u8>,
    pub relay_suggestion_minutes: Option<u32>,
    pub auto_mirror_minutes: Option<u32>,
    pub soundcheck_enabled: Option<bool>,
    pub upload_slots: Option<u8>,
    pub upload_policy: Option<super::upload_policy::UploadPolicy>,
    pub wanted_interval_minutes: Option<u32>,
    pub wanted_default_preferences: Option<WantedPreferences>,
    pub update_check_interval_minutes: Option<u32>,
    pub update_channel: Option<crate::updater::UpdateChannel>,
    pub message_notifications_enabled: Option<bool>,
    pub room_notifications_enabled: Option<bool>,
    pub music_brainz_fallback_track_count: Option<u16>,
    pub dial_memory: Option<DialMemory>,
}
impl SettingsPatch {
    pub fn touches_webview(&self) -> bool {
        self.update_check_interval_minutes.is_some()
            || self.update_channel.is_some()
            || self.message_notifications_enabled.is_some()
            || self.room_notifications_enabled.is_some()
            || self.music_brainz_fallback_track_count.is_some()
            || self.dial_memory.is_some()
    }

    pub fn apply(self, s: &mut Settings) {
        macro_rules! assign {
            ($field:ident, $target:expr) => {
                if let Some(v) = self.$field {
                    $target = v;
                }
            };
        }
        assign!(
            max_concurrent_downloads,
            s.transfers.max_concurrent_downloads
        );
        assign!(
            relay_suggestion_minutes,
            s.transfers.relay_suggestion_minutes
        );
        assign!(close_to_tray, s.desktop.close_to_tray);
        assign!(start_in_tray, s.desktop.start_in_tray);
        assign!(auto_mirror_minutes, s.transfers.auto_mirror_minutes);
        assign!(filing, s.transfers.filing);
        assign!(bandwidth, s.transfers.bandwidth);
        assign!(soundcheck_enabled, s.transfers.soundcheck_enabled);
        assign!(upload_slots, s.sharing.upload_slots);
        assign!(upload_policy, s.sharing.upload_policy);
        assign!(wanted_interval_minutes, s.wanted.interval_minutes);
        assign!(wanted_default_preferences, s.wanted.default_preferences);
        assign!(update_channel, s.preferences.update_channel);
        assign!(
            update_check_interval_minutes,
            s.preferences.update_check_interval_minutes
        );
        assign!(
            message_notifications_enabled,
            s.preferences.message_notifications_enabled
        );
        assign!(
            room_notifications_enabled,
            s.preferences.room_notifications_enabled
        );
        assign!(
            music_brainz_fallback_track_count,
            s.preferences.music_brainz_fallback_track_count
        );
        assign!(dial_memory, s.dial_memory);
    }
}

pub fn parse_import(json: &str) -> Result<Settings, String> {
    if json.len() > 256 * 1024 {
        return Err("Settings files must be smaller than 256 KiB.".into());
    }
    let settings = decode(json.as_bytes()).map_err(|e| format!("Invalid settings file: {e:?}"))?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn desktop_preferences_migrate_merge_and_round_trip_without_enabling_autostart() {
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("desktop");
        legacy["transfers"]["bandwidth"]
            .as_object_mut()
            .unwrap()
            .remove("manualPaused");
        let defaults = parse_import(&legacy.to_string()).unwrap();
        assert_eq!(defaults.desktop, DesktopSettings::default());
        assert!(!defaults.transfers.bandwidth.manual_paused);
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let patch: SettingsPatch =
            serde_json::from_value(serde_json::json!({"closeToTray":false})).unwrap();
        store.update(|s| patch.apply(s)).unwrap();
        let next = open(dir.path()).get();
        assert!(!next.desktop.close_to_tray);
        assert!(next.desktop.start_in_tray);
        assert_eq!(
            parse_import(&serde_json::to_string(&next).unwrap()).unwrap(),
            next
        );
        let mut invalid = serde_json::to_value(next).unwrap();
        invalid["desktop"]["autostartEnabled"] = true.into();
        assert!(parse_import(&invalid.to_string()).is_err());
    }

    #[test]
    fn update_channels_default_migrate_validate_and_persist() {
        use crate::updater::UpdateChannel;
        let defaults = Settings::default();
        assert_eq!(defaults.preferences.update_check_interval_minutes, 360);
        assert_eq!(defaults.preferences.update_channel, UpdateChannel::Stable);
        for interval in [0, 1, 5, 15, 30, 60] {
            let mut legacy = serde_json::to_value(&defaults).unwrap();
            legacy["preferences"]
                .as_object_mut()
                .unwrap()
                .remove("updateChannel");
            legacy["preferences"]["updateCheckIntervalMinutes"] = interval.into();
            let settings = parse_import(&legacy.to_string()).unwrap();
            assert_eq!(settings.preferences.update_check_interval_minutes, interval);
            assert_eq!(settings.preferences.update_channel, UpdateChannel::Stable);
        }
        let mut invalid = serde_json::to_value(&defaults).unwrap();
        invalid["preferences"]["updateChannel"] = "arbitrary-url".into();
        assert!(parse_import(&invalid.to_string()).is_err());
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let patch: SettingsPatch = serde_json::from_value(
            serde_json::json!({"updateChannel":"beta", "updateCheckIntervalMinutes":360}),
        )
        .unwrap();
        store.update(|s| patch.apply(s)).unwrap();
        assert_eq!(
            open(dir.path()).get().preferences.update_channel,
            UpdateChannel::Beta
        );
        store
            .update(|s| s.preferences = Preferences::default())
            .unwrap();
        assert_eq!(
            open(dir.path()).get().preferences.update_channel,
            UpdateChannel::Stable
        );
    }

    fn legacy_files(dir: &std::path::Path) -> Vec<JsonFile> {
        [
            "connection.json",
            "transfers.json",
            "sharing.json",
            "people.json",
            "messages.json",
            "rooms.json",
            "wanted.json",
            "search-queries.json",
            "uploads.json",
            "archive.json",
        ]
        .into_iter()
        .map(|name| JsonFile::new(dir.join(name)))
        .collect()
    }
    fn open(dir: &std::path::Path) -> AppSettings {
        AppSettings::open(JsonFile::new(dir.join("settings.json")), &legacy_files(dir))
    }

    #[test]
    fn migrates_all_legacy_preferences_once_and_keeps_operational_data() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("connection.json"),
            include_bytes!("../../fixtures/stores/connection-v0.json"),
        )
        .unwrap();
        let mut transfers: serde_json::Value =
            serde_json::from_slice(include_bytes!("../../fixtures/stores/transfers-v1.json"))
                .unwrap();
        transfers["max_concurrent_downloads"] = 5.into();
        transfers["relay_suggestion_minutes"] = 30.into();
        transfers["soundcheck_enabled"] = false.into();
        let transfer_bytes = serde_json::to_vec(&transfers).unwrap();
        fs::write(dir.path().join("transfers.json"), &transfer_bytes).unwrap();
        fs::write(
            dir.path().join("sharing.json"),
            include_bytes!("../../fixtures/stores/sharing-v1.json"),
        )
        .unwrap();
        let mut wanted: serde_json::Value =
            serde_json::from_slice(include_bytes!("../../fixtures/stores/wanted-v1.json")).unwrap();
        wanted["interval_minutes"] = 60.into();
        wanted["default_preferences"] = serde_json::json!({"formatPreference":"mp3Only","minimumBitrateKbps":192,"minimumTrackCount":12});
        let wanted_bytes = serde_json::to_vec(&wanted).unwrap();
        fs::write(dir.path().join("wanted.json"), &wanted_bytes).unwrap();
        let archive = dir.path().join("library.sqlite3");
        fs::write(
            dir.path().join("archive.json"),
            serde_json::to_vec(&serde_json::json!({"version":1,"database_path":archive})).unwrap(),
        )
        .unwrap();
        let store = open(dir.path());
        let settings = store.get();
        assert_eq!(
            settings.connection.as_ref().unwrap().username,
            "SignalLevel"
        );
        assert_eq!(
            settings.transfers,
            TransferSettings {
                bandwidth: Default::default(),
                filing: Default::default(),
                max_concurrent_downloads: 5,
                relay_suggestion_minutes: 30,
                auto_mirror_minutes: 0,
                soundcheck_enabled: false
            }
        );
        assert_eq!(settings.sharing.upload_slots, 2);
        assert_eq!(settings.sharing.roots.len(), 1);
        assert_eq!(settings.wanted.interval_minutes, 60);
        assert_eq!(
            settings.wanted.default_preferences.minimum_track_count,
            Some(12)
        );
        assert_eq!(settings.archive_database_path, Some(archive));
        assert_eq!(
            fs::read(dir.path().join("transfers.json")).unwrap(),
            transfer_bytes
        );
        assert_eq!(
            fs::read(dir.path().join("wanted.json")).unwrap(),
            wanted_bytes
        );
        // Later legacy changes cannot override the new authority, including a reset account.
        store.delete().unwrap();
        fs::write(dir.path().join("transfers.json"), b"broken legacy data").unwrap();
        let restored = open(dir.path()).get();
        assert_eq!(restored.connection, None);
        assert_eq!(restored.transfers.max_concurrent_downloads, 5);
        assert!(!serde_json::to_string(&restored)
            .unwrap()
            .contains("\"password\""));
    }

    #[test]
    fn invalid_patch_or_failed_save_changes_neither_memory_nor_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let before = store.get();
        let bytes = fs::read(store.file.path()).unwrap();
        assert!(store
            .update(|s| {
                s.preferences.message_notifications_enabled = false;
                s.transfers.max_concurrent_downloads = 0;
            })
            .is_err());
        assert_eq!(store.get(), before);
        assert_eq!(fs::read(store.file.path()).unwrap(), bytes);
        // Replace the destination with a directory to force an atomic-replace failure.
        fs::remove_file(store.file.path()).unwrap();
        fs::create_dir(store.file.path()).unwrap();
        assert!(store
            .update(|s| s.preferences.music_brainz_fallback_track_count = 22)
            .is_err());
        assert_eq!(store.get(), before);
    }

    #[test]
    fn independent_concurrent_patches_merge_and_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let first = store.clone();
        let second = store.clone();
        let a = std::thread::spawn(move || {
            first
                .update(|s| s.preferences.message_notifications_enabled = false)
                .unwrap()
        });
        let b = std::thread::spawn(move || {
            second
                .update(|s| s.transfers.max_concurrent_downloads = 6)
                .unwrap()
        });
        a.join().unwrap();
        b.join().unwrap();
        let next = open(dir.path()).get();
        assert_eq!(next.revision, 2);
        assert!(!next.preferences.message_notifications_enabled);
        assert_eq!(next.transfers.max_concurrent_downloads, 6);
    }

    #[test]
    fn damaged_settings_recover_the_valid_backup_without_reimporting_legacy() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store
            .update(|s| s.preferences.music_brainz_fallback_track_count = 12)
            .unwrap();
        store
            .update(|s| s.preferences.music_brainz_fallback_track_count = 20)
            .unwrap();
        fs::write(store.file.path(), b"{broken").unwrap();
        let recovered = open(dir.path());
        assert_eq!(
            recovered
                .get()
                .preferences
                .music_brainz_fallback_track_count,
            12
        );
        assert!(!recovered.file.notices().is_empty());
        assert!(fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .any(|f| f.file_name().to_string_lossy().contains("corrupt-")));
    }

    #[test]
    fn future_settings_and_future_legacy_schemas_cannot_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let future = br#"{"version":999,"future":"preserve"}"#;
        let path = dir.path().join("settings.json");
        fs::write(&path, future).unwrap();
        let store = open(dir.path());
        assert!(store
            .update(|s| s.preferences.message_notifications_enabled = false)
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), future);
        fs::remove_file(path).unwrap();
        let legacy = dir.path().join("sharing.json");
        fs::write(&legacy, future).unwrap();
        let store = open(dir.path());
        assert!(store.file.is_blocked());
        assert!(store.delete().is_err());
        assert!(!store.file.path().exists());
        assert_eq!(fs::read(legacy).unwrap(), future);
    }

    #[test]
    fn imported_documents_are_bounded_typed_and_do_not_contain_credentials() {
        let mut json = serde_json::to_value(Settings::default()).unwrap();
        assert!(parse_import(&json.to_string()).is_ok());
        for (field, value) in [
            ("updateCheckIntervalMinutes", 2),
            ("musicBrainzFallbackTrackCount", 0),
            ("musicBrainzFallbackTrackCount", 251),
        ] {
            let mut invalid = json.clone();
            invalid["preferences"][field] = value.into();
            assert!(parse_import(&invalid.to_string()).is_err());
        }
        let profile: serde_json::Value =
            serde_json::from_slice(include_bytes!("../../fixtures/stores/connection-v0.json"))
                .unwrap();
        json["connection"] = profile;
        json["connection"]["password"] = "never-import-me".into();
        assert!(parse_import(&json.to_string()).is_err());
        assert!(parse_import(&" ".repeat(256 * 1024 + 1)).is_err());
        json = serde_json::to_value(Settings::default()).unwrap();
        json["version"] = 999.into();
        assert!(parse_import(&json.to_string()).is_err());
    }

    #[test]
    fn import_round_trip_and_section_reset_preserve_other_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let mut exported = Settings::default();
        exported.transfers.max_concurrent_downloads = 6;
        exported.preferences.message_notifications_enabled = false;
        exported.dial_memory.recent.push(RecentSearch {
            mode: "files".into(),
            query: "rare album".into(),
            closed_at_ms: 1,
        });
        let imported = parse_import(&serde_json::to_string(&exported).unwrap()).unwrap();
        store
            .update(|s| {
                *s = imported;
                s.webview_migrated = true;
            })
            .unwrap();
        store.update(|s| s.transfers = Default::default()).unwrap();
        let restored = open(dir.path()).get();
        assert_eq!(restored.transfers, TransferSettings::default());
        assert!(!restored.preferences.message_notifications_enabled);
        assert_eq!(restored.dial_memory.recent.len(), 1);
        assert!(restored.webview_migrated);
    }

    #[test]
    fn forgetting_account_scrubs_recovery_copy_without_resetting_other_sections() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("connection.json"),
            include_bytes!("../../fixtures/stores/connection-v0.json"),
        )
        .unwrap();
        let store = open(dir.path());
        store
            .update(|s| s.preferences.music_brainz_fallback_track_count = 23)
            .unwrap();
        store.delete().unwrap();
        fs::write(store.file.path(), b"broken").unwrap();
        let restored = open(dir.path()).get();
        assert!(restored.connection.is_none());
        assert_eq!(restored.preferences.music_brainz_fallback_track_count, 23);
    }
    #[test]
    fn automatic_mirror_setting_defaults_off_validates_and_round_trips() {
        let mut settings = Settings::default();
        let mut legacy = serde_json::to_value(&settings).unwrap();
        legacy["transfers"]
            .as_object_mut()
            .unwrap()
            .remove("autoMirrorMinutes");
        let restored: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(restored.transfers.auto_mirror_minutes, 0);
        SettingsPatch {
            auto_mirror_minutes: Some(5),
            ..Default::default()
        }
        .apply(&mut settings);
        assert!(settings.validate().is_ok());
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restored.transfers.auto_mirror_minutes, 5);
        settings.transfers.auto_mirror_minutes = 1;
        assert!(settings.validate().is_err());
        settings.transfers = TransferSettings::default();
        assert_eq!(settings.transfers.auto_mirror_minutes, 0);
    }
}
