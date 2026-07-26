mod credentials;
mod diagnostics;
mod distributed;
mod downloads;
mod folders;
mod local_shares;
mod messages;
mod people;
mod protocol;
mod search;
mod service;
mod settings;
mod shares;
mod uploads;

use search::SearchSnapshot;
use service::{
    ConnectionBootstrap, ConnectionManager, ConnectionPaths, ConnectionSnapshot,
    SaveConnectionRequest,
};
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
        ConnectionPaths {
            settings: config_directory.join("connection.json"),
            transfers: config_directory.join("transfers.json"),
            sharing: config_directory.join("sharing.json"),
            people: config_directory.join("people.json"),
            messages: config_directory.join("messages.json"),
            diagnostics: config_directory.join("logs").join("connection.log"),
        },
        download_directory,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn people_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<people::PeopleSnapshot, String> {
    Ok(manager.current_people())
}

#[tauri::command]
pub async fn people_profile(
    manager: State<'_, ConnectionManager>,
    username: String,
    refresh: bool,
) -> Result<people::PersonProfile, String> {
    manager
        .open_person_profile(username, refresh)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn people_set_favorite(
    manager: State<'_, ConnectionManager>,
    username: String,
    favorite: bool,
) -> Result<people::PeopleSnapshot, String> {
    manager
        .set_person_favorite(&username, favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn people_set_blocked(
    manager: State<'_, ConnectionManager>,
    username: String,
    blocked: bool,
) -> Result<people::PeopleSnapshot, String> {
    manager
        .set_person_blocked(&username, blocked)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn people_set_ignored(
    manager: State<'_, ConnectionManager>,
    username: String,
    ignored: bool,
) -> Result<people::PeopleSnapshot, String> {
    manager
        .set_person_ignored(&username, ignored)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<messages::MessagesSnapshot, String> {
    Ok(manager.current_messages())
}

#[tauri::command]
pub async fn messages_send(
    manager: State<'_, ConnectionManager>,
    username: String,
    message: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .send_private_message(username, message)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_retry(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .retry_private_message(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_open(
    manager: State<'_, ConnectionManager>,
    username: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .open_conversation(&username)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_mark_read(
    manager: State<'_, ConnectionManager>,
    username: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .mark_conversation_read(&username)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_mark_unread(
    manager: State<'_, ConnectionManager>,
    username: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .mark_conversation_unread(&username)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_clear(
    manager: State<'_, ConnectionManager>,
    username: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .clear_conversation(&username)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn messages_remove(
    manager: State<'_, ConnectionManager>,
    username: String,
) -> Result<messages::MessagesSnapshot, String> {
    manager
        .remove_conversation(&username)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn local_shares_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    Ok(manager.current_local_shares())
}

#[tauri::command]
pub async fn local_shares_add(
    manager: State<'_, ConnectionManager>,
    path: String,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.add_local_share(&path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn local_shares_remove(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.remove_local_share(&id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn local_shares_set_enabled(
    manager: State<'_, ConnectionManager>,
    id: String,
    enabled: bool,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.set_local_share_enabled(&id, enabled))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn local_shares_rescan(
    manager: State<'_, ConnectionManager>,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.rescan_local_shares())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn local_shares_set_upload_slots(
    manager: State<'_, ConnectionManager>,
    upload_slots: u8,
) -> Result<local_shares::LocalSharesSnapshot, String> {
    manager
        .set_upload_slots(upload_slots)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn uploads_snapshot(
    manager: State<'_, ConnectionManager>,
) -> Result<uploads::UploadQueueSnapshot, String> {
    Ok(manager.current_uploads())
}

#[tauri::command]
pub async fn upload_cancel(
    manager: State<'_, ConnectionManager>,
    id: String,
) -> Result<uploads::UploadQueueSnapshot, String> {
    manager
        .cancel_upload(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn upload_clear_finished(
    manager: State<'_, ConnectionManager>,
) -> Result<uploads::UploadQueueSnapshot, String> {
    Ok(manager.clear_finished_uploads())
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
