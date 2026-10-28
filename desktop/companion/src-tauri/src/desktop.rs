use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::model::CompanionSnapshot;
use crate::window;

pub const STATE_CHANGED_EVENT: &str = "companion://state-changed";
const NYXID_ASSISTANT_URL: &str = "https://nyx.chrono-ai.fun/assistant";

pub fn open_nyxid_assistant(app: &AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(NYXID_ASSISTANT_URL, None::<&str>)
        .map_err(|error| error.to_string())
}

pub fn emit_state_changed(app: &AppHandle, snapshot: &CompanionSnapshot) -> Result<(), String> {
    app.emit(STATE_CHANGED_EVENT, snapshot.clone())
        .map_err(|error| error.to_string())
}

pub fn install_tray(app: &mut App<Wry>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示 Nyx", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏 Nyx", true, None::<&str>)?;
    let open_item = MenuItem::with_id(app, "open-nyxid", "打开 NyxID", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show_item, &hide_item, &open_item, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id("companion")
        .tooltip("NyxID 桌面小精灵")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = window::show(app);
            }
            "hide" => {
                let _ = window::hide(app);
            }
            "open-nyxid" => {
                if let Err(error) = open_nyxid_assistant(app) {
                    eprintln!("failed to open NyxID: {error}");
                }
            }
            "quit" => {
                window::flush_placement(app);
                app.exit(0);
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
                let _ = window::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
