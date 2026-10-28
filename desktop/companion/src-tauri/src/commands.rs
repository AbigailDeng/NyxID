use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::desktop::emit_state_changed;
use crate::model::{CompanionSettings, CompanionSnapshot};
use crate::nyxid::{
    NyxIdChatCommandError, NyxIdChatEvent, NyxIdChatHistory, NyxIdChatRecovery, NyxIdChatRequest,
    NyxIdState, NyxIdView, NyxIdVoiceFrame, NyxIdVoiceOptions, NyxIdVoiceRequest,
    NyxIdVoiceSession, NyxIdVoiceStart, NyxIdVoiceStarted, NyxIdVoiceState,
};
use crate::state::CompanionState;
use crate::window::{self, WindowMode};

#[tauri::command]
pub fn companion_snapshot(state: State<'_, CompanionState>) -> Result<CompanionSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub fn save_companion_settings(
    app: AppHandle,
    state: State<'_, CompanionState>,
    settings: CompanionSettings,
) -> Result<CompanionSnapshot, String> {
    let update = state.replace_settings(settings, |update| {
        if update.changed {
            emit_state_changed(&app, &update.snapshot)?;
        }
        Ok(())
    })?;
    Ok(update.snapshot)
}

#[tauri::command]
pub fn set_window_mode(app: AppHandle, mode: WindowMode) -> Result<(), String> {
    window::set_mode(&app, mode).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_window_drag(app: AppHandle) -> Result<(), String> {
    window::start_drag(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| error.to_string())?;
    manager.is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_nyxid_assistant(app: AppHandle) -> Result<(), String> {
    crate::desktop::open_nyxid_assistant(&app)
}

#[tauri::command]
pub fn nyxid_status(state: State<'_, NyxIdState>) -> NyxIdView {
    state.view()
}

#[tauri::command]
pub async fn start_nyxid_login(
    app: AppHandle,
    state: State<'_, NyxIdState>,
) -> Result<NyxIdView, String> {
    Ok(state.inner().clone().start_login(app).await)
}

#[tauri::command]
pub async fn cancel_nyxid_login(
    app: AppHandle,
    state: State<'_, NyxIdState>,
) -> Result<NyxIdView, String> {
    Ok(state.inner().clone().cancel_login(app).await)
}

#[tauri::command]
pub async fn refresh_nyxid_capabilities(
    app: AppHandle,
    state: State<'_, NyxIdState>,
) -> Result<NyxIdView, String> {
    Ok(state.inner().clone().refresh_capabilities(app).await)
}

#[tauri::command]
pub async fn logout_nyxid(
    app: AppHandle,
    state: State<'_, NyxIdState>,
    voice: State<'_, NyxIdVoiceState>,
) -> Result<NyxIdView, String> {
    voice.stop_all();
    Ok(state.inner().clone().logout(app).await)
}

#[tauri::command]
pub async fn send_nyxid_chat(
    app: AppHandle,
    state: State<'_, NyxIdState>,
    request: NyxIdChatRequest,
) -> Result<NyxIdChatEvent, NyxIdChatCommandError> {
    state.inner().clone().send_chat(app, request).await
}

#[tauri::command]
pub async fn recover_nyxid_chat(
    app: AppHandle,
    state: State<'_, NyxIdState>,
) -> Result<Option<NyxIdChatRecovery>, String> {
    state.inner().clone().recover_chat(app).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn nyxid_chat_history(
    app: AppHandle,
    state: State<'_, NyxIdState>,
    conversation_id: String,
) -> Result<NyxIdChatHistory, String> {
    state
        .inner()
        .clone()
        .chat_history(app, conversation_id)
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn nyxid_chat_stop(
    app: AppHandle,
    state: State<'_, NyxIdState>,
    conversation_id: String,
) -> Result<(), String> {
    state.inner().clone().stop_chat(app, conversation_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn nyxid_voice_options(
    app: AppHandle,
    nyxid: State<'_, NyxIdState>,
    conversation_id: Option<String>,
) -> Result<NyxIdVoiceOptions, String> {
    NyxIdVoiceState::options(&nyxid, app, conversation_id).await
}

#[tauri::command]
pub async fn start_nyxid_voice(
    app: AppHandle,
    nyxid: State<'_, NyxIdState>,
    state: State<'_, NyxIdVoiceState>,
    request: NyxIdVoiceStart,
) -> Result<NyxIdVoiceStarted, String> {
    state.start(&nyxid, app, request).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn control_nyxid_voice(
    app: AppHandle,
    nyxid: State<'_, NyxIdState>,
    state: State<'_, NyxIdVoiceState>,
    session_id: String,
    action: String,
) -> Result<NyxIdVoiceSession, String> {
    state.control(&nyxid, app, session_id, action).await
}

#[tauri::command]
pub async fn send_nyxid_voice_frame(
    state: State<'_, NyxIdVoiceState>,
    frame: NyxIdVoiceFrame,
) -> Result<(), String> {
    state.send(frame).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn nyxid_voice_request(
    app: AppHandle,
    nyxid: State<'_, NyxIdState>,
    conversation_id: String,
    request_id: String,
) -> Result<NyxIdVoiceRequest, String> {
    NyxIdVoiceState::request(&nyxid, app, conversation_id, request_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_nyxid_voice_request(
    app: AppHandle,
    nyxid: State<'_, NyxIdState>,
    conversation_id: String,
    request_id: String,
) -> Result<(), String> {
    NyxIdVoiceState::cancel_request(&nyxid, app, conversation_id, request_id).await
}
