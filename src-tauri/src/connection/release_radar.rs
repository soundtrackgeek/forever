//! Durable follows and release inbox. The desktop timer runs independently of
//! navigation and Soulseek login; provider requests use MusicBrainz's governor.
use super::{
    store::{self, JsonFile, StoreNotice},
    wanted::WantedAlbumRequest,
    ConnectionManager,
};
use crate::{
    archive,
    musicbrainz::{
        releases::{in_window, today},
        AlbumCatalog, AlbumReleaseGroup, MusicBrainzClient,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const EVENT: &str = "forever://release-radar";
const DAY: u64 = 86_400_000;
const RETRY: u64 = 3_600_000;
const MANUAL_COOLDOWN: u64 = 900_000;
const MAX_ARTISTS: usize = 100;
const MAX_RELEASES: usize = 5000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowedArtist {
    pub artist_id: String,
    pub name: String,
    pub auto_add: bool,
    generation: u64,
    pub followed_at_ms: u64,
    pub last_attempt_at_ms: Option<u64>,
    pub last_checked_at_ms: Option<u64>,
    pub error: Option<String>,
}

impl FollowedArtist {
    fn due(&self, now: u64, manual: bool) -> bool {
        self.last_attempt_at_ms.is_none_or(|last| {
            now.saturating_sub(last)
                >= if manual {
                    MANUAL_COOLDOWN
                } else if self.error.is_some() {
                    RETRY
                } else {
                    DAY
                }
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarRelease {
    pub artist_id: String,
    pub followed_artist_ids: Vec<String>,
    pub artist: String,
    pub album: AlbumReleaseGroup,
    pub discovered_at_ms: u64,
    pub dismissed: bool,
    pub added_to_wanted: bool,
    pub owned: bool,
    pub auto_add_error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Store {
    version: u32,
    generation: u64,
    artists: Vec<FollowedArtist>,
    releases: Vec<RadarRelease>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            version: 1,
            generation: 0,
            artists: vec![],
            releases: vec![],
        }
    }
}

struct Runtime {
    store: Store,
    revision: u64,
    checking: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub artists: Vec<FollowedArtist>,
    pub releases: Vec<RadarRelease>,
    pub revision: u64,
    pub checking: Option<String>,
    pub error: Option<String>,
    pub notices: Vec<StoreNotice>,
}

pub struct ReleaseRadar {
    file: JsonFile,
    state: Mutex<Runtime>,
    refresh: tokio::sync::Mutex<()>,
}

impl ReleaseRadar {
    pub fn new(path: PathBuf) -> Self {
        let file = JsonFile::new(path);
        let store = file.load(Store::default, |bytes| {
            let value: Store = store::decode(bytes, 1, None, &[])?;
            let mut artists = HashSet::new();
            let mut releases = HashSet::new();
            if value.artists.len() > MAX_ARTISTS
                || value.releases.len() > MAX_RELEASES
                || value.artists.iter().any(|a| {
                    !valid_id(&a.artist_id)
                        || a.name.trim().is_empty()
                        || a.name.chars().count() > 180
                        || a.generation > value.generation
                        || !artists.insert(a.artist_id.to_lowercase())
                })
                || value.releases.iter().any(|r| {
                    !valid_id(&r.album.id)
                        || !artists.contains(&r.artist_id)
                        || r.followed_artist_ids.is_empty()
                        || r.followed_artist_ids.iter().any(|id| !artists.contains(id))
                        || !releases.insert(r.album.id.to_lowercase())
                })
            {
                return Err(store::DecodeError::Invalid(
                    "Invalid release radar data.".into(),
                ));
            }
            Ok(value)
        });
        Self {
            file,
            state: Mutex::new(Runtime {
                store,
                revision: 0,
                checking: None,
                error: None,
            }),
            refresh: tokio::sync::Mutex::new(()),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        Snapshot {
            artists: state.store.artists.clone(),
            releases: state.store.releases.clone(),
            revision: state.revision,
            checking: state.checking.clone(),
            error: state.error.clone(),
            notices: self.file.notices(),
        }
    }

    fn change(
        &self,
        operation: impl FnOnce(&mut Store) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.file.is_blocked() {
            return Err("New Release Radar storage is unavailable. Resolve the storage notice and restart before making changes.".into());
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = state.store.clone();
        operation(&mut next)?;
        self.file
            .save(&next)
            .map_err(|e| format!("Could not save New Release Radar: {e}"))?;
        state.store = next;
        state.revision += 1;
        state.error = None;
        Ok(())
    }

    fn follow(&self, id: &str, name: &str, auto_add: bool) -> Result<(), String> {
        let id = id.trim().to_ascii_lowercase();
        let name = name.trim();
        if !valid_id(&id)
            || id == "89ad4ac3-39f7-470e-963a-56509c546377"
            || name.is_empty()
            || name.chars().count() > 180
            || name.chars().any(char::is_control)
        {
            return Err("Choose a named MusicBrainz artist to follow.".into());
        }
        self.change(|store| {
            if let Some(artist) = store.artists.iter_mut().find(|a| a.artist_id == id) {
                artist.auto_add = auto_add;
                return Ok(());
            }
            if store.artists.len() >= MAX_ARTISTS {
                return Err(
                    "You can follow up to 100 artists. Unfollow an artist to make room.".into(),
                );
            }
            store.generation += 1;
            store.artists.push(FollowedArtist {
                artist_id: id,
                name: name.into(),
                auto_add,
                generation: store.generation,
                followed_at_ms: now_ms(),
                last_attempt_at_ms: None,
                last_checked_at_ms: None,
                error: None,
            });
            Ok(())
        })
    }

    fn unfollow(&self, id: &str) -> Result<(), String> {
        self.change(|store| {
            store.artists.retain(|a| a.artist_id != id);
            for release in &mut store.releases {
                release
                    .followed_artist_ids
                    .retain(|artist_id| artist_id != id);
                if release.artist_id == id {
                    if let Some(artist) = store
                        .artists
                        .iter()
                        .find(|a| release.followed_artist_ids.contains(&a.artist_id))
                    {
                        release.artist_id = artist.artist_id.clone();
                        release.artist = artist.name.clone();
                    }
                }
            }
            store.releases.retain(|r| !r.followed_artist_ids.is_empty());
            Ok(())
        })
    }

    fn dismiss(&self, id: &str, dismissed: bool) -> Result<(), String> {
        self.change(|store| {
            let release = store
                .releases
                .iter_mut()
                .find(|r| r.album.id == id)
                .ok_or("This release is no longer in the radar.")?;
            release.dismissed = dismissed;
            Ok(())
        })
    }

    fn publish(&self, app: &AppHandle) {
        let _ = app.emit(EVENT, self.snapshot());
    }

    fn checking(&self, value: Option<String>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.checking = value;
        state.revision += 1;
    }

    fn record_error(&self, error: String) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.error = Some(error);
        state.revision += 1;
    }

    fn begin(&self, artist: &FollowedArtist, now: u64) -> Result<(), String> {
        self.change(|store| {
            let current = store
                .artists
                .iter_mut()
                .find(|a| a.artist_id == artist.artist_id && a.generation == artist.generation)
                .ok_or("Artist was unfollowed.")?;
            current.last_attempt_at_ms = Some(now);
            // A process exit mid-query gets the error retry cadence on restart.
            current.error =
                Some("The previous check did not finish. It will retry automatically.".into());
            Ok(())
        })
    }

    fn finish(
        &self,
        artist: &FollowedArtist,
        result: Result<AlbumCatalog, String>,
        owned: &HashSet<String>,
        mut add: impl FnMut(WantedAlbumRequest) -> Result<(), String>,
    ) -> Result<(), String> {
        self.change(|store| {
            let Some(current) = store.artists.iter_mut().find(|a| a.artist_id == artist.artist_id && a.generation == artist.generation) else { return Ok(()); };
            let catalog = match result {
                Ok(catalog) if catalog.artist_id == artist.artist_id => catalog,
                Ok(_) => { current.error = Some("MusicBrainz returned a different artist.".into()); return Ok(()); }
                Err(error) => { current.error = Some(error); return Ok(()); }
            };
            current.last_checked_at_ms = Some(now_ms());
            current.error = catalog.truncated.then(|| "Partial results: MusicBrainz returned more than 300 recent releases. Another check is scheduled in an hour.".into());
            let auto_add = current.auto_add;
            store.releases.retain(|r| in_window(&r.album, today()));
            let mut returned_ids = HashSet::new();
            for album in catalog.albums.into_iter().filter(|a| in_window(a, today())) {
                returned_ids.insert(album.id.clone());
                if let Some(existing) = store.releases.iter_mut().find(|r| r.album.id == album.id) {
                    if !existing.followed_artist_ids.contains(&artist.artist_id) { existing.followed_artist_ids.push(artist.artist_id.clone()); }
                    existing.album = album;
                    existing.owned = owned.contains(&existing.album.id);
                } else {
                    if store.releases.len() >= MAX_RELEASES {
                        current.error = Some("Radar is full (5,000 recent releases). Unfollow artists to make room; this check will retry.".into());
                        break;
                    }
                    store.releases.push(RadarRelease { artist_id: artist.artist_id.clone(), followed_artist_ids: vec![artist.artist_id.clone()], artist: artist.name.clone(), owned: owned.contains(&album.id), album,
                        discovered_at_ms: now_ms(), dismissed: false, added_to_wanted: false, auto_add_error: None });
                }
            }
            for release in store.releases.iter_mut().filter(|r| returned_ids.contains(&r.album.id) && auto_add && !r.dismissed && !r.added_to_wanted && !r.owned) {
                match add(wanted_request(release)) {
                    Ok(()) => { release.added_to_wanted = true; release.auto_add_error = None; }
                    Err(error) => { release.auto_add_error = Some(error); current.error = Some("Some releases could not be added to Wanted. Retrying in an hour.".into()); }
                }
            }
            store.releases.sort_by(|a, b| b.album.first_release_date.cmp(&a.album.first_release_date).then(a.album.id.cmp(&b.album.id)));
            Ok(())
        })
    }
}

fn wanted_request(release: &RadarRelease) -> WantedAlbumRequest {
    WantedAlbumRequest {
        album_id: release.album.id.clone(),
        artist: release.artist.clone(),
        title: release.album.title.clone(),
        first_release_date: release.album.first_release_date.clone(),
        cover_art_url: Some(release.album.cover_art_url.clone()),
        minimum_track_count: None,
    }
}

async fn refresh(app: &AppHandle, manual: bool) {
    let radar = app.state::<ReleaseRadar>();
    let Ok(_guard) = radar.refresh.try_lock() else {
        return;
    };
    if radar.file.is_blocked() {
        return;
    }
    let candidates: Vec<_> = radar
        .snapshot()
        .artists
        .into_iter()
        .filter(|a| a.due(now_ms(), manual))
        .collect();
    if candidates.is_empty() {
        return;
    }
    for artist in candidates {
        if let Err(error) = radar.begin(&artist, now_ms()) {
            radar.record_error(error);
            continue;
        }
        radar.checking(Some(artist.name.clone()));
        radar.publish(app);
        let result = app
            .state::<MusicBrainzClient>()
            .recent_releases(&artist.artist_id)
            .await;
        let mut owned = HashSet::new();
        if let Ok(catalog) = &result {
            let queries = catalog
                .albums
                .iter()
                .map(|a| archive::ArchiveAlbumQuery {
                    id: a.id.clone(),
                    title: a.title.clone(),
                    first_release_date: a.first_release_date.clone(),
                })
                .collect();
            if let Ok(matches) =
                archive::archive_match_albums(app.clone(), artist.name.clone(), queries).await
            {
                owned.extend(
                    matches
                        .matches
                        .into_iter()
                        .filter(|m| m.ownership == archive::ArchiveOwnership::Owned)
                        .map(|m| m.album_id),
                );
            }
        }
        let app_copy = app.clone();
        let finished = tokio::task::spawn_blocking(move || {
            app_copy
                .state::<ReleaseRadar>()
                .finish(&artist, result, &owned, |request| {
                    app_copy
                        .state::<ConnectionManager>()
                        .add_radar_wanted(request)
                })
        })
        .await;
        match finished {
            Ok(Ok(())) => {}
            Ok(Err(error)) => radar.record_error(error),
            Err(error) => radar.record_error(error.to_string()),
        }
        radar.publish(app);
    }
    radar.checking(None);
    radar.publish(app);
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(60));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            refresh(&app, false).await;
        }
    });
}

#[tauri::command]
pub fn release_radar_snapshot(radar: State<'_, ReleaseRadar>) -> Snapshot {
    radar.snapshot()
}
#[tauri::command]
pub fn release_radar_follow(
    app: AppHandle,
    radar: State<'_, ReleaseRadar>,
    artist_id: String,
    name: String,
    auto_add: bool,
) -> Result<Snapshot, String> {
    radar.follow(&artist_id, &name, auto_add)?;
    radar.publish(&app);
    let copy = app.clone();
    tauri::async_runtime::spawn(async move {
        refresh(&copy, false).await;
    });
    Ok(radar.snapshot())
}
#[tauri::command]
pub fn release_radar_unfollow(
    app: AppHandle,
    radar: State<'_, ReleaseRadar>,
    artist_id: String,
) -> Result<Snapshot, String> {
    radar.unfollow(&artist_id)?;
    radar.publish(&app);
    Ok(radar.snapshot())
}
#[tauri::command]
pub fn release_radar_dismiss(
    app: AppHandle,
    radar: State<'_, ReleaseRadar>,
    album_id: String,
    dismissed: bool,
) -> Result<Snapshot, String> {
    radar.dismiss(&album_id, dismissed)?;
    radar.publish(&app);
    Ok(radar.snapshot())
}
#[tauri::command]
pub fn release_radar_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        refresh(&app, true).await;
    });
}

#[tauri::command]
pub fn release_radar_add_wanted(
    app: AppHandle,
    radar: State<'_, ReleaseRadar>,
    album_id: String,
) -> Result<Snapshot, String> {
    radar.change(|store| {
        let release = store
            .releases
            .iter_mut()
            .find(|r| r.album.id == album_id)
            .ok_or("This release is no longer in the radar.")?;
        app.state::<ConnectionManager>()
            .add_radar_wanted(wanted_request(release))?;
        release.added_to_wanted = true;
        release.auto_add_error = None;
        Ok(())
    })?;
    radar.publish(&app);
    Ok(radar.snapshot())
}

#[cfg(test)]
mod tests;
