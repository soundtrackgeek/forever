//! Desktop IPC adapters; all matching policy lives in the portable Rust crate.
pub use forever_matching::*;

fn checked_tolerance(tolerance: Option<MatchTolerance>) -> Result<MatchTolerance, String> {
    let tolerance = tolerance.unwrap_or_default();
    if tolerance.is_valid() {
        Ok(tolerance)
    } else {
        Err("Invalid track length tolerance.".into())
    }
}

#[tauri::command]
pub fn normalize_title(value: String) -> String {
    forever_matching::normalize_title(value)
}

#[tauri::command]
pub async fn tracklist_confidence(
    source_titles: Vec<SourceTitle>,
    official_tracks: Vec<AlbumTrack>,
    artist: String,
    tolerance: Option<MatchTolerance>,
) -> Result<TracklistConfidence, String> {
    let tolerance = checked_tolerance(tolerance)?;
    tauri::async_runtime::spawn_blocking(move || {
        confidence_with(&source_titles, &official_tracks, &artist, tolerance)
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
    tolerance: Option<MatchTolerance>,
) -> Result<Vec<RankedSource>, String> {
    let tolerance = checked_tolerance(tolerance)?;
    tauri::async_runtime::spawn_blocking(move || {
        rank_sources_with(&sources, &preferences, &official_tracks, &artist, tolerance)
    })
    .await
    .map_err(|e| e.to_string())
}
