//! Desktop IPC adapters; all matching policy lives in the portable Rust crate.
pub use forever_matching::*;

#[tauri::command]
pub fn normalize_title(value: String) -> String {
    forever_matching::normalize_title(value)
}

#[tauri::command]
pub async fn tracklist_confidence(
    source_titles: Vec<SourceTitle>,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
) -> Result<TracklistConfidence, String> {
    tauri::async_runtime::spawn_blocking(move || {
        confidence(&source_titles, &official_tracks, &artist)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rank_album_sources(
    sources: Vec<RankingSource>,
    preferences: WantedPreferences,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
) -> Result<Vec<RankedSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rank_sources(&sources, &preferences, &official_tracks, &artist)
    })
    .await
    .map_err(|e| e.to_string())
}
