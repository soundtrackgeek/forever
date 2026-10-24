//! Native lifetime: hiding a window never stops the connection or transfer workers.
use crate::connection::{app_settings::DesktopSettings, ConnectionManager};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub const WINDOW_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);
const QUIT_EVENT: &str = "forever://quit-requested";

#[derive(Default)]
pub struct DesktopState {
    tray_available: AtomicBool,
    quit_requested: AtomicBool,
    pub exiting: AtomicBool,
    show_requested: AtomicBool,
}

pub fn show_main(app: &AppHandle) {
    // A second launch can arrive before setup has created the first window.
    app.state::<DesktopState>()
        .show_requested
        .store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
        {
            tracing::warn!(%error, "Could not restore Forever window");
        }
    }
}

pub fn request_quit(app: &AppHandle) {
    if app.state::<DesktopState>().exiting.load(Ordering::SeqCst) {
        return;
    }
    app.state::<DesktopState>()
        .quit_requested
        .store(true, Ordering::SeqCst);
    show_main(app);
    // Retained until the UI consumes it, including requests during startup/reload.
    let _ = app.emit(QUIT_EVENT, ());
}

#[tauri::command]
pub fn desktop_quit_requested(state: State<'_, DesktopState>) -> bool {
    state.quit_requested.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn desktop_ack_quit_request(state: State<'_, DesktopState>) {
    state.quit_requested.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn desktop_request_quit(app: AppHandle) {
    request_quit(&app);
}

fn should_hide_on_close(settings: &DesktopSettings, tray_available: bool) -> bool {
    settings.close_to_tray && tray_available
}

pub fn window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let app = window.app_handle();
        let state = app.state::<DesktopState>();
        if state.exiting.load(Ordering::SeqCst) {
            return;
        }
        let settings = app
            .try_state::<ConnectionManager>()
            .map(|m| m.settings_store().get().desktop)
            .unwrap_or_default();
        if should_hide_on_close(&settings, state.tray_available.load(Ordering::SeqCst)) {
            let _ = app.save_window_state(WINDOW_STATE);
            if let Err(error) = window.hide() {
                tracing::warn!(%error, "Could not hide Forever window");
                request_quit(app);
            }
        } else {
            request_quit(app);
        }
    }
}

fn start_hidden(
    args: impl Iterator<Item = String>,
    settings: &DesktopSettings,
    tray_available: bool,
) -> bool {
    tray_available
        && args
            .skip(1)
            .any(|arg| arg == "--background" || (arg == "--autostart" && settings.start_in_tray))
}

pub fn initialize(app: &AppHandle) {
    let available = match create_tray(app) {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(%error, "Tray unavailable; keeping Forever visible");
            false
        }
    };
    let state = app.state::<DesktopState>();
    state.tray_available.store(available, Ordering::SeqCst);
    let settings = app
        .state::<ConnectionManager>()
        .settings_store()
        .get()
        .desktop;
    if !start_hidden(std::env::args(), &settings, available)
        || state.show_requested.load(Ordering::SeqCst)
    {
        show_main(app);
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Forever · Starting", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Forever", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause all transfers", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Forever…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &separator, &open, &pause, &quit])?;
    let mut builder = TrayIconBuilder::with_id("forever")
        .menu(&menu)
        .tooltip("Forever · Starting")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => request_quit(app),
            "pause" => {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = app.state::<ConnectionManager>().toggle_transfer_pause() {
                        show_main(&app);
                        let _ = app.emit("forever://desktop-error", error.to_string());
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous = String::new();
        loop {
            let manager = app.state::<ConnectionManager>();
            let label = manager.desktop_status_label();
            let paused = manager.bandwidth().snapshot().manual_paused;
            if label != previous {
                let _ = status.set_text(&label);
                if let Some(tray) = app.tray_by_id("forever") {
                    let _ = tray.set_tooltip(Some(&label));
                }
                previous = label;
            }
            let _ = pause.set_text(if paused {
                "Resume all transfers"
            } else {
                "Pause all transfers"
            });
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    tray_available: bool,
    autostart_enabled: bool,
}

#[tauri::command]
pub fn desktop_status(app: AppHandle) -> Result<DesktopStatus, String> {
    Ok(DesktopStatus {
        tray_available: app
            .state::<DesktopState>()
            .tray_available
            .load(Ordering::SeqCst),
        autostart_enabled: app.autolaunch().is_enabled().map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn desktop_set_autostart(app: AppHandle, enabled: bool) -> Result<DesktopStatus, String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| e.to_string())?;
    let status = desktop_status(app)?;
    if status.autostart_enabled != enabled {
        return Err("The operating system did not apply the startup change.".into());
    }
    Ok(status)
}

#[tauri::command]
pub async fn desktop_exit(app: AppHandle) -> Result<(), String> {
    // Validate again in native code so neither a stale UI nor a direct invocation
    // can bypass flushing the durable queue. Keep the window alive on failure.
    let state = app.state::<DesktopState>();
    if state.exiting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Err(error) = app
        .state::<ConnectionManager>()
        .prepare_desktop_exit()
        .await
    {
        state.exiting.store(false, Ordering::SeqCst);
        return Err(error);
    }
    let _ = app.save_window_state(WINDOW_STATE);
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_launch_requires_an_explicit_argument_and_working_tray() {
        let settings = DesktopSettings::default();
        let hidden =
            |args: &[&str], tray| start_hidden(args.iter().map(|s| s.to_string()), &settings, tray);
        assert!(!hidden(&["forever"], true));
        assert!(hidden(&["forever", "--autostart"], true));
        assert!(hidden(&["forever", "--background"], true));
        assert!(!hidden(&["forever", "--background"], false));
        assert!(!hidden(&["forever", "--autostart=no"], true));
        let visible = DesktopSettings {
            start_in_tray: false,
            ..settings
        };
        assert!(!start_hidden(
            ["forever".into(), "--autostart".into()].into_iter(),
            &visible,
            true
        ));
    }

    #[test]
    fn close_falls_back_to_safe_exit_if_tray_is_unavailable() {
        assert!(should_hide_on_close(&DesktopSettings::default(), true));
        assert!(!should_hide_on_close(&DesktopSettings::default(), false));
        assert!(!should_hide_on_close(
            &DesktopSettings {
                close_to_tray: false,
                ..Default::default()
            },
            true
        ));
        assert!(!WINDOW_STATE.intersects(StateFlags::VISIBLE));
    }
}
