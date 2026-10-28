mod commands;
mod desktop;
mod model;
mod nyxid;
mod persistence;
mod state;
mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::model::CompanionSnapshot;
use crate::persistence::SnapshotStore;
use crate::state::CompanionState;

const AUTOSTART_ARGUMENT: &str = "--autostart";

pub fn run() {
    tauri::Builder::default()
        // This must stay first so duplicate processes cannot initialize other plugins.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let result = if args.iter().any(|argument| argument == AUTOSTART_ARGUMENT) {
                window::present(app)
            } else {
                window::show(app)
            };
            let _ = result;
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARGUMENT]),
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_data_dir = app.path().app_data_dir()?;
            let store = SnapshotStore::in_directory(&app_data_dir);
            let snapshot = match store.load() {
                Ok(Some(snapshot)) => snapshot,
                Ok(None) => {
                    let snapshot = CompanionSnapshot::default();
                    store.save(&snapshot)?;
                    snapshot
                }
                Err(error) => {
                    eprintln!("ignoring invalid companion snapshot: {error}");
                    let snapshot = CompanionSnapshot::default();
                    store.save(&snapshot)?;
                    snapshot
                }
            };
            app.manage(CompanionState::new(snapshot, store));
            let nyxid_state = nyxid::NyxIdState::system(app_data_dir)?;
            app.manage(nyxid_state.clone());
            app.manage(nyxid::NyxIdVoiceState::default());

            window::configure_main_window(app.handle())?;
            desktop::install_tray(app)?;
            if std::env::args().any(|argument| argument == AUTOSTART_ARGUMENT) {
                window::present(app.handle())?;
            } else {
                window::show(app.handle())?;
            }
            nyxid_state.bootstrap(app.handle().clone());
            Ok(())
        })
        .on_window_event(|app_window, event| match event {
            WindowEvent::Moved(position) => {
                window::handle_window_moved(app_window, *position);
            }
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                window::handle_window_geometry_changed(app_window);
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = app_window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::companion_snapshot,
            commands::save_companion_settings,
            commands::set_window_mode,
            commands::start_window_drag,
            commands::get_launch_at_login,
            commands::set_launch_at_login,
            commands::open_nyxid_assistant,
            commands::nyxid_status,
            commands::start_nyxid_login,
            commands::cancel_nyxid_login,
            commands::refresh_nyxid_capabilities,
            commands::logout_nyxid,
            commands::send_nyxid_chat,
            commands::recover_nyxid_chat,
            commands::nyxid_chat_history,
            commands::nyxid_chat_stop,
            commands::nyxid_voice_options,
            commands::start_nyxid_voice,
            commands::control_nyxid_voice,
            commands::send_nyxid_voice_frame,
            commands::nyxid_voice_request,
            commands::cancel_nyxid_voice_request,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run NyxID Companion");
}
