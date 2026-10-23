use super::store::{self, DecodeError, JsonFile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

pub const DEFAULT_SERVER_HOST: &str = "server.slsknet.org";
pub const DEFAULT_SERVER_PORT: u16 = 2242;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub username: String,
    pub server_host: String,
    pub server_port: u16,
    pub download_directory: String,
    pub remember_password: bool,
    pub auto_connect: bool,
}

impl ConnectionProfile {
    pub fn suggested(download_directory: &Path) -> Self {
        Self {
            username: String::new(),
            server_host: DEFAULT_SERVER_HOST.to_owned(),
            server_port: DEFAULT_SERVER_PORT,
            download_directory: download_directory.to_string_lossy().into_owned(),
            remember_password: true,
            auto_connect: true,
        }
    }

    pub fn validate(&self) -> Result<(), SettingsError> {
        if self.username.is_empty() {
            return Err(SettingsError::Validation(
                "Enter a Soulseek username.".to_owned(),
            ));
        }

        if self.username.len() > 30 {
            return Err(SettingsError::Validation(
                "Soulseek usernames can be at most 30 characters.".to_owned(),
            ));
        }

        if self.username.trim() != self.username {
            return Err(SettingsError::Validation(
                "Remove leading or trailing spaces from the username.".to_owned(),
            ));
        }

        if !self
            .username
            .bytes()
            .all(|byte| byte.is_ascii_graphic() || byte == b' ')
        {
            return Err(SettingsError::Validation(
                "Use printable ASCII characters in the username.".to_owned(),
            ));
        }

        if self.server_host.is_empty()
            || self.server_host.len() > 255
            || self.server_host.chars().any(char::is_whitespace)
        {
            return Err(SettingsError::Validation(
                "Enter a valid Soulseek server hostname.".to_owned(),
            ));
        }

        if self.server_port == 0 {
            return Err(SettingsError::Validation(
                "Enter a valid Soulseek server port.".to_owned(),
            ));
        }

        if self.download_directory.trim().is_empty() {
            return Err(SettingsError::Validation(
                "Choose a download folder.".to_owned(),
            ));
        }

        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
struct ConnectionStore {
    version: u32,
    #[serde(deserialize_with = "Option::deserialize")]
    profile: Option<ConnectionProfile>,
}

impl Default for ConnectionStore {
    fn default() -> Self {
        Self {
            version: 1,
            profile: None,
        }
    }
}

fn decode_store(bytes: &[u8]) -> Result<ConnectionStore, DecodeError> {
    let store: ConnectionStore = store::decode(bytes, 1, Some(0), &[(0, migrate_v0_to_v1)])?;
    if let Some(profile) = &store.profile {
        profile
            .validate()
            .map_err(|error| DecodeError::Invalid(error.to_string()))?;
    }
    Ok(store)
}

fn migrate_v0_to_v1(value: serde_json::Value) -> Result<serde_json::Value, DecodeError> {
    let profile: ConnectionProfile = serde_json::from_value(value)?;
    Ok(serde_json::to_value(ConnectionStore {
        version: 1,
        profile: Some(profile),
    })?)
}

#[derive(Clone)]
pub struct SettingsStore {
    path: JsonFile,
}

impl SettingsStore {
    pub fn new(path: JsonFile) -> Self {
        Self { path }
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        self.path.path()
    }

    pub fn load(&self) -> Result<Option<ConnectionProfile>, SettingsError> {
        Ok(self
            .path
            .load(ConnectionStore::default, decode_store)
            .profile)
    }

    pub fn save(&self, profile: &ConnectionProfile) -> Result<(), SettingsError> {
        profile.validate()?;
        std::fs::create_dir_all(&profile.download_directory)?;
        self.path.save(&ConnectionStore {
            version: 1,
            profile: Some(profile.clone()),
        })?;
        Ok(())
    }

    pub fn delete(&self) -> Result<(), SettingsError> {
        self.path.delete()?;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("{0}")]
    Validation(String),
    #[error("Could not read or save connection settings: {0}")]
    Io(#[from] std::io::Error),
    #[error("Connection settings are not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_unversioned_profile_and_reset_removes_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        let bytes = include_bytes!("../../fixtures/stores/connection-v0.json");
        std::fs::write(&path, bytes).unwrap();
        let file = JsonFile::new(path.clone());
        let settings = SettingsStore::new(file.clone());
        let profile = settings.load().unwrap().unwrap();
        assert_eq!(profile.username, "SignalLevel");
        assert!(!profile.auto_connect);
        assert!(file.notices().is_empty());
        assert_eq!(
            std::fs::read(dir.path().join("connection.json.bak")).unwrap(),
            bytes
        );
        assert_eq!(settings.load().unwrap(), Some(profile));
        settings.delete().unwrap();
        assert!(!path.exists());
        assert!(!dir.path().join("connection.json.bak").exists());
        assert_eq!(settings.load().unwrap(), None);
    }

    #[test]
    fn invalid_profile_recovers_valid_legacy_backup_without_touching_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        let bytes = include_bytes!("../../fixtures/stores/connection-v0.json");
        std::fs::write(dir.path().join("connection.json.bak"), bytes).unwrap();
        let mut invalid: serde_json::Value = serde_json::from_slice(bytes).unwrap();
        invalid["serverPort"] = 0.into();
        std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        let file = JsonFile::new(path);
        let settings = SettingsStore::new(file.clone());
        assert_eq!(settings.load().unwrap().unwrap().server_port, 2242);
        assert_eq!(file.notices().len(), 2);
    }

    #[test]
    fn future_connection_schema_cannot_be_overwritten_or_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        let bytes = br#"{"version":99,"profile":{"future":"data"}}"#;
        std::fs::write(&path, bytes).unwrap();
        let settings = SettingsStore::new(JsonFile::new(path.clone()));
        assert_eq!(settings.load().unwrap(), None);
        assert!(settings.delete().is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn rejects_invalid_usernames() {
        let mut profile = ConnectionProfile::suggested(Path::new("C:\\Downloads\\Forever"));
        profile.username = " leading".to_owned();

        assert!(matches!(
            profile.validate(),
            Err(SettingsError::Validation(message)) if message.contains("leading or trailing")
        ));

        profile.username = "snow☃".to_owned();
        assert!(matches!(
            profile.validate(),
            Err(SettingsError::Validation(message)) if message.contains("printable ASCII")
        ));
    }

    #[test]
    fn round_trips_profile_without_a_password() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = SettingsStore::new(JsonFile::new(directory.path().join("connection.json")));
        let mut profile = ConnectionProfile::suggested(&directory.path().join("downloads"));
        profile.username = "SignalLevel".to_owned();

        store.save(&profile).expect("save settings");
        let saved = store.load().expect("load settings").expect("saved profile");

        assert_eq!(saved, profile);
        let raw = std::fs::read_to_string(store.path()).expect("settings contents");
        assert!(!raw.contains("\"password\""));
    }
}
