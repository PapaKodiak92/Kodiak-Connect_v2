mod linux_webrtc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

static SHOULD_QUIT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Default, Deserialize, Serialize)]
struct KodiakWindowPrefs {
    start_minimized: bool,
}

fn window_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join("window-prefs.json"))
}

fn read_window_prefs(app: &AppHandle) -> KodiakWindowPrefs {
    let Ok(path) = window_prefs_path(app) else {
        return KodiakWindowPrefs::default();
    };

    let Ok(raw_prefs) = fs::read_to_string(path) else {
        return KodiakWindowPrefs::default();
    };

    serde_json::from_str(&raw_prefs).unwrap_or_default()
}

fn write_window_prefs(app: &AppHandle, prefs: &KodiakWindowPrefs) -> Result<(), String> {
    let path = window_prefs_path(app)?;

    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir).map_err(|error| error.to_string())?;
    }

    let raw_prefs = serde_json::to_string_pretty(prefs).map_err(|error| error.to_string())?;
    fs::write(path, raw_prefs).map_err(|error| error.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn choose_save_path(suggested_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_file_name(&suggested_name)
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn write_downloaded_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_start_minimized(app: AppHandle) -> bool {
    read_window_prefs(&app).start_minimized
}

#[tauri::command]
fn set_start_minimized(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let mut prefs = read_window_prefs(&app);
    prefs.start_minimized = enabled;
    write_window_prefs(&app, &prefs)?;
    Ok(enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            choose_save_path,
            write_downloaded_file,
            get_start_minimized,
            set_start_minimized,
            linux_webrtc::kodiak_linux_rtc_create_offer,
            linux_webrtc::kodiak_linux_rtc_create_answer,
            linux_webrtc::kodiak_linux_rtc_apply_answer,
            linux_webrtc::kodiak_linux_rtc_add_ice_candidate,
            linux_webrtc::kodiak_linux_rtc_set_muted,
            linux_webrtc::kodiak_linux_rtc_close
        ])
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open Kodiak Connect", true, None::<&str>)?;
            let start_minimized_item = MenuItem::with_id(
                app,
                "toggle_start_minimized",
                "Toggle start minimized",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Kodiak Connect", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &start_minimized_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("kodiak-connect-tray")
                .tooltip("Kodiak Connect")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "toggle_start_minimized" => {
                        let mut prefs = read_window_prefs(app);
                        prefs.start_minimized = !prefs.start_minimized;

                        if let Err(error) = write_window_prefs(app, &prefs) {
                            eprintln!("[Kodiak Connect] failed to save start minimized setting: {error}");
                        }
                    }
                    "quit" => {
                        SHOULD_QUIT.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            if read_window_prefs(app.handle()).start_minimized {
                hide_main_window(app.handle());
            } else {
                show_main_window(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if SHOULD_QUIT.load(Ordering::SeqCst) {
                    return;
                }

                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Kodiak Connect");
}
