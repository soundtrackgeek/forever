use super::{
    app_settings::{parse_import, DialMemory, Preferences, Settings, SettingsPatch},
    ConnectionManager,
};
use tauri::State;

#[tauri::command]
pub fn settings_get(manager: State<'_, ConnectionManager>) -> Settings {
    manager.settings_store().get()
}

#[tauri::command]
pub async fn settings_patch(
    manager: State<'_, ConnectionManager>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.patch_settings(patch).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn settings_migrate_webview(
    manager: State<'_, ConnectionManager>,
    preferences: Preferences,
    dial_memory: DialMemory,
) -> Result<Settings, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.migrate_webview_settings(preferences, dial_memory)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn settings_validate_import(json: String) -> Result<Settings, String> {
    parse_import(&json)
}

#[tauri::command]
pub async fn settings_import(
    manager: State<'_, ConnectionManager>,
    json: String,
) -> Result<Settings, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.import_settings(&json))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn settings_reset_section(
    manager: State<'_, ConnectionManager>,
    section: String,
) -> Result<Settings, String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.reset_settings_section(&section))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn settings_export(
    manager: State<'_, ConnectionManager>,
    path: String,
) -> Result<(), String> {
    let settings = manager.settings_store();
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::PathBuf::from(path);
        if !path.is_absolute() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            return Err("Choose a .json settings export file.".into());
        }
        let parent = path
            .parent()
            .ok_or("Choose an export folder.")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let config = settings
            .file()
            .path()
            .parent()
            .ok_or("Missing settings folder.")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if parent == config {
            return Err("Choose an export folder outside Forever's configuration folder.".into());
        }
        // The save dialog authorizes replacement; an atomic replacement keeps an
        // existing export intact if writing the new document fails.
        let file = super::store::JsonFile::new(path);
        file.save(&settings.get()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
