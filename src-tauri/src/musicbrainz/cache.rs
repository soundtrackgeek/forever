use super::status::StatusHub;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_ENTRIES: usize = 4096;
const MAX_BYTES: usize = 64 * 1024 * 1024;
pub(super) const MAX_ENTRY_BYTES: usize = 4 * 1024 * 1024;
const DAY: u64 = 24 * 60 * 60;

#[derive(Clone, Copy)]
pub(super) enum Entity {
    Artists,
    Catalog,
    Cover,
    Editions,
    Tracklist,
}

impl Entity {
    fn name(self) -> &'static str {
        match self {
            Self::Artists => "artists",
            Self::Catalog => "catalog",
            Self::Cover => "cover",
            Self::Editions => "editions",
            Self::Tracklist => "tracklist",
        }
    }
    fn ttl(self) -> Option<u64> {
        match self {
            Self::Artists => Some(DAY),
            Self::Catalog | Self::Cover | Self::Editions => Some(7 * DAY),
            Self::Tracklist => None,
        }
    }
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as u64
}

struct Store {
    path: Option<PathBuf>,
    connection: Option<Connection>,
}

#[derive(Clone)]
pub(super) struct Cache {
    store: Arc<Mutex<Store>>,
    status: StatusHub,
}

fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(std::time::Duration::from_millis(250))?;
    let version: u32 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > 1 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    // A cache failure must never stop startup or modify an unsupported database.
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS metadata (
            entity TEXT NOT NULL, cache_key TEXT NOT NULL, stored_at INTEGER NOT NULL,
            payload BLOB NOT NULL, PRIMARY KEY(entity, cache_key));
        CREATE INDEX IF NOT EXISTS metadata_age ON metadata(stored_at);
        PRAGMA user_version=1;",
    )
}

impl Cache {
    pub fn new(path: Option<PathBuf>, status: StatusHub) -> Self {
        Self {
            store: Arc::new(Mutex::new(Store {
                path,
                connection: None,
            })),
            status,
        }
    }

    async fn run<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> Option<T> {
        let store = self.store.clone();
        let status = self.status.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
            if store.connection.is_none() {
                let disk = store.path.take().map(|path| {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|_| rusqlite::Error::InvalidPath(path.clone()))?;
                    }
                    let connection = Connection::open(path)?;
                    prepare(&connection)?;
                    Ok::<_, rusqlite::Error>(connection)
                });
                store.connection = match disk {
                    Some(Ok(connection)) => Some(connection),
                    other => {
                        if let Some(Err(error)) = other {
                            cache_failure(&status, &error);
                        }
                        let connection = Connection::open_in_memory()?;
                        prepare(&connection)?;
                        Some(connection)
                    }
                };
            }
            let result = operation(store.connection.as_mut().unwrap());
            if let Err(error) = &result {
                cache_failure(&status, error);
                // Preserve the disk file; subsequent calls use a session-only cache.
                store.connection = None;
            }
            result
        })
        .await;
        match result {
            Ok(Ok(value)) => Some(value),
            Ok(Err(_)) => None,
            Err(error) => {
                self.status.cache_warning(format!(
                    "MusicBrainz cache unavailable; discovery can continue online. {error}"
                ));
                None
            }
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, entity: Entity, key: &str) -> Option<T> {
        let key_owned = key.to_owned();
        let bytes = self.run(move |connection| {
            let record: Option<(u64, Vec<u8>)> = connection.query_row(
                "SELECT stored_at, payload FROM metadata WHERE entity=?1 AND cache_key=?2 AND length(payload)<=?3",
                params![entity.name(), key_owned, MAX_ENTRY_BYTES], |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            let now = now_ms();
            Ok(record.filter(|(stored, _)| *stored <= now && entity.ttl().is_none_or(|ttl| now - stored < ttl * 1000)).map(|(_, bytes)| bytes))
        }).await.flatten()?;
        match serde_json::from_slice(&bytes) {
            Ok(value) => Some(value),
            Err(_) => {
                let key = key.to_owned();
                self.run(move |connection| {
                    connection.execute(
                        "DELETE FROM metadata WHERE entity=?1 AND cache_key=?2",
                        params![entity.name(), key],
                    )
                })
                .await;
                self.status.cache_warning("An unreadable MusicBrainz cache entry was discarded and will be fetched again.".into());
                None
            }
        }
    }

    pub async fn put<T: Serialize>(&self, entity: Entity, key: &str, value: &T) {
        let Ok(payload) = serde_json::to_vec(value) else {
            return;
        };
        if payload.len() > MAX_ENTRY_BYTES {
            return;
        }
        let key = key.to_owned();
        self.run(move |connection| {
            let transaction = connection.transaction()?;
            transaction.execute("INSERT INTO metadata(entity,cache_key,stored_at,payload) VALUES(?1,?2,?3,?4)
                ON CONFLICT(entity,cache_key) DO UPDATE SET stored_at=excluded.stored_at,payload=excluded.payload",
                params![entity.name(), key, now_ms(), payload])?;
            prune(&transaction, MAX_ENTRIES, MAX_BYTES)?;
            transaction.commit()
        }).await;
    }
}

fn prune(connection: &Connection, max_entries: usize, max_bytes: usize) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM metadata WHERE rowid IN (SELECT rowid FROM metadata ORDER BY stored_at DESC, rowid DESC LIMIT -1 OFFSET ?1)", [max_entries])?;
    let mut size: usize = connection.query_row(
        "SELECT coalesce(sum(length(payload)),0) FROM metadata",
        [],
        |r| r.get(0),
    )?;
    while size > max_bytes {
        let (id, bytes): (i64, usize) = connection.query_row(
            "SELECT rowid,length(payload) FROM metadata ORDER BY stored_at, rowid LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        connection.execute("DELETE FROM metadata WHERE rowid=?1", [id])?;
        size -= bytes;
    }
    Ok(())
}

fn cache_failure(status: &StatusHub, error: &rusqlite::Error) {
    status.cache_warning(format!("MusicBrainz disk cache unavailable; using a session cache. Existing files were preserved. {error}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn entity_expiry_and_future_timestamps_do_not_return_stale_values() {
        let cache = Cache::new(None, StatusHub::default());
        for entity in [
            Entity::Artists,
            Entity::Catalog,
            Entity::Editions,
            Entity::Tracklist,
        ] {
            cache.put(entity, "id", &vec!["value"]).await;
        }
        cache
            .run(|connection| {
                connection.execute(
                    "UPDATE metadata SET stored_at=?1",
                    [now_ms() - 2 * DAY * 1000],
                )
            })
            .await
            .unwrap();
        assert!(cache
            .get::<Vec<String>>(Entity::Artists, "id")
            .await
            .is_none());
        assert!(cache
            .get::<Vec<String>>(Entity::Catalog, "id")
            .await
            .is_some());
        assert!(cache
            .get::<Vec<String>>(Entity::Editions, "id")
            .await
            .is_some());
        cache
            .run(|connection| {
                connection.execute(
                    "UPDATE metadata SET stored_at=?1",
                    [now_ms() - 8 * DAY * 1000],
                )
            })
            .await
            .unwrap();
        assert!(cache
            .get::<Vec<String>>(Entity::Catalog, "id")
            .await
            .is_none());
        assert!(cache
            .get::<Vec<String>>(Entity::Editions, "id")
            .await
            .is_none());
        assert!(cache
            .get::<Vec<String>>(Entity::Tracklist, "id")
            .await
            .is_some());
        cache
            .run(|connection| {
                connection.execute("UPDATE metadata SET stored_at=?1", [now_ms() + DAY * 1000])
            })
            .await
            .unwrap();
        assert!(cache
            .get::<Vec<String>>(Entity::Tracklist, "id")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn corrupt_database_is_preserved_and_uses_session_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite3");
        let original = b"not a sqlite database";
        std::fs::write(&path, original).unwrap();
        let status = StatusHub::default();
        let cache = Cache::new(Some(path.clone()), status.clone());
        cache.put(Entity::Artists, "id", &vec!["artist"]).await;
        assert_eq!(
            cache
                .get::<Vec<String>>(Entity::Artists, "id")
                .await
                .unwrap(),
            ["artist"]
        );
        assert!(status
            .snapshot()
            .cache_warning
            .unwrap()
            .contains("session cache"));
        assert_eq!(std::fs::read(path).unwrap(), original);
    }

    #[tokio::test]
    async fn unsupported_schema_is_preserved_and_an_unwritable_location_is_optional() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("PRAGMA user_version=99; CREATE TABLE future(data TEXT); INSERT INTO future VALUES('keep');").unwrap();
        drop(connection);
        let original = std::fs::read(&path).unwrap();
        let cache = Cache::new(Some(path.clone()), StatusHub::default());
        cache.put(Entity::Catalog, "id", &vec!["album"]).await;
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(cache
            .get::<Vec<String>>(Entity::Catalog, "id")
            .await
            .is_some());
        let status = StatusHub::default();
        let unavailable = Cache::new(Some(path.join("cannot-be-a-directory")), status.clone());
        unavailable.put(Entity::Catalog, "id", &vec!["album"]).await;
        assert!(unavailable
            .get::<Vec<String>>(Entity::Catalog, "id")
            .await
            .is_some());
        assert!(status.snapshot().cache_warning.is_some());
    }

    #[tokio::test]
    async fn malformed_rows_are_removed_without_disabling_other_cached_entities() {
        let cache = Cache::new(None, StatusHub::default());
        cache.put(Entity::Artists, "bad", &vec!["artist"]).await;
        cache.put(Entity::Artists, "good", &vec!["artist"]).await;
        cache
            .run(|connection| {
                connection.execute(
                    "UPDATE metadata SET payload=x'ff' WHERE cache_key='bad'",
                    [],
                )
            })
            .await
            .unwrap();
        assert!(cache
            .get::<Vec<String>>(Entity::Artists, "bad")
            .await
            .is_none());
        assert!(cache
            .get::<Vec<String>>(Entity::Artists, "good")
            .await
            .is_some());
        let count = cache
            .run(|connection| {
                connection.query_row("SELECT count(*) FROM metadata", [], |r| {
                    r.get::<_, usize>(0)
                })
            })
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn eviction_bounds_both_entry_count_and_payload_bytes() {
        let connection = Connection::open_in_memory().unwrap();
        prepare(&connection).unwrap();
        for i in 0..5 {
            connection
                .execute(
                    "INSERT INTO metadata VALUES('artists',?1,?2,?3)",
                    params![i.to_string(), i, vec![1u8; 10]],
                )
                .unwrap();
        }
        prune(&connection, 3, 100).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM metadata", [], |r| r
                    .get::<_, usize>(0))
                .unwrap(),
            3
        );
        prune(&connection, 3, 15).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT cache_key FROM metadata", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "4"
        );
    }

    #[tokio::test]
    async fn oversized_entries_are_skipped_without_evicting_good_data() {
        let cache = Cache::new(None, StatusHub::default());
        cache.put(Entity::Artists, "good", &vec!["artist"]).await;
        cache
            .put(Entity::Artists, "large", &"x".repeat(MAX_ENTRY_BYTES))
            .await;
        assert!(cache
            .get::<String>(Entity::Artists, "large")
            .await
            .is_none());
        assert!(cache
            .get::<Vec<String>>(Entity::Artists, "good")
            .await
            .is_some());
    }
}
