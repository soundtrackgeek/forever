use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::Mutex,
    time::{sleep_until, Instant},
};

pub(super) const ALGORITHM: &str =
    "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const CACHE_ENTRIES: usize = 256;
const FRESH: u64 = 7 * 86_400;
const STALE: u64 = 30 * 86_400;

/// A remote service with its own request spacing and cooldown, so one provider's
/// rate limit never stalls another.
#[derive(Clone, Copy)]
pub(super) struct Service {
    pub label: &'static str,
    interval: Duration,
}

pub(super) const LISTENBRAINZ: Service = Service {
    label: "ListenBrainz",
    interval: Duration::from_millis(1100),
};
pub(super) const LASTFM: Service = Service {
    label: "Last.fm",
    interval: Duration::from_millis(300),
};
pub(super) const DISCOGS: Service = Service {
    label: "Discogs",
    interval: Duration::from_millis(1100),
};
pub(super) const FANART: Service = Service {
    label: "Fanart.tv",
    interval: Duration::from_millis(300),
};

pub struct DiscoveryProvider {
    client: Result<reqwest::Client, String>,
    cache: Option<PathBuf>,
    gates: std::sync::Mutex<HashMap<&'static str, Arc<Mutex<Instant>>>>,
}

#[derive(Debug)]
pub(super) struct Data<T> {
    pub value: T,
    pub notice: Option<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn database(path: &PathBuf) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| rusqlite::Error::InvalidPath(path.clone()))?;
    }
    let db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(2))?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS discovery_cache (key TEXT PRIMARY KEY, saved INTEGER NOT NULL, body TEXT NOT NULL);")?;
    Ok(db)
}

async fn read_cache(path: Option<PathBuf>, key: String) -> Result<Option<(u64, String)>, String> {
    let Some(path) = path else { return Ok(None) };
    tokio::task::spawn_blocking(move || {
        let db = database(&path)?;
        db.query_row(
            "SELECT saved, body FROM discovery_cache WHERE key=?1 AND length(body)<=?2",
            params![key, MAX_BYTES],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

async fn write_cache(path: Option<PathBuf>, key: String, body: String) -> Result<(), String> {
    let Some(path) = path else { return Ok(()) };
    tokio::task::spawn_blocking(move || {
        let mut db = database(&path)?;
        let tx = db.transaction()?;
        tx.execute("INSERT OR REPLACE INTO discovery_cache VALUES (?1,?2,?3)", params![key, now(), body])?;
        // A fixed number of compact parsed responses, each bounded by the wire limit.
        tx.execute("DELETE FROM discovery_cache WHERE key NOT IN (SELECT key FROM discovery_cache ORDER BY saved DESC, key LIMIT ?1)", [CACHE_ENTRIES])?;
        tx.commit()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

impl DiscoveryProvider {
    pub fn new(cache: Option<PathBuf>) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            client: reqwest::Client::builder()
                .user_agent(concat!(
                    "Forever/",
                    env!("CARGO_PKG_VERSION"),
                    " (https://github.com/soundtrackgeek/forever)"
                ))
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .build()
                .map_err(|e| e.to_string()),
            cache,
            gates: Default::default(),
        }
    }

    fn gate(&self, service: Service) -> Arc<Mutex<Instant>> {
        self.gates
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(service.label)
            .or_insert_with(|| Arc::new(Mutex::new(Instant::now())))
            .clone()
    }

    pub(super) async fn get<T: DeserializeOwned + Serialize>(
        &self,
        key: String,
        url: &str,
        query: &[(&str, &str)],
    ) -> Result<Data<T>, String> {
        self.get_with(LISTENBRAINZ, key, url, query, &[], |_| Ok(()))
            .await
    }

    /// `headers` carry credentials, which never enter the cache key or any error text.
    /// `check` rejects well-formed responses that are really provider errors
    /// (Last.fm answers a bad key with HTTP 200) before they can be cached.
    pub(super) async fn get_with<T: DeserializeOwned + Serialize>(
        &self,
        service: Service,
        key: String,
        url: &str,
        query: &[(&str, &str)],
        headers: &[(&str, &str)],
        check: impl Fn(&T) -> Result<(), String>,
    ) -> Result<Data<T>, String> {
        let label = service.label;
        // Serialize requests and recheck the cache after waiting: duplicate callers coalesce.
        let gate = self.gate(service);
        let mut next = gate.lock().await;
        let cached = read_cache(self.cache.clone(), key.clone()).await;
        let cache_failed = cached.is_err() || self.cache.is_none();
        let cached = cached.ok().flatten().and_then(|(saved, body)| {
            let age = now().checked_sub(saved)?;
            (age <= STALE)
                .then(|| {
                    serde_json::from_str::<T>(&body)
                        .ok()
                        .map(|value| (age, value))
                })
                .flatten()
        });
        if cached.as_ref().is_some_and(|(age, _)| *age <= FRESH) {
            return Ok(Data {
                value: cached.unwrap().1,
                notice: None,
            });
        }
        if next.saturating_duration_since(Instant::now()) > Duration::from_secs(15) {
            return cached
                .map(|(_, value)| Data {
                    value,
                    notice: Some(format!(
                        "{label} is cooling down; showing saved results (up to 30 days old)."
                    )),
                })
                .ok_or_else(|| format!("{label} is rate-limiting. Try again later."));
        }
        sleep_until(*next).await;
        *next = Instant::now() + service.interval;
        let result = self
            .fetch::<T>(label, url, query, headers, &mut next)
            .await
            .and_then(|value| check(&value).map(|()| value));
        match result {
            Ok(value) => {
                let body = serde_json::to_string(&value).map_err(|e| e.to_string())?;
                let saved = write_cache(self.cache.clone(), key, body).await;
                Ok(Data {
                    value,
                    notice: (cache_failed || saved.is_err()).then(|| {
                        "Discovery cache unavailable; this result may not be available offline."
                            .into()
                    }),
                })
            }
            Err(error) => cached
                .map(|(_, value)| Data {
                    value,
                    notice: Some(format!("{error} Showing saved data (up to 30 days old).")),
                })
                .ok_or(error),
        }
    }

    async fn fetch<T: DeserializeOwned>(
        &self,
        label: &str,
        url: &str,
        query: &[(&str, &str)],
        headers: &[(&str, &str)],
        next: &mut Instant,
    ) -> Result<T, String> {
        let client = self
            .client
            .as_ref()
            .map_err(|_| format!("{label} networking is unavailable."))?;
        let mut request = client.get(url).query(query);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| format!("Could not reach {label}. Try again later."))?;
        if response.status().as_u16() == 429 || response.status().as_u16() == 503 {
            let wait = response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok())
                .and_then(|h| {
                    h.parse::<u64>().ok().or_else(|| {
                        httpdate::parse_http_date(h)
                            .ok()?
                            .duration_since(SystemTime::now())
                            .ok()
                            .map(|d| d.as_secs())
                    })
                })
                .unwrap_or(60)
                .clamp(1, 3600);
            *next = Instant::now() + Duration::from_secs(wait);
        }
        if !response.status().is_success() {
            return Err(format!(
                "{label} returned HTTP {}. Try again later.",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BYTES as u64)
        {
            return Err(format!("{label} response was too large."));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| format!("{label} response was interrupted."))?
        {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(format!("{label} response was too large."));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| format!("{label} returned an unsupported response."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn serve(response: &'static [u8]) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 2048];
            assert!(stream.read(&mut bytes).await.unwrap() > 0);
            stream.write_all(response).await.unwrap();
        });
        (url, task)
    }

    #[tokio::test]
    async fn throttling_establishes_shared_cooldown_without_hiding_saved_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = Some(dir.path().join("cache.sqlite3"));
        write_cache(path.clone(), "old".into(), "[9]".into())
            .await
            .unwrap();
        database(path.as_ref().unwrap())
            .unwrap()
            .execute("UPDATE discovery_cache SET saved=?1", [now() - FRESH - 1])
            .unwrap();
        let provider = DiscoveryProvider::new(path);
        let (url, server) = serve(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        let result = provider
            .get::<Vec<u32>>("old".into(), &url, &[])
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(result.value, vec![9]);
        assert!(result.notice.unwrap().contains("HTTP 429"));
        assert!(
            provider
                .gate(LISTENBRAINZ)
                .lock()
                .await
                .saturating_duration_since(Instant::now())
                > Duration::from_secs(100)
        );
        assert!(provider
            .get::<Vec<u32>>("new".into(), &url, &[])
            .await
            .unwrap_err()
            .contains("rate-limiting"));
    }

    #[tokio::test]
    async fn invalid_and_oversized_responses_never_enter_the_cache() {
        for response in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\n???".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\nConnection: close\r\n\r\n".as_slice(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = Some(dir.path().join("cache.sqlite3"));
            let provider = DiscoveryProvider::new(path.clone());
            let (url, task) = serve(response).await;
            assert!(provider
                .get::<Vec<u32>>("test".into(), &url, &[])
                .await
                .is_err());
            task.await.unwrap();
            assert!(read_cache(path, "test".into()).await.unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn cache_has_a_fixed_entry_bound() {
        let dir = tempfile::tempdir().unwrap();
        let path = Some(dir.path().join("cache.sqlite3"));
        for i in 0..CACHE_ENTRIES + 6 {
            write_cache(path.clone(), format!("key-{i}"), "[]".into())
                .await
                .unwrap();
        }
        assert_eq!(
            database(path.as_ref().unwrap())
                .unwrap()
                .query_row("SELECT COUNT(*) FROM discovery_cache", [], |row| row
                    .get::<_, u32>(0))
                .unwrap(),
            CACHE_ENTRIES as u32
        );
    }

    #[tokio::test]
    async fn caches_across_restart_and_falls_back_on_http_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = Some(dir.path().join("discovery.sqlite3"));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 2048];
            assert!(stream.read(&mut bytes).await.unwrap() > 0);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\n[7]")
                .await
                .unwrap();
        });
        let provider = DiscoveryProvider::new(path.clone());
        assert_eq!(
            provider
                .get::<Vec<u32>>("test".into(), &url, &[])
                .await
                .unwrap()
                .value,
            vec![7]
        );
        server.await.unwrap();
        let restarted = DiscoveryProvider::new(path.clone());
        assert!(restarted
            .get::<Vec<u32>>("test".into(), &url, &[])
            .await
            .unwrap()
            .notice
            .is_none());
        database(path.as_ref().unwrap())
            .unwrap()
            .execute("UPDATE discovery_cache SET saved=?1", [now() - FRESH - 1])
            .unwrap();
        let stale = restarted
            .get::<Vec<u32>>("test".into(), &url, &[])
            .await
            .unwrap();
        assert_eq!(stale.value, vec![7]);
        assert!(stale.notice.unwrap().contains("saved data"));
        database(path.as_ref().unwrap())
            .unwrap()
            .execute("UPDATE discovery_cache SET saved=?1", [now() - STALE - 1])
            .unwrap();
        assert!(restarted
            .get::<Vec<u32>>("test".into(), &url, &[])
            .await
            .is_err());
    }
}
