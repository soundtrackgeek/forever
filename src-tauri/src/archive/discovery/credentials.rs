//! API keys for the optional discovery sources.
//!
//! Keys live in the operating-system credential store, never in settings files,
//! exports, or logs. Development builds may also read the repository's gitignored
//! `.env.local`, so a developer can try a source without typing a key.
use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use zeroize::Zeroizing;

const SERVICE: &str = "com.soundtrackgeek.forever.discovery";
const MIN_LENGTH: usize = 8;
const MAX_LENGTH: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Source {
    LastFm,
    Discogs,
    Fanart,
}

impl Source {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "lastFm" => Ok(Self::LastFm),
            "discogs" => Ok(Self::Discogs),
            "fanart" => Ok(Self::Fanart),
            _ => Err("Choose Last.fm, Discogs, or Fanart.tv.".into()),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::LastFm => "Last.fm",
            Self::Discogs => "Discogs",
            Self::Fanart => "Fanart.tv",
        }
    }

    /// Keyring user names for the key (and secret) of this source.
    fn users(self) -> (&'static str, Option<&'static str>) {
        match self {
            Self::LastFm => ("lastfm-api-key", None),
            Self::Discogs => ("discogs-consumer-key", Some("discogs-consumer-secret")),
            Self::Fanart => ("fanart-api-key", None),
        }
    }

    /// Names accepted in the environment and `.env.local` (development builds only).
    fn env_names(self) -> (&'static str, Option<&'static str>) {
        match self {
            Self::LastFm => ("LAST_FM", None),
            Self::Discogs => ("DISCOGS", Some("DISCOGS_SECRET")),
            Self::Fanart => ("FANART_TV", None),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    Keyring,
    Environment,
    None,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub configured: bool,
    pub origin: Origin,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesStatus {
    pub last_fm: SourceStatus,
    pub discogs: SourceStatus,
    pub fanart: SourceStatus,
}

/// A resolved key and optional secret. Zeroized on drop.
pub(super) struct Credential {
    pub key: Zeroizing<String>,
    pub secret: Option<Zeroizing<String>>,
}

fn entry(user: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, user).map_err(|_| "The system credential store is unavailable.".to_string())
}

fn read(user: &str) -> Result<Option<Zeroizing<String>>, String> {
    // Unit tests must never touch the developer's real credential store.
    if cfg!(test) {
        return Ok(None);
    }
    match entry(user)?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(Zeroizing::new(value))),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("The system credential store could not be read.".into()),
    }
}

fn normalize(value: &str, what: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() < MIN_LENGTH
        || value.len() > MAX_LENGTH
        || !value.chars().all(|c| c.is_ascii_graphic())
    {
        return Err(format!(
            "The {what} should be {MIN_LENGTH}–{MAX_LENGTH} letters and numbers without spaces."
        ));
    }
    Ok(value.to_owned())
}

pub(super) fn save(source: Source, key: &str, secret: Option<&str>) -> Result<(), String> {
    let (key_user, secret_user) = source.users();
    let label = source.label();
    let key = normalize(key, &format!("{label} key"))?;
    let secret = match secret_user {
        Some(_) => Some(normalize(
            secret.ok_or_else(|| format!("Enter the {label} secret too."))?,
            &format!("{label} secret"),
        )?),
        None => None,
    };
    let key = Zeroizing::new(key);
    let secret = secret.map(Zeroizing::new);
    entry(key_user)?
        .set_password(&key)
        .map_err(|_| format!("Could not save the {label} key to the system credential store."))?;
    if let (Some(user), Some(secret)) = (secret_user, &secret) {
        if entry(user)?.set_password(secret).is_err() {
            let _ = entry(key_user).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
            return Err(format!(
                "Could not save the {label} secret to the system credential store."
            ));
        }
    }
    Ok(())
}

pub(super) fn clear(source: Source) -> Result<(), String> {
    let (key_user, secret_user) = source.users();
    for user in std::iter::once(key_user).chain(secret_user) {
        match entry(user)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(_) => return Err("Could not remove the saved key.".into()),
        }
    }
    Ok(())
}

/// Parses `NAME=value` lines; blank lines, comments, and surrounding quotes are ignored.
fn env_value(contents: &str, name: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let (left, right) = line.trim().split_once('=')?;
        if left.trim() != name {
            return None;
        }
        let value = right.trim().trim_matches(|c| c == '"' || c == '\'').trim();
        (!value.is_empty()).then(|| value.to_owned())
    })
}

#[cfg(debug_assertions)]
fn environment(name: &str) -> Option<Zeroizing<String>> {
    if cfg!(test) {
        return None;
    }
    if let Some(value) = std::env::var(name).ok().filter(|v| !v.trim().is_empty()) {
        return Some(Zeroizing::new(value.trim().to_owned()));
    }
    let mut directory = std::env::current_dir().ok()?;
    for _ in 0..4 {
        if let Ok(contents) = std::fs::read_to_string(directory.join(".env.local")) {
            return env_value(&contents, name).map(Zeroizing::new);
        }
        if !directory.pop() {
            break;
        }
    }
    None
}

#[cfg(not(debug_assertions))]
fn environment(_: &str) -> Option<Zeroizing<String>> {
    None
}

pub(super) fn resolve(source: Source) -> Result<Option<(Credential, Origin)>, String> {
    let (key_user, secret_user) = source.users();
    if let Some(key) = read(key_user)? {
        let secret = match secret_user {
            Some(user) => match read(user)? {
                Some(secret) => Some(secret),
                None => return Ok(None),
            },
            None => None,
        };
        return Ok(Some((Credential { key, secret }, Origin::Keyring)));
    }
    let (key_name, secret_name) = source.env_names();
    let Some(key) = environment(key_name) else {
        return Ok(None);
    };
    let secret = match secret_name {
        Some(name) => match environment(name) {
            Some(secret) => Some(secret),
            None => return Ok(None),
        },
        None => None,
    };
    Ok(Some((Credential { key, secret }, Origin::Environment)))
}

fn status(source: Source) -> SourceStatus {
    match resolve(source) {
        Ok(Some((_, origin))) => SourceStatus {
            configured: true,
            origin,
        },
        _ => SourceStatus {
            configured: false,
            origin: Origin::None,
        },
    }
}

pub(super) fn all_status() -> SourcesStatus {
    SourcesStatus {
        last_fm: status(Source::LastFm),
        discogs: status(Source::Discogs),
        fanart: status(Source::Fanart),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_local_lines_without_exposing_other_names() {
        let file = "# comment\n\nLAST_FM = \"abcdef123456\"\nLAST_FM_SECRET=zzzzzzzz\nDISCOGS='k1k1k1k1'\nEMPTY=\n";
        assert_eq!(env_value(file, "LAST_FM").as_deref(), Some("abcdef123456"));
        assert_eq!(env_value(file, "DISCOGS").as_deref(), Some("k1k1k1k1"));
        assert_eq!(env_value(file, "EMPTY"), None);
        assert_eq!(env_value(file, "FANART_TV"), None);
        // LAST_FM must not match LAST_FM_SECRET.
        assert_eq!(env_value("LAST_FM_SECRET=nope", "LAST_FM"), None);
    }

    #[test]
    fn rejects_malformed_keys_before_touching_the_credential_store() {
        assert!(normalize("short", "key").is_err());
        assert!(normalize("has space inside it", "key").is_err());
        assert!(normalize(&"x".repeat(MAX_LENGTH + 1), "key").is_err());
        assert_eq!(
            normalize("  abcdef123456  ", "key").unwrap(),
            "abcdef123456"
        );
        assert!(Source::parse("lastFm").is_ok());
        assert!(Source::parse("spotify").is_err());
    }

    #[test]
    fn discogs_requires_a_secret() {
        assert!(save(Source::Discogs, "abcdef123456", None).is_err());
    }
}
