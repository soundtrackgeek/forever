use super::{default_database_path, status_for_path, ArchiveStatus};
use crate::connection::store::{self, DecodeError, JsonFile};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PathSource {
    Automatic,
    Custom,
}

#[derive(Deserialize, Serialize)]
struct Settings {
    version: u32,
    #[serde(deserialize_with = "Option::deserialize")]
    database_path: Option<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            database_path: None,
        }
    }
}

fn decode(bytes: &[u8]) -> Result<Settings, DecodeError> {
    let settings: Settings = store::decode(bytes, 1, None, &[])?;
    if let Some(path) = &settings.database_path {
        validate_path(path).map_err(DecodeError::Invalid)?;
    }
    Ok(settings)
}

pub(crate) fn validate_path(path: &std::path::Path) -> Result<(), String> {
    if !path.is_absolute() || path.to_string_lossy().chars().any(char::is_control) {
        return Err("Choose an absolute path to a Music Library database.".into());
    }
    Ok(())
}

pub struct ArchiveSettings {
    unified: Option<crate::connection::app_settings::AppSettings>,
    file: JsonFile,
    settings: Mutex<Settings>,
    default_path: PathBuf,
}

#[derive(Clone)]
pub(super) struct Source {
    pub path: PathBuf,
    kind: PathSource,
    notice: Option<String>,
}

impl Source {
    pub fn annotate(&self, mut status: ArchiveStatus) -> ArchiveStatus {
        status.path_source = self.kind.clone();
        status.settings_notice = self.notice.clone();
        status
    }
}

impl ArchiveSettings {
    #[cfg(test)]
    fn new(file: JsonFile, default_path: PathBuf) -> Self {
        let settings = file.load(Settings::default, decode);
        Self {
            unified: None,
            file,
            settings: Mutex::new(settings),
            default_path,
        }
    }

    fn source_from(&self, settings: &Settings) -> Source {
        let notices = self.file.notices();
        Source {
            path: settings
                .database_path
                .clone()
                .unwrap_or_else(|| self.default_path.clone()),
            kind: if settings.database_path.is_some() {
                PathSource::Custom
            } else {
                PathSource::Automatic
            },
            notice: (!notices.is_empty()).then(|| {
                notices
                    .iter()
                    .map(|notice| notice.message.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            }),
        }
    }

    fn source(&self) -> Source {
        if let Some(unified) = &self.unified {
            return self.source_from(&Settings {
                version: 1,
                database_path: unified.get().archive_database_path,
            });
        }
        self.source_from(&self.settings.lock().unwrap_or_else(|p| p.into_inner()))
    }

    fn select(&self, path: Option<PathBuf>) -> Result<ArchiveStatus, String> {
        let mut settings = self.settings.lock().unwrap_or_else(|p| p.into_inner());
        let next = Settings {
            version: 1,
            database_path: path,
        };
        let source = self.source_from(&next);
        if next.database_path.is_some() {
            validate_path(&source.path)?;
        }
        let status = status_for_path(&source.path);
        if next.database_path.is_some() && !status.connected {
            return Err(status
                .error
                .unwrap_or_else(|| "Could not read the selected Archive.".into()));
        }
        if let Some(unified) = &self.unified {
            unified
                .update(|s| s.archive_database_path = next.database_path.clone())
                .map_err(|e| e.to_string())?;
        } else {
            self.file.save(&next).map_err(|e| e.to_string())?;
        }
        *settings = next;
        Ok(source.annotate(status))
    }
}

pub(crate) fn legacy_path(file: &JsonFile) -> Option<PathBuf> {
    file.load(Settings::default, decode).database_path
}

pub fn initialize(app: &AppHandle) -> Result<ArchiveSettings, String> {
    let unified = app
        .state::<crate::connection::ConnectionManager>()
        .settings_store();
    Ok(ArchiveSettings {
        file: unified.file(),
        settings: Mutex::new(Settings::default()),
        default_path: default_database_path(app)?,
        unified: Some(unified),
    })
}

pub(super) fn source(app: &AppHandle) -> Source {
    app.state::<ArchiveSettings>().source()
}

/// The Music Library database currently in use, for read-only lookups.
pub(crate) fn database_path(app: &AppHandle) -> PathBuf {
    source(app).path
}

#[tauri::command]
pub async fn archive_set_database_path(
    app: AppHandle,
    path: Option<String>,
) -> Result<ArchiveStatus, String> {
    tokio::task::spawn_blocking(move || {
        let result = app
            .state::<ArchiveSettings>()
            .select(path.map(PathBuf::from))?;
        app.state::<crate::connection::ConnectionManager>()
            .publish_settings();
        Ok(result)
    })
    .await
    .map_err(|error| format!("The Archive source task stopped unexpectedly: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unified_source_selection_and_import_use_the_same_authority() {
        use crate::connection::app_settings::AppSettings;
        let dir = tempfile::tempdir().unwrap();
        let legacy: Vec<_> = [
            "connection",
            "transfers",
            "sharing",
            "people",
            "messages",
            "rooms",
            "wanted",
            "queries",
            "uploads",
            "archive",
        ]
        .into_iter()
        .map(|name| JsonFile::new(dir.path().join(format!("{name}.json"))))
        .collect();
        let unified = AppSettings::open(JsonFile::new(dir.path().join("settings.json")), &legacy);
        let fixture = super::super::tests::fixture();
        let before = std::fs::read(fixture.path()).unwrap();
        let archive = ArchiveSettings {
            file: unified.file(),
            settings: Mutex::new(Settings::default()),
            default_path: dir.path().join("default.sqlite3"),
            unified: Some(unified.clone()),
        };
        archive.select(Some(fixture.path().to_path_buf())).unwrap();
        assert_eq!(
            unified.get().archive_database_path.as_deref(),
            Some(fixture.path())
        );
        unified.update(|s| s.archive_database_path = None).unwrap();
        assert_eq!(archive.source().kind, PathSource::Automatic);
        assert!(!dir.path().join("archive.json").exists());
        assert_eq!(std::fs::read(fixture.path()).unwrap(), before);
    }

    #[test]
    fn selection_persists_validates_and_resets_without_writing_the_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("archive.json");
        let default = directory.path().join("missing.sqlite3");
        let fixture = super::super::tests::fixture();
        let before = std::fs::read(fixture.path()).unwrap();
        let settings = ArchiveSettings::new(JsonFile::new(path.clone()), default.clone());
        assert_eq!(settings.source().kind, PathSource::Automatic);
        let selected = settings.select(Some(fixture.path().to_path_buf())).unwrap();
        assert!(selected.connected);
        assert_eq!(selected.path_source, PathSource::Custom);
        assert!(settings
            .select(Some(directory.path().join("absent")))
            .is_err());
        assert!(settings
            .select(Some(PathBuf::from("relative.sqlite3")))
            .is_err());
        let invalid = directory.path().join("invalid.db");
        std::fs::write(&invalid, "not sqlite").unwrap();
        assert!(settings.select(Some(invalid)).is_err());
        let reloaded = ArchiveSettings::new(JsonFile::new(path), default.clone());
        assert_eq!(reloaded.source().path, fixture.path());
        let automatic = reloaded.select(None).unwrap();
        assert!(!automatic.connected);
        assert_eq!(automatic.path_source, PathSource::Automatic);
        assert_eq!(reloaded.source().path, default);
        assert_eq!(std::fs::read(fixture.path()).unwrap(), before);
    }

    #[test]
    fn future_settings_are_preserved_and_notice_is_visible() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("archive.json");
        let bytes = br#"{"version":999,"database_path":null}"#;
        std::fs::write(&path, bytes).unwrap();
        let settings = ArchiveSettings::new(
            JsonFile::new(path.clone()),
            directory.path().join("default.db"),
        );
        assert!(settings.source().notice.is_some());
        assert!(settings.select(None).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn damaged_settings_restore_the_previous_custom_source_with_a_notice() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("archive.json");
        let default = directory.path().join("default.db");
        let fixture = super::super::tests::fixture();
        let settings = ArchiveSettings::new(JsonFile::new(path.clone()), default.clone());
        settings.select(Some(fixture.path().to_path_buf())).unwrap();
        settings.select(None).unwrap();
        std::fs::write(&path, br#"{"version":1}"#).unwrap();
        let recovered = ArchiveSettings::new(JsonFile::new(path), default);
        assert_eq!(recovered.source().path, fixture.path());
        assert!(recovered.source().notice.is_some());
    }
}
