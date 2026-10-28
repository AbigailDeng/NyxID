//! Native first-party voice transport. Credentials never cross the webview IPC boundary.
use super::{NyxIdState, chat::valid_conversation_id, client::API_ORIGIN};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{Message, client::IntoClientRequest, protocol::WebSocketConfig},
};

const ORIGIN: &str = "https://nyx.chrono-ai.fun";
const EVENT: &str = "companion://nyxid-voice";
const BODY_LIMIT: usize = 512 * 1024;

#[derive(Clone, Serialize, Deserialize)]
pub struct NyxIdVoiceSession {
    pub id: String,
    pub generation: i64,
    pub state: String,
    pub muted: bool,
    pub input_muted: bool,
    pub control_revision: i64,
    pub observed_seconds: i64,
    pub end_reason: Option<String>,
    pub idle_warning: bool,
}
#[derive(Serialize, Deserialize)]
pub struct NyxIdVoiceRequest {
    id: String,
    state: String,
    turn_id: String,
    pending_acknowledgement_ids: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct VoiceName {
    id: String,
    label: String,
}
#[derive(Serialize, Deserialize)]
pub struct VoiceMetadata {
    protocol: String,
    voices: Vec<VoiceName>,
}
#[derive(Serialize, Deserialize)]
pub struct VoicePriceComponent {
    metric: String,
    credits_per_unit: String,
    sync_status: String,
}
#[derive(Serialize, Deserialize)]
pub struct VoicePrice {
    #[serde(default)]
    components: Vec<VoicePriceComponent>,
    metric: String,
    credits_per_unit: String,
    sync_status: String,
}
#[derive(Serialize, Deserialize)]
pub struct VoiceOption {
    service_id: String,
    connection_id: Option<String>,
    key_source: String,
    model: String,
    model_label: String,
    default_model: bool,
    voice: VoiceMetadata,
    available: bool,
    unavailable_reason: Option<String>,
    pricing: Option<VoicePrice>,
    reported_token_pricing: Option<VoicePrice>,
    billing_owner: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NyxIdVoiceOptions {
    conversation_id: String,
    options: Vec<VoiceOption>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VoicePreferences {
    service_id: String,
    connection_id: Option<String>,
    key_source: String,
    model: String,
    voice: Option<String>,
    input_mode: String,
    language: Option<String>,
    notify_on_completion: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NyxIdVoiceStart {
    conversation_id: String,
    client_request_id: String,
    preferences: VoicePreferences,
    sdp_offer: String,
}
#[derive(Serialize, Deserialize)]
pub struct NyxIdVoiceStarted {
    session: NyxIdVoiceSession,
    sdp_answer: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum NyxIdVoiceFrame {
    PttBegin {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    PttCommit {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Pcm {
        #[serde(rename = "sessionId")]
        session_id: String,
        pcm: Vec<u8>,
    },
    Heartbeat {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "playbackMs")]
        playback_ms: i64,
        #[serde(rename = "playbackAudible")]
        playback_audible: bool,
    },
}
#[derive(Clone, Serialize, Deserialize)]
struct Caption {
    id: String,
    speaker: String,
    text: String,
    sealed: bool,
    complete: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Task {
    id: String,
    turn_id: String,
    state: String,
    pending_acknowledgement_ids: Vec<String>,
    title: Option<String>,
    result_message_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Snapshot {
    #[serde(rename = "type")]
    kind: String,
    session: NyxIdVoiceSession,
    captions: Vec<Caption>,
    tasks: Vec<Task>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum VoiceEvent {
    Snapshot {
        #[serde(rename = "sessionId")]
        session_id: String,
        snapshot: Snapshot,
    },
    Audio {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "endMs")]
        end_ms: i64,
        pcm: Vec<u8>,
    },
    AudioFlush {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Error {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
    },
    Closed {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}
struct ActiveCall {
    owner: String,
    conversation_id: String,
    session: NyxIdVoiceSession,
    sender: mpsc::Sender<Message>,
}
#[derive(Clone, Default)]
pub struct NyxIdVoiceState {
    active: Arc<Mutex<Option<ActiveCall>>>,
    admission: Arc<tokio::sync::Mutex<()>>,
}

fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|v| v.get_version() == Some(uuid::Version::Random))
}
fn path(conversation: &str) -> String {
    format!("/assistant/nyxagent/conversations/{conversation}/voice-sessions")
}
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法建立安全的语音连接。".into())
}
async fn body<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "语音响应接收失败。".to_owned())?
    {
        if bytes.len() + chunk.len() > BODY_LIMIT {
            return Err("NyxID 语音响应过大。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &bytes));
    }
    serde_json::from_slice(&bytes).map_err(|_| "NyxID 返回了无法识别的语音状态。".into())
}
fn error_message(status: u16, bytes: &[u8]) -> String {
    let code = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|v| v.get("error_code").and_then(Value::as_i64));
    match (status, code) {
        (401, _) => "NyxID 登录已失效，请重新连接。",
        (_, Some(12500)) => "语音队列已满，请稍后再试。",
        (409, _) => "这个账号已有通话或语音状态已更新，请先在 NyxID 结束原通话后重试。",
        (403, _) => "当前账号尚未启用 NyxID 语音，或没有可用的语音权限。",
        (402, _) => "NyxID 可用额度不足，请补充额度后再开始语音。",
        (429, _) => "语音请求过于频繁，请稍后再试。",
        _ => "NyxID 语音暂时不可用，请检查语音服务配置后重试。",
    }
    .into()
}
impl NyxIdVoiceState {
    pub async fn request(
        nyxid: &NyxIdState,
        app: AppHandle,
        conversation_id: String,
        request_id: String,
    ) -> Result<NyxIdVoiceRequest, String> {
        if !valid_conversation_id(&conversation_id) || !valid_id(&request_id) {
            return Err("语音任务标识无效。".into());
        }
        let owner = nyxid.connected_owner_id()?;
        let (token, _) = nyxid.chat_credential(&app).await?;
        let request:NyxIdVoiceRequest=body(http()?.get(format!("{API_ORIGIN}/api/v1/assistant/nyxagent/conversations/{conversation_id}/voice-requests/{request_id}")).bearer_auth(token.as_str()).send().await.map_err(|_|"无法读取语音任务。".to_owned())?).await?;
        if request.id != request_id || nyxid.connected_owner_id().as_deref() != Ok(owner.as_str()) {
            return Err("语音任务状态已变化。".into());
        }
        Ok(request)
    }
    pub async fn cancel_request(
        nyxid: &NyxIdState,
        app: AppHandle,
        conversation_id: String,
        request_id: String,
    ) -> Result<(), String> {
        if !valid_conversation_id(&conversation_id) || !valid_id(&request_id) {
            return Err("语音任务标识无效。".into());
        }
        let (token, _) = nyxid.chat_credential(&app).await?;
        let response=http()?.post(format!("{API_ORIGIN}/api/v1/assistant/nyxagent/conversations/{conversation_id}/voice-requests/{request_id}/cancel")).bearer_auth(token.as_str()).json(&json!({})).send().await.map_err(|_|"语音任务停止请求尚未确认。".to_owned())?;
        if response.status().is_success() {
            Ok(())
        } else {
            body::<Value>(response).await.map(|_| ())
        }
    }

    pub fn stop_all(&self) {
        if let Some(call) = self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            let _ = call.sender.try_send(Message::Close(None));
        }
    }
    pub async fn options(
        nyxid: &NyxIdState,
        app: AppHandle,
        conversation_id: Option<String>,
    ) -> Result<NyxIdVoiceOptions, String> {
        let owner = nyxid.connected_owner_id()?;
        let (token, _) = nyxid.chat_credential(&app).await?;
        let client = http()?;
        let conversation_id = match conversation_id {
            Some(id) if valid_conversation_id(&id) => id,
            Some(_) => return Err("NyxID 会话标识无效。".into()),
            None => {
                #[derive(Deserialize)]
                struct Draft {
                    id: String,
                }
                let draft: Draft = body(
                    client
                        .post(format!("{API_ORIGIN}/api/v1/assistant/nyxagent/drafts"))
                        .bearer_auth(token.as_str())
                        .json(&json!({}))
                        .send()
                        .await
                        .map_err(|_| "无法创建 NyxID 对话。".to_owned())?,
                )
                .await?;
                if !valid_conversation_id(&draft.id) {
                    return Err("NyxID 会话标识无效。".into());
                }
                draft.id
            }
        };
        #[derive(Deserialize)]
        struct Options {
            options: Vec<VoiceOption>,
        }
        let result: Options = body(
            client
                .get(format!(
                    "{API_ORIGIN}/api/v1/assistant/nyxagent/voice/options"
                ))
                .query(&[("conversation_id", &conversation_id)])
                .bearer_auth(token.as_str())
                .send()
                .await
                .map_err(|_| "无法读取 NyxID 语音服务。".to_owned())?,
        )
        .await?;
        if nyxid.connected_owner_id().as_deref() != Ok(owner.as_str()) {
            return Err("NyxID 账号已变化，请重新开始。".into());
        }
        Ok(NyxIdVoiceOptions {
            conversation_id,
            options: result.options,
        })
    }
    pub async fn start(
        &self,
        nyxid: &NyxIdState,
        app: AppHandle,
        request: NyxIdVoiceStart,
    ) -> Result<NyxIdVoiceStarted, String> {
        let _guard = self.admission.lock().await;
        if self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
        {
            return Err("请先结束当前语音通话。".into());
        }
        validate_start(&request)?;
        let owner = nyxid.connected_owner_id()?;
        let (token, _) = nyxid.chat_credential(&app).await?;
        let base = path(&request.conversation_id);
        let result:NyxIdVoiceStarted=body(http()?.post(format!("{API_ORIGIN}/api/v1{base}")).header("Origin",ORIGIN).bearer_auth(token.as_str()).json(&json!({"client_request_id":request.client_request_id,"preferences":request.preferences,"sdp_offer":request.sdp_offer})).send().await.map_err(|_|"语音连接未确认，请稍后在 NyxID 检查通话状态。".to_owned())?).await?;
        if !valid_id(&result.session.id) {
            return Err("NyxID 语音会话标识无效。".into());
        }
        let url = format!(
            "{}/api/v1{base}/{}/stream",
            API_ORIGIN.replacen("https://", "wss://", 1),
            result.session.id
        );
        let mut ws_request = url
            .into_client_request()
            .map_err(|_| "无法建立语音控制连接。".to_owned())?;
        let mut auth = tokio_tungstenite::tungstenite::http::HeaderValue::from_str(&format!(
            "Bearer {}",
            token.as_str()
        ))
        .map_err(|_| "NyxID 登录状态无效。".to_owned())?;
        auth.set_sensitive(true);
        ws_request.headers_mut().insert("Authorization", auth);
        ws_request
            .headers_mut()
            .insert("Origin", ORIGIN.parse().expect("static origin"));
        let socket = match tokio::time::timeout(
            Duration::from_secs(15),
            connect_async_with_config(
                ws_request,
                Some(
                    WebSocketConfig::default()
                        .max_message_size(Some(BODY_LIMIT))
                        .max_frame_size(Some(BODY_LIMIT)),
                ),
                false,
            ),
        )
        .await
        {
            Ok(Ok((socket, _))) => socket,
            _ => {
                let _ = end_remote(token.as_str(), &request.conversation_id, &result.session).await;
                return Err("语音控制连接失败，通话已请求结束。".into());
            }
        };
        if nyxid.connected_owner_id().as_deref() != Ok(owner.as_str()) {
            let _ = end_remote(token.as_str(), &request.conversation_id, &result.session).await;
            return Err("NyxID 账号已变化，通话已请求结束。".into());
        }
        let (tx, mut rx) = mpsc::channel::<Message>(64);
        *self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(ActiveCall {
            owner: owner.clone(),
            conversation_id: request.conversation_id,
            session: result.session.clone(),
            sender: tx,
        });
        let bridge = self.clone();
        let nyxid = nyxid.clone();
        let sid = result.session.id.clone();
        let generation = result.session.generation;
        tauri::async_runtime::spawn(async move {
            let (mut write, mut read) = socket.split();
            let mut owner_tick = tokio::time::interval(Duration::from_secs(1));
            let mut audio_end = None;
            loop {
                let failed = tokio::select! {
                    frame=rx.recv()=>match frame {
                        Some(frame)=>tokio::time::timeout(Duration::from_secs(3),write.send(frame)).await.map_or(true, |r|r.is_err()),
                        None=>true,
                    },
                    incoming=read.next()=>match incoming {
                        Some(Ok(Message::Text(text))) if text.len()<=BODY_LIMIT=>{
                            match parse_server_text(text.as_str(),&sid,generation) {
                                Ok(ServerEvent::Snapshot(snapshot))=>{
                                    let terminal=matches!(snapshot.session.state.as_str(),"closed"|"failed");
                                    if let Some(active)=bridge.active.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut().filter(|a|a.session.id==sid) {active.session=snapshot.session.clone();}
                                    let _=app.emit(EVENT,VoiceEvent::Snapshot{session_id:sid.clone(),snapshot});
                                    terminal
                                },
                                Ok(ServerEvent::Audio(end)) if audio_end.is_none()=>{audio_end=Some(end);false},
                                Ok(ServerEvent::Flush)=>{audio_end=None;let _=app.emit(EVENT,VoiceEvent::AudioFlush{session_id:sid.clone()});false},
                                Ok(ServerEvent::StartFailed(message))=>{let _=app.emit(EVENT,VoiceEvent::Error{session_id:sid.clone(),message});true},
                                _=>true,
                            }
                        },
                        Some(Ok(Message::Binary(bytes))) if !bytes.is_empty() && bytes.len()<=1920 && bytes.len()%2==0=>{
                            if let Some(end_ms)=audio_end.take() {let _=app.emit(EVENT,VoiceEvent::Audio{session_id:sid.clone(),end_ms,pcm:bytes.to_vec()});false} else {true}
                        },
                        Some(Ok(Message::Ping(bytes)))=>write.send(Message::Pong(bytes)).await.is_err(),
                        Some(Ok(Message::Pong(_)))=>false,
                        _=>true,
                    },
                    _=owner_tick.tick()=>nyxid.connected_owner_id().as_deref()!=Ok(owner.as_str()),
                };
                if failed {
                    break;
                }
            }
            let call = {
                let mut active = bridge
                    .active
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if active.as_ref().is_some_and(|a| a.session.id == sid) {
                    active.take()
                } else {
                    None
                }
            };
            // Release local capture before any remote cleanup can wait on the network.
            let _ = app.emit(EVENT, VoiceEvent::Closed { session_id: sid });
            let _ = tokio::time::timeout(Duration::from_secs(3), write.close()).await;
            // Closing a stream also requests end; accepted work remains in the conversation.
            if let Some(call) = call {
                let _ = end_remote(token.as_str(), &call.conversation_id, &call.session).await;
            }
        });
        Ok(result)
    }
    pub async fn control(
        &self,
        nyxid: &NyxIdState,
        app: AppHandle,
        session_id: String,
        action: String,
    ) -> Result<NyxIdVoiceSession, String> {
        if !matches!(action.as_str(), "mute" | "unmute" | "end") {
            return Err("无效的语音控制。".into());
        }
        let owner = nyxid.connected_owner_id()?;
        let (conversation, session) = {
            let active = self
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let active = active
                .as_ref()
                .filter(|a| a.session.id == session_id && a.owner == owner)
                .ok_or("语音通话已结束。")?;
            (active.conversation_id.clone(), active.session.clone())
        };
        let (token, _) = nyxid.chat_credential(&app).await?;
        let updated = control_remote(token.as_str(), &conversation, &session, &action).await;
        if action == "end" {
            if let Some(call) = self
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
                .filter(|a| a.session.id == session_id)
            {
                let _ = call.sender.try_send(Message::Close(None));
            }
        } else if let Ok(session) = &updated {
            if let Some(active) = self
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_mut()
                .filter(|a| a.session.id == session_id)
            {
                active.session = session.clone();
            }
        }
        updated
    }
    pub async fn send(&self, frame: NyxIdVoiceFrame) -> Result<(), String> {
        let active = self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let active = active.as_ref().ok_or("语音通话已结束。")?;
        let (id, message) = match frame {
            NyxIdVoiceFrame::PttBegin { session_id } => (
                session_id,
                Message::Text(json!({"type":"ptt_begin"}).to_string().into()),
            ),
            NyxIdVoiceFrame::PttCommit { session_id } => (
                session_id,
                Message::Text(json!({"type":"ptt_commit"}).to_string().into()),
            ),
            NyxIdVoiceFrame::Pcm { session_id, pcm } => {
                if pcm.is_empty() || pcm.len() > 1920 || pcm.len() % 2 != 0 {
                    return Err("无效的语音音频帧。".into());
                }
                (session_id, Message::Binary(pcm.into()))
            }
            NyxIdVoiceFrame::Heartbeat {
                session_id,
                playback_ms,
                playback_audible,
            } => {
                if !(0..=1830000).contains(&playback_ms) {
                    return Err("无效的语音播放状态。".into());
                }
                (session_id,Message::Text(json!({"type":"heartbeat","generation":active.session.generation,"revision":chrono::Utc::now().timestamp_millis(),"playback_ms":playback_ms,"playback_audible":playback_audible}).to_string().into()))
            }
        };
        if id != active.session.id {
            return Err("语音通话已变化。".into());
        }
        active
            .sender
            .try_send(message)
            .map_err(|_| "语音连接过慢，请结束后重试。".into())
    }
}
async fn end_remote(
    token: &str,
    conversation: &str,
    session: &NyxIdVoiceSession,
) -> Result<NyxIdVoiceSession, String> {
    control_remote(token, conversation, session, "end").await
}
async fn control_remote(
    token: &str,
    conversation: &str,
    session: &NyxIdVoiceSession,
    action: &str,
) -> Result<NyxIdVoiceSession, String> {
    body(http()?.post(format!("{API_ORIGIN}/api/v1{}/{}/control",path(conversation),session.id)).bearer_auth(token).header("Origin",ORIGIN).json(&json!({"command_id":uuid::Uuid::new_v4().to_string(),"expected_revision":session.control_revision,"action":action})).send().await.map_err(|_|"语音控制暂时无法同步。".to_owned())?).await
}
fn validate_start(request: &NyxIdVoiceStart) -> Result<(), String> {
    let p = &request.preferences;
    if !valid_conversation_id(&request.conversation_id)
        || !valid_id(&request.client_request_id)
        || !valid_id(&p.service_id)
        || p.connection_id.as_ref().is_some_and(|id| !valid_id(id))
        || !matches!(p.key_source.as_str(), "platform" | "own")
        || p.model.is_empty()
        || p.model.len() > 128
        || !p
            .model
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        || p.voice.as_ref().is_some_and(|v| v.len() > 128)
        || p.language.as_ref().is_some_and(|v| v.len() > 35)
        || p.input_mode != "push_to_talk"
        || request.sdp_offer.len() > 65536
    {
        return Err("无效的 NyxID 语音设置。".into());
    }
    Ok(())
}
enum ServerEvent {
    Snapshot(Snapshot),
    Audio(i64),
    Flush,
    StartFailed(String),
}
fn parse_server_text(text: &str, sid: &str, generation: i64) -> Result<ServerEvent, ()> {
    let value: Value = serde_json::from_str(text).map_err(|_| ())?;
    match value.get("type").and_then(Value::as_str) {
        Some("snapshot") => {
            let snapshot: Snapshot = serde_json::from_value(value).map_err(|_| ())?;
            if snapshot.session.id != sid
                || snapshot.session.generation != generation
                || snapshot.captions.len() > 16
                || snapshot.tasks.len() > 64
                || snapshot
                    .captions
                    .iter()
                    .any(|c| !matches!(c.speaker.as_str(), "user" | "assistant"))
            {
                return Err(());
            }
            Ok(ServerEvent::Snapshot(snapshot))
        }
        Some("audio") if value.get("generation").and_then(Value::as_i64) == Some(generation) => {
            value
                .get("end_ms")
                .and_then(Value::as_i64)
                .filter(|v| (0..=1830000).contains(v))
                .map(ServerEvent::Audio)
                .ok_or(())
        }
        Some("audio_flush")
            if value.get("generation").and_then(Value::as_i64) == Some(generation) =>
        {
            Ok(ServerEvent::Flush)
        }
        Some("start_failed") => {
            let error = value.get("error").ok_or(())?;
            Ok(ServerEvent::StartFailed(error_message(
                503,
                &serde_json::to_vec(error).map_err(|_| ())?,
            )))
        }
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_commands_and_stale_audio() {
        assert!(
            serde_json::from_value::<NyxIdVoiceFrame>(
                json!({"type":"tool_call","sessionId":"x","tool":"exec"})
            )
            .is_err()
        );
        assert!(
            parse_server_text(r#"{"type":"audio","generation":2,"end_ms":40}"#, "call", 1).is_err()
        );
        assert!(
            parse_server_text(
                r#"{"type":"audio","generation":1,"end_ms":1830001}"#,
                "call",
                1
            )
            .is_err()
        );
        assert!(matches!(
            parse_server_text(r#"{"type":"audio","generation":1,"end_ms":40}"#, "call", 1),
            Ok(ServerEvent::Audio(40))
        ));
    }
    #[test]
    fn projects_only_permitted_snapshot_fields() {
        let sid = uuid::Uuid::new_v4().to_string();
        let value = json!({"type":"snapshot","session":{"id":sid,"generation":1,"state":"active","muted":false,"input_muted":false,"control_revision":0,"observed_seconds":1,"end_reason":null,"idle_warning":false,"provider_credential":"must-not-leak"},"captions":[],"tasks":[],"unexpected_secret":"must-not-leak"});
        let ServerEvent::Snapshot(snapshot) =
            parse_server_text(&value.to_string(), &sid, 1).unwrap_or_else(|_| panic!("fixture"))
        else {
            panic!("snapshot")
        };
        assert!(
            !serde_json::to_string(&snapshot)
                .unwrap()
                .contains("must-not-leak")
        );
    }
    #[test]
    fn provider_error_bodies_never_reach_webview() {
        let message = error_message(503, br#"{"message":"secret token","error_code":12501}"#);
        assert!(!message.contains("secret"));
    }
}
