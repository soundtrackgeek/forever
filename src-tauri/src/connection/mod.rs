mod credentials;
mod diagnostics;
mod downloads;
mod folders;
mod protocol;
mod search;
mod service;
mod settings;
mod shares;

use search::SearchSnapshot;
use service::{ConnectionBootstrap, ConnectionManager, ConnectionSnapshot, SaveConnectionRequest};
use tauri::{AppHandle, Manager, State};

pub fn initialize(app: &AppHandle) -> Result<ConnectionManager, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let download_directory = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| config_directory.clone())
        .join("Forever");

    ConnectionManager::new(
        app.clone(),
        config_directory.join("connection.json"),
        config_directory.join("transfers.json"),
        config_directory.join("logs").join("connection.log"),
        download_directory,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfers_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<downloads::TransferQueueSnapshot, String> {
    Ok(manager.current_transfers())
}

#[tauri::command]
pub async fn transfer_enqueue(
    manager: State<'_, ConnectionManager>,
    request: downloads::EnqueueTransferRequest,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .enqueue_transfer(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_enqueue_release(
    manager: State<'_, ConnectionManager>,
    request: downloads::EnqueueReleaseRequest,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .enqueue_release(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_pause(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .pause_transfer(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_resume(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .resume_transfer(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_cancel(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .cancel_transfer(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_reveal_path(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<String, String> {
    manager
        .reveal_transfer_path(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_pause_release(
    manager: State<'_, ConnectionManager>,
    release_id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .pause_release(&release_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_resume_release(
    manager: State<'_, ConnectionManager>,
    release_id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .resume_release(&release_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_cancel_release(
    manager: State<'_, ConnectionManager>,
    release_id: String,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .cancel_release(&release_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_clear_completed(
    manager: State<'_, ConnectionManager>,
) -> Result<downloads::TransferQueueSnapshot, String> {
    manager
        .clear_completed_transfers()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn transfer_reveal_release_path(
    manager: State<'_, ConnectionManager>,
    release_id: String,
) -> Result<String, String> {
    manager
        .reveal_release_path(&release_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn folder_inspect(
    manager: State<'_, ConnectionManager>,
    username: String,
    folder: String,
) -> Result<folders::FolderInspection, String> {
    manager
        .inspect_folder(username, folder)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shares_browse(
    manager: State<'_, ConnectionManager>,
    username: String,
    refresh: bool,
) -> Result<shares::UserSharesOverview, String> {
    manager
        .browse_shares(username, refresh)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shares_folder(
    manager: State<'_, ConnectionManager>,
    username: String,
    directory: String,
) -> Result<shares::ShareFolderSnapshot, String> {
    manager
        .shared_folder(&username, &directory)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shares_search(
    manager: State<'_, ConnectionManager>,
    username: String,
    query: String,
    extension: Option<String>,
) -> Result<shares::ShareSearchSnapshot, String> {
    manager
        .search_shares(&username, &query, extension.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_bootstrap(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionBootstrap, String> {
    manager.bootstrap().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_save_profile(
    manager: State<'_, ConnectionManager>,
    request: SaveConnectionRequest,
) -> Result<ConnectionBootstrap, String> {
    manager
        .save_profile(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_connect(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionSnapshot, String> {
    manager.connect().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_disconnect(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionSnapshot, String> {
    manager.disconnect().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_reset(
    manager: State<'_, ConnectionManager>,
) -> Result<ConnectionBootstrap, String> {
    manager.reset().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connection_diagnostics(
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<diagnostics::DiagnosticEntry>, String> {
    Ok(manager.diagnostics())
}

#[tauri::command]
pub async fn search_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<SearchSnapshot, String> {
    Ok(manager.current_search())
}

#[tauri::command]
pub async fn search_start(
    manager: State<'_, ConnectionManager>,
    query: String,
) -> Result<SearchSnapshot, String> {
    manager
        .start_search(query)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_stop(manager: State<'_, ConnectionManager>) -> Result<SearchSnapshot, String> {
    Ok(manager.stop_search())
}
