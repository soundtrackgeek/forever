use super::*;
use crate::musicbrainz::{cache::Entity, MusicBrainzClient};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const ARTIST: &str = "abcdefab-1111-2222-3333-123456789012";
const GROUP: &str = "abcdefab-1111-2222-3333-123456789013";
const RELEASE: &str = "abcdefab-1111-2222-3333-123456789014";

struct Server {
    url: String,
    requests: Arc<StdMutex<Vec<(Instant, String)>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn server(responses: Vec<String>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(StdMutex::new(Vec::new()));
    let seen = requests.clone();
    let task = tokio::spawn(async move {
        for response in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = Vec::new();
            loop {
                let mut buffer = [0; 1024];
                let n = socket.read(&mut buffer).await.unwrap();
                if n == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..n]);
                if data.windows(4).any(|b| b == b"\r\n\r\n") {
                    break;
                }
            }
            seen.lock()
                .unwrap()
                .push((Instant::now(), String::from_utf8(data).unwrap()));
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    Server {
        url,
        requests,
        task,
    }
}

fn response(status: &str, headers: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}\r\n{body}", body.len())
}
fn ok(body: &str) -> String {
    response("200 OK", "", body)
}
fn transport(server: &Server) -> Transport {
    let mut transport = Transport::new(StatusHub::default());
    transport.set_base_url(server.url.clone());
    transport
}

#[test]
fn parses_retry_after_seconds_dates_and_invalid_values() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
    let date = httpdate::fmt_http_date(now + Duration::from_secs(25));
    assert_eq!(retry_after(Some("15"), now), Some(Duration::from_secs(15)));
    assert_eq!(retry_after(Some(&date), now), Some(Duration::from_secs(25)));
    assert_eq!(
        retry_after(
            Some(&httpdate::fmt_http_date(now - Duration::from_secs(1))),
            now
        ),
        Some(Duration::ZERO)
    );
    assert_eq!(retry_after(Some("invalid"), now), None);
    assert_eq!(retry_after(None, now), None);
}

#[tokio::test]
async fn retries_throttling_with_backoff_and_reports_shared_cooldown() {
    let server = server(vec![
        response("503 Busy", "Retry-After: 3\r\n", ""),
        response("429 Limited", "Retry-After: invalid\r\n", ""),
        ok("[]"),
    ])
    .await;
    let transport = transport(&server);
    let value: Vec<String> = transport
        .get("/artist", &[], Instant::now() + LOOKUP_TIMEOUT)
        .await
        .unwrap();
    assert!(value.is_empty());
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[1].0.duration_since(requests[0].0) >= Duration::from_secs(3));
    assert!(requests[2].0.duration_since(requests[1].0) >= Duration::from_secs(4));
    assert!(requests[0].1.contains(USER_AGENT));
    assert!(transport.status.snapshot().retry_at_ms.is_some());
}

#[tokio::test]
async fn retry_budget_is_finite_and_a_long_retry_after_is_not_shortened() {
    let server = server(vec![
        response("503 Busy", "Retry-After: 120\r\n", ""),
        ok("[]"),
    ])
    .await;
    let transport = transport(&server);
    assert!(
        matches!(transport.get::<Vec<String>>("/artist", &[], Instant::now() + LOOKUP_TIMEOUT).await, Err(RequestError::Throttled(n)) if n >= 119)
    );
    assert!(matches!(
        transport
            .get::<Vec<String>>("/release", &[], Instant::now() + LOOKUP_TIMEOUT)
            .await,
        Err(RequestError::Throttled(_))
    ));
    assert_eq!(server.requests.lock().unwrap().len(), 1);

    let server = self::server(vec![response("503 Busy", "", ""); 4]).await;
    let transport = self::transport(&server);
    assert!(matches!(
        transport
            .get::<Vec<String>>("/artist", &[], Instant::now() + LOOKUP_TIMEOUT)
            .await,
        Err(RequestError::Throttled(_))
    ));
    assert_eq!(server.requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn all_requests_share_spacing_and_cancelled_waits_do_not_consume_future_slots() {
    let server = server(vec![ok("[]"); 3]).await;
    let transport = Arc::new(transport(&server));
    transport
        .get::<Vec<String>>("/one", &[], Instant::now() + LOOKUP_TIMEOUT)
        .await
        .unwrap();
    let next = transport.clone();
    let waiting = tokio::spawn(async move {
        next.get::<Vec<String>>("/cancelled", &[], Instant::now() + LOOKUP_TIMEOUT)
            .await
    });
    tokio::task::yield_now().await;
    waiting.abort();
    let _ = waiting.await;
    let deadline = Instant::now() + LOOKUP_TIMEOUT;
    let (a, b) = tokio::join!(
        transport.get::<Vec<String>>("/two", &[], deadline),
        transport.get::<Vec<String>>("/three", &[], deadline)
    );
    a.unwrap();
    b.unwrap();
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests
        .iter()
        .all(|(_, request)| !request.contains("/cancelled")));
    for pair in requests.windows(2) {
        // Server observation can trail the first send slightly; allow 20 ms of scheduling noise.
        assert!(
            pair[1].0.duration_since(pair[0].0) >= REQUEST_INTERVAL - Duration::from_millis(20)
        );
    }
}

#[tokio::test]
async fn permanent_errors_invalid_json_redirects_and_oversized_bodies_are_not_retried() {
    for reply in [
        response("404 Not Found", "", ""),
        response("302 Found", "Location: /redirected\r\n", ""),
        ok("broken"),
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
            MAX_ENTRY_BYTES + 1
        ),
    ] {
        let server = server(vec![reply, ok("[]")]).await;
        assert!(transport(&server)
            .get::<Vec<String>>("/artist", &[], Instant::now() + LOOKUP_TIMEOUT)
            .await
            .is_err());
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn radar_pages_dates_identity_and_dedup_are_independent_of_catalog_cache() {
    let date = crate::musicbrainz::releases::today().to_string();
    let group = |id: &str, artist: &str, date: &str| {
        serde_json::json!({
            "id": id, "title": "Recent single", "first-release-date": date, "primary-type": "Single",
            "artist-credit": [{"artist": {"id": artist}}]
        })
    };
    let server = server(vec![
        ok(&serde_json::json!({"count":5,"offset":0,"release-groups":[group(GROUP, ARTIST, &date), group(RELEASE, GROUP, &date), group(RELEASE, ARTIST, "1980-01-01")]}).to_string()),
        ok(&serde_json::json!({"count":5,"offset":3,"release-groups":[group(GROUP, ARTIST, &date), group(RELEASE, ARTIST, &date)]}).to_string()),
    ]).await;
    let mut client = MusicBrainzClient::with_cache(None, StatusHub::default());
    client.transport.set_base_url(server.url.clone());
    client
        .cache
        .put(
            Entity::Catalog,
            ARTIST,
            &crate::musicbrainz::AlbumCatalog {
                artist_id: ARTIST.into(),
                albums: vec![],
                truncated: false,
            },
        )
        .await;
    let result = client.recent_releases(ARTIST).await.unwrap();
    assert_eq!(result.albums.len(), 2);
    assert!(!result.truncated);
    assert!(result
        .albums
        .iter()
        .all(|a| a.first_release_date == date && a.cover_art_url.contains(&a.id)));
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].1.contains("firstreleasedate"));
    assert!(requests[0].1.contains("status%3Aofficial"));
    assert!(requests[1].1.contains("offset=3"));
}

#[tokio::test]
async fn cache_survives_restart_with_all_entity_fields_and_release_identity() {
    let server = server(vec![
        ok(&format!(r#"{{"artists":[{{"id":"{ARTIST}","name":"Björk","score":100,"type":"Person","country":"IS"}}]}}"#)),
        ok(&format!(r#"{{"release-group-count":1,"release-group-offset":0,"release-groups":[{{"id":"{GROUP}","title":"Album","first-release-date":"1997-09-22","primary-type":"Album","secondary-types":["Live"]}}]}}"#)),
        ok(&format!(r#"{{"release-count":1,"releases":[{{"id":"{RELEASE}","title":"Album","date":"1997","media":[{{"format":"CD","track-count":1}}]}}]}}"#)),
        ok(&format!(r#"{{"status":"Official","release-group":{{"id":"{GROUP}"}},"media":[{{"position":1,"tracks":[{{"position":1,"title":"Song","length":123000}}]}}]}}"#)),
    ]).await;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cache.sqlite3");
    let mut client = MusicBrainzClient::with_cache(Some(path.clone()), StatusHub::default());
    client.transport.set_base_url(server.url.clone());
    let artists = client.search_artists("Björk").await.unwrap();
    let catalog = client.catalog(ARTIST).await.unwrap();
    let editions = client.editions(GROUP).await.unwrap();
    let tracks = client.edition_tracklist(GROUP, None).await.unwrap();
    drop(client);
    // An unusable endpoint proves that the new client reads disk, not a process cache.
    let mut client = MusicBrainzClient::with_cache(Some(path), StatusHub::default());
    client.transport.set_base_url("http://127.0.0.1:0".into());
    assert_eq!(
        serde_json::to_value(client.search_artists("BJÖRK").await.unwrap()).unwrap(),
        serde_json::to_value(artists).unwrap()
    );
    assert_eq!(
        serde_json::to_value(client.catalog(&ARTIST.to_uppercase()).await.unwrap()).unwrap(),
        serde_json::to_value(catalog).unwrap()
    );
    assert_eq!(
        serde_json::to_value(client.editions(GROUP).await.unwrap()).unwrap(),
        serde_json::to_value(editions).unwrap()
    );
    assert_eq!(
        serde_json::to_value(client.edition_tracklist(GROUP, None).await.unwrap()).unwrap(),
        serde_json::to_value(tracks).unwrap()
    );
    assert!(client
        .edition_tracklist(ARTIST, Some(RELEASE))
        .await
        .unwrap_err()
        .contains("does not belong"));
    assert_eq!(server.requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn simultaneous_misses_coalesce_and_failures_never_enter_cache() {
    let server = server(vec![
        ok(r#"{"artists":[]}"#),
        ok("broken"),
        ok(r#"{"artists":[]}"#),
    ])
    .await;
    let mut client = MusicBrainzClient::with_cache(None, StatusHub::default());
    client.transport.set_base_url(server.url.clone());
    let (a, b) = tokio::join!(
        client.search_artists("artist"),
        client.search_artists("ARTIST")
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    assert!(client.search_artists("other").await.is_err());
    assert!(client
        .cache
        .get::<Vec<serde_json::Value>>(Entity::Artists, "other")
        .await
        .is_none());
    assert!(client.search_artists("other").await.is_ok());
    assert_eq!(server.requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn invalid_or_empty_editions_never_become_permanent_tracklists() {
    for body in [
        format!(r#"{{"status":"Bootleg","release-group":{{"id":"{GROUP}"}},"media":[]}}"#),
        format!(r#"{{"status":"Official","release-group":{{"id":"{GROUP}"}},"media":[]}}"#),
    ] {
        let server = server(vec![ok(&body)]).await;
        let mut client = MusicBrainzClient::with_cache(None, StatusHub::default());
        client.transport.set_base_url(server.url.clone());
        assert!(client
            .edition_tracklist(GROUP, Some(RELEASE))
            .await
            .is_err());
        assert!(client
            .cache
            .get::<serde_json::Value>(Entity::Tracklist, RELEASE)
            .await
            .is_none());
    }
}

#[tokio::test]
async fn fresh_cache_hits_remain_available_during_a_provider_cooldown() {
    let server = server(vec![response("503 Busy", "Retry-After: 120\r\n", "")]).await;
    let mut client = MusicBrainzClient::with_cache(None, StatusHub::default());
    client.transport.set_base_url(server.url.clone());
    client
        .cache
        .put(
            Entity::Artists,
            "saved",
            &Vec::<crate::musicbrainz::AlbumArtist>::new(),
        )
        .await;
    assert!(client
        .search_artists("uncached")
        .await
        .unwrap_err()
        .contains("rate-limiting"));
    assert!(client.search_artists("saved").await.unwrap().is_empty());
    assert_eq!(server.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn response_and_queue_waits_obey_the_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut transport = Transport::new(StatusHub::default());
    transport.set_base_url(format!("http://{}", listener.local_addr().unwrap()));
    // Holding the accepted socket without responding exercises a stalled provider.
    let request =
        transport.get::<Vec<String>>("/artist", &[], Instant::now() + Duration::from_millis(100));
    let (result, socket) = tokio::join!(request, listener.accept());
    assert!(matches!(result, Err(RequestError::Timeout)));
    drop(socket);
    let gate = transport.next_request.lock().await;
    assert!(matches!(
        transport
            .get::<Vec<String>>("/artist", &[], Instant::now() + Duration::from_millis(20))
            .await,
        Err(RequestError::Timeout)
    ));
    drop(gate);
}
