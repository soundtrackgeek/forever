use super::*;
use tauri::State;

#[tauri::command]
pub async fn filing_notices(
    hub: State<'_, FilingHub>,
) -> Result<Vec<super::super::store::StoreNotice>> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.notices())
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn filing_history(hub: State<'_, FilingHub>) -> Result<Vec<FilingRecord>> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.history())
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn filing_preview(
    hub: State<'_, FilingHub>,
    request: FilingRequest,
) -> Result<FilingPlan> {
    let artwork = if request.settings.embed_artwork {
        fetch_artwork(
            request
                .artwork_release_id
                .as_deref()
                .ok_or("Choose a MusicBrainz edition before embedding artwork.")?,
        )
        .await?
    } else {
        vec![]
    };
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.preview(request, artwork))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn filing_apply(hub: State<'_, FilingHub>, plan_id: String) -> Result<FilingRecord> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.apply(&plan_id))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn filing_undo_preview(
    hub: State<'_, FilingHub>,
    plan_id: String,
) -> Result<FilingRecord> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let record = hub
            .history()?
            .into_iter()
            .find(|r| r.plan.id == plan_id)
            .ok_or("Filing operation not found.")?;
        check_undo(&record.plan)?;
        Ok(record)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn filing_undo(hub: State<'_, FilingHub>, plan_id: String) -> Result<FilingRecord> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || hub.undo(&plan_id))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn filing_metadata(
    client: State<'_, crate::musicbrainz::MusicBrainzClient>,
    release_group_id: String,
    release_id: String,
) -> Result<Vec<TrackTags>> {
    client.filing_metadata(&release_group_id, &release_id).await
}
fn artwork_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|h| {
            h == "coverartarchive.org" || h == "archive.org" || h.ends_with(".archive.org")
        })
}
async fn fetch_artwork(release_id: &str) -> Result<Vec<u8>> {
    if !crate::musicbrainz::is_musicbrainz_id(release_id) {
        return Err("Invalid artwork release ID.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .user_agent(concat!("Forever/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && artwork_host(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Untrusted artwork redirect")
            }
        }))
        .build()
        .map_err(err)?;
    let mut response = client.get(format!("https://coverartarchive.org/release/{release_id}/front-500")).send().await.map_err(err)?.error_for_status().map_err(|e| format!("Cover Art Archive could not provide a front cover. Disable artwork to continue: {e}"))?;
    const LIMIT: usize = 8 * 1024 * 1024;
    if response.content_length().is_some_and(|n| n > LIMIT as u64) {
        return Err("Artwork exceeds 8 MiB.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(err)? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("Artwork exceeds 8 MiB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    lofty::picture::Picture::from_reader(&mut std::io::Cursor::new(&bytes)).map_err(err)?;
    Ok(bytes)
}
