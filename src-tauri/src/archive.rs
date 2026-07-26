use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MUSIC_LIBRARY_APP_DIRECTORY: &str = "com.local.musiclibrary";
const MUSIC_LIBRARY_DATABASE: &str = "music-library.sqlite3";
const MAX_ALBUM_QUERIES: usize = 300;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveStatus {
    pub path: String,
    pub connected: bool,
    pub read_only: bool,
    pub album_count: Option<u64>,
    pub track_count: Option<u64>,
    pub last_imported_at: Option<String>,
    pub last_modified_at_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAlbumQuery {
    pub id: String,
    pub title: String,
    pub first_release_date: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveWantedQuery {
    pub id: String,
    pub artist: String,
    pub title: String,
    pub first_release_date: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveOwnership {
    Owned,
    NotOwned,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAlbumMatch {
    pub album_id: String,
    pub ownership: ArchiveOwnership,
    pub local_album_id: Option<String>,
    pub local_title: Option<String>,
    pub local_artist: Option<String>,
    pub local_year: Option<i32>,
    pub track_count: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMatchResponse {
    pub source: ArchiveStatus,
    pub matches: Vec<ArchiveAlbumMatch>,
}

#[derive(Clone, Debug)]
struct LocalAlbum {
    id: String,
    title: String,
    artist: String,
    year: Option<i32>,
    track_count: u32,
}

fn default_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let forever_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))?;
    let roaming_directory = forever_directory.parent().ok_or_else(|| {
        "Could not resolve the Music Library application data directory.".to_owned()
    })?;
    Ok(roaming_directory
        .join(MUSIC_LIBRARY_APP_DIRECTORY)
        .join(MUSIC_LIBRARY_DATABASE))
}

fn modified_at_ms(path: &Path) -> Option<u64> {
    path.metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn disconnected_status(path: &Path, error: String) -> ArchiveStatus {
    ArchiveStatus {
        path: path.display().to_string(),
        connected: false,
        read_only: true,
        album_count: None,
        track_count: None,
        last_imported_at: None,
        last_modified_at_ms: modified_at_ms(path),
        error: Some(error),
    }
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    if !path.is_file() {
        return Err(format!(
            "Music Library database was not found at {}.",
            path.display()
        ));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        format!("Could not open the Music Library database in read-only mode: {error}")
    })?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| format!("Could not configure the read-only database timeout: {error}"))?;
    connection
        .pragma_update(None, "query_only", true)
        .map_err(|error| format!("Could not enforce query-only access: {error}"))?;
    let query_only = connection
        .pragma_query_value(None, "query_only", |row| row.get::<_, bool>(0))
        .map_err(|error| format!("Could not verify query-only access: {error}"))?;
    if !query_only {
        return Err("SQLite did not accept query-only access.".to_owned());
    }
    Ok(connection)
}

fn status_from_connection(path: &Path, connection: &Connection) -> Result<ArchiveStatus, String> {
    let has_albums = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'albums')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Could not inspect the Music Library schema: {error}"))?;
    if !has_albums {
        return Err(
            "The selected database does not contain the Music Library albums table.".to_owned(),
        );
    }

    let import_summary = connection
        .query_row(
            "SELECT album_count, track_rows, completed_at
             FROM import_runs
             WHERE status = 'completed'
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Could not read the latest Music Library import: {error}"))?;
    let (album_count, track_count, last_imported_at) = import_summary
        .map(|(albums, tracks, imported_at)| (Some(albums), Some(tracks), imported_at))
        .unwrap_or((None, None, None));

    Ok(ArchiveStatus {
        path: path.display().to_string(),
        connected: true,
        read_only: true,
        album_count,
        track_count,
        last_imported_at,
        last_modified_at_ms: modified_at_ms(path),
        error: None,
    })
}

fn status_for_path(path: &Path) -> ArchiveStatus {
    let connection = match open_read_only(path) {
        Ok(connection) => connection,
        Err(error) => return disconnected_status(path, error),
    };
    match status_from_connection(path, &connection) {
        Ok(status) => status,
        Err(error) => disconnected_status(path, error),
    }
}

fn normalize_title(value: &str) -> String {
    let mut normalized = String::new();
    let mut separated = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            normalized.push(character);
            separated = false;
        } else if !normalized.is_empty() && !separated {
            normalized.push(' ');
            separated = true;
        }
    }
    normalized.trim().to_owned()
}

fn year_from_date(value: &str) -> Option<i32> {
    value
        .get(..4)
        .and_then(|year| year.parse::<i32>().ok())
        .filter(|year| (1..=9999).contains(year))
}

fn year_distance(query_year: Option<i32>, local_year: Option<i32>) -> i32 {
    match (query_year, local_year) {
        (Some(query), Some(local)) => (query - local).abs(),
        _ => i32::MAX,
    }
}

fn query_artist_albums(connection: &Connection, artist: &str) -> Result<Vec<LocalAlbum>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, album, album_artist_display, COALESCE(release_year, year), total_tracks
             FROM albums
             WHERE album_artist_display = ?1 COLLATE NOCASE",
        )
        .map_err(|error| format!("Could not prepare the Archive ownership lookup: {error}"))?;
    let rows = statement
        .query_map([artist], |row| {
            Ok(LocalAlbum {
                id: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                year: row.get(3)?,
                track_count: row.get::<_, u32>(4)?,
            })
        })
        .map_err(|error| format!("Could not query Archive albums: {error}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("Could not read Archive album matches: {error}"))
}

fn match_queries(
    local_albums: &[LocalAlbum],
    queries: &[ArchiveAlbumQuery],
) -> Vec<ArchiveAlbumMatch> {
    queries
        .iter()
        .map(|query| {
            let title_key = normalize_title(&query.title);
            let query_year = year_from_date(&query.first_release_date);
            let local = local_albums
                .iter()
                .filter(|album| normalize_title(&album.title) == title_key)
                .min_by(|left, right| {
                    year_distance(query_year, left.year)
                        .cmp(&year_distance(query_year, right.year))
                        .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
                });
            ArchiveAlbumMatch {
                album_id: query.id.clone(),
                ownership: if local.is_some() {
                    ArchiveOwnership::Owned
                } else {
                    ArchiveOwnership::NotOwned
                },
                local_album_id: local.map(|album| album.id.clone()),
                local_title: local.map(|album| album.title.clone()),
                local_artist: local.map(|album| album.artist.clone()),
                local_year: local.and_then(|album| album.year),
                track_count: local.map(|album| album.track_count),
            }
        })
        .collect()
}

fn match_for_path(
    path: &Path,
    artist: &str,
    queries: &[ArchiveAlbumQuery],
) -> ArchiveMatchResponse {
    let connection = match open_read_only(path) {
        Ok(connection) => connection,
        Err(error) => {
            return ArchiveMatchResponse {
                source: disconnected_status(path, error),
                matches: queries
                    .iter()
                    .map(|query| ArchiveAlbumMatch {
                        album_id: query.id.clone(),
                        ownership: ArchiveOwnership::Unknown,
                        local_album_id: None,
                        local_title: None,
                        local_artist: None,
                        local_year: None,
                        track_count: None,
                    })
                    .collect(),
            }
        }
    };
    let source = match status_from_connection(path, &connection) {
        Ok(status) => status,
        Err(error) => {
            return ArchiveMatchResponse {
                source: disconnected_status(path, error),
                matches: Vec::new(),
            }
        }
    };
    match query_artist_albums(&connection, artist) {
        Ok(local_albums) => ArchiveMatchResponse {
            source,
            matches: match_queries(&local_albums, queries),
        },
        Err(error) => ArchiveMatchResponse {
            source: disconnected_status(path, error),
            matches: Vec::new(),
        },
    }
}

fn match_wanted_for_path(path: &Path, queries: &[ArchiveWantedQuery]) -> ArchiveMatchResponse {
    let connection = match open_read_only(path) {
        Ok(connection) => connection,
        Err(error) => {
            return ArchiveMatchResponse {
                source: disconnected_status(path, error),
                matches: queries
                    .iter()
                    .map(|query| ArchiveAlbumMatch {
                        album_id: query.id.clone(),
                        ownership: ArchiveOwnership::Unknown,
                        local_album_id: None,
                        local_title: None,
                        local_artist: None,
                        local_year: None,
                        track_count: None,
                    })
                    .collect(),
            };
        }
    };
    let source = match status_from_connection(path, &connection) {
        Ok(status) => status,
        Err(error) => {
            return ArchiveMatchResponse {
                source: disconnected_status(path, error),
                matches: Vec::new(),
            };
        }
    };
    let mut by_artist: HashMap<String, Result<Vec<LocalAlbum>, String>> = HashMap::new();
    let mut matches = Vec::with_capacity(queries.len());
    for query in queries {
        let artist_key = query.artist.to_lowercase();
        let local_albums = by_artist
            .entry(artist_key)
            .or_insert_with(|| query_artist_albums(&connection, &query.artist));
        let local_albums = match local_albums {
            Ok(local_albums) => local_albums,
            Err(error) => {
                return ArchiveMatchResponse {
                    source: disconnected_status(path, error.clone()),
                    matches: Vec::new(),
                };
            }
        };
        let album_query = ArchiveAlbumQuery {
            id: query.id.clone(),
            title: query.title.clone(),
            first_release_date: query.first_release_date.clone(),
        };
        if let Some(album_match) = match_queries(local_albums, &[album_query]).pop() {
            matches.push(album_match);
        }
    }
    ArchiveMatchResponse { source, matches }
}

#[tauri::command]
pub async fn archive_status(app: AppHandle) -> Result<ArchiveStatus, String> {
    let path = default_database_path(&app)?;
    tokio::task::spawn_blocking(move || status_for_path(&path))
        .await
        .map_err(|error| format!("The Archive status task stopped unexpectedly: {error}"))
}

#[tauri::command]
pub async fn archive_match_albums(
    app: AppHandle,
    artist: String,
    albums: Vec<ArchiveAlbumQuery>,
) -> Result<ArchiveMatchResponse, String> {
    let artist = artist.trim().to_owned();
    if artist.is_empty() || artist.chars().count() > 180 || artist.chars().any(char::is_control) {
        return Err("Choose a valid artist before checking the Archive.".to_owned());
    }
    if albums.len() > MAX_ALBUM_QUERIES
        || albums.iter().any(|album| {
            album.id.chars().count() > 100
                || album.title.chars().count() > 500
                || album.title.chars().any(char::is_control)
        })
    {
        return Err("The Archive can check up to 300 valid albums at a time.".to_owned());
    }
    let path = default_database_path(&app)?;
    tokio::task::spawn_blocking(move || match_for_path(&path, &artist, &albums))
        .await
        .map_err(|error| format!("The Archive ownership task stopped unexpectedly: {error}"))
}

#[tauri::command]
pub async fn archive_match_wanted(
    app: AppHandle,
    albums: Vec<ArchiveWantedQuery>,
) -> Result<ArchiveMatchResponse, String> {
    if albums.len() > 500
        || albums.iter().any(|album| {
            album.id.is_empty()
                || album.id.chars().count() > 100
                || album.artist.trim().is_empty()
                || album.artist.chars().count() > 180
                || album.artist.chars().any(char::is_control)
                || album.title.trim().is_empty()
                || album.title.chars().count() > 500
                || album.title.chars().any(char::is_control)
        })
    {
        return Err("The Archive can check up to 500 valid Wanted albums at a time.".to_owned());
    }
    let path = default_database_path(&app)?;
    tokio::task::spawn_blocking(move || match_wanted_for_path(&path, &albums))
        .await
        .map_err(|error| format!("The Wanted ownership task stopped unexpectedly: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn fixture() -> NamedTempFile {
        let file = NamedTempFile::new().expect("create archive fixture");
        let connection = Connection::open(file.path()).expect("open archive fixture");
        connection
            .execute_batch(
                "CREATE TABLE import_runs (
                    id INTEGER PRIMARY KEY,
                    status TEXT NOT NULL,
                    album_count INTEGER NOT NULL,
                    track_rows INTEGER NOT NULL,
                    completed_at TEXT
                 );
                 CREATE TABLE albums (
                    id TEXT PRIMARY KEY,
                    album TEXT,
                    album_artist_display TEXT,
                    year INTEGER,
                    release_year INTEGER,
                    total_tracks INTEGER NOT NULL
                 );
                 CREATE INDEX idx_albums_artist ON albums(album_artist_display);
                 INSERT INTO import_runs VALUES (1, 'completed', 3, 32, '2026-07-26T12:00:00Z');
                 INSERT INTO albums VALUES
                    ('hysteria-local', 'Hysteria', 'Def Leppard', 1987, 1987, 12),
                    ('pyromania-local', 'Pyromania', 'Def Leppard', 1983, 1983, 10),
                    ('high-dry-local', 'High ''n'' Dry', 'Def Leppard', 1981, 1981, 10);",
            )
            .expect("seed archive fixture");
        drop(connection);
        file
    }

    #[test]
    fn opens_the_external_database_as_query_only() {
        let file = fixture();
        let connection = open_read_only(file.path()).expect("open read-only archive");
        let query_only: bool = connection
            .pragma_query_value(None, "query_only", |row| row.get(0))
            .expect("read query-only pragma");
        assert!(query_only);
        assert!(connection.execute("DELETE FROM albums", []).is_err());
        let remaining: u32 = connection
            .query_row("SELECT COUNT(*) FROM albums", [], |row| row.get(0))
            .expect("count untouched albums");
        assert_eq!(remaining, 3);
    }

    #[test]
    fn reports_import_metadata_without_counting_large_tables() {
        let file = fixture();
        let status = status_for_path(file.path());
        assert!(status.connected);
        assert!(status.read_only);
        assert_eq!(status.album_count, Some(3));
        assert_eq!(status.track_count, Some(32));
        assert_eq!(
            status.last_imported_at.as_deref(),
            Some("2026-07-26T12:00:00Z")
        );
    }

    #[test]
    fn matches_owned_albums_by_normalized_title() {
        let file = fixture();
        let response = match_for_path(
            file.path(),
            "def leppard",
            &[
                ArchiveAlbumQuery {
                    id: "hysteria".to_owned(),
                    title: "Hysteria".to_owned(),
                    first_release_date: "1987-08-03".to_owned(),
                },
                ArchiveAlbumQuery {
                    id: "slang".to_owned(),
                    title: "Slang".to_owned(),
                    first_release_date: "1996-05-13".to_owned(),
                },
                ArchiveAlbumQuery {
                    id: "high-dry".to_owned(),
                    title: "High ’n’ Dry".to_owned(),
                    first_release_date: "1981-07-11".to_owned(),
                },
            ],
        );
        assert!(response.source.connected);
        assert_eq!(response.matches[0].ownership, ArchiveOwnership::Owned);
        assert_eq!(response.matches[0].track_count, Some(12));
        assert_eq!(response.matches[1].ownership, ArchiveOwnership::NotOwned);
        assert_eq!(response.matches[2].ownership, ArchiveOwnership::Owned);
    }

    #[test]
    fn reconciles_wanted_albums_across_artists_without_writing() {
        let file = fixture();
        let response = match_wanted_for_path(
            file.path(),
            &[
                ArchiveWantedQuery {
                    id: "hysteria".to_owned(),
                    artist: "Def Leppard".to_owned(),
                    title: "Hysteria".to_owned(),
                    first_release_date: "1987-08-03".to_owned(),
                },
                ArchiveWantedQuery {
                    id: "other".to_owned(),
                    artist: "Engine Alley".to_owned(),
                    title: "A Sonic Holiday".to_owned(),
                    first_release_date: "1992".to_owned(),
                },
            ],
        );
        assert!(response.source.connected);
        assert_eq!(response.matches[0].ownership, ArchiveOwnership::Owned);
        assert_eq!(response.matches[0].track_count, Some(12));
        assert_eq!(response.matches[1].ownership, ArchiveOwnership::NotOwned);
        let connection = Connection::open(file.path()).expect("reopen archive fixture");
        let remaining: u32 = connection
            .query_row("SELECT COUNT(*) FROM albums", [], |row| row.get(0))
            .expect("count untouched albums");
        assert_eq!(remaining, 3);
    }
}
