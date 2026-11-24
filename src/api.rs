use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::{any, delete, get, patch, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tower_http::trace::TraceLayer;

use crate::{
    cable::{self, CableEvents},
    config::Config,
    events::{EventBus, RoomEvent},
    log::{ClientLogBatch, ClientLogFilter, ClientLogStore},
    model::{Participant, Presence, Record, Room},
    proxy, recorder, spa,
    store::{
        Command, JoinResult, RoomPatch, RoomState, Store, StoreError, PARTICIPANT_TTL_SECS,
        PRESENCE_TTL_SECS,
    },
};

const TICKET_TTL_SECS: i64 = 60;
const MAX_CLIENT_LOG_BODY: usize = 64 * 1024;

#[derive(Clone)]
struct EventTicket {
    room_id: String,
    user_id: String,
    expires_at: i64,
}

/// Playback tickets authorize media GETs (DASH manifest/segments) that cannot
/// carry an Authorization header; they bind to one archived meeting.
#[derive(Clone)]
struct PlaybackTicket {
    meeting_no: String,
    expires_at: i64,
}

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub bus: EventBus,
    pub cfg: Config,
    pub http: reqwest::Client,
    pub(crate) cable: Option<CableEvents>,
    pub(crate) logs: ClientLogStore,
    pub(crate) media_sessions: Arc<Mutex<HashMap<String, proxy::MediaSession>>>,
    pub(crate) write_gate: Arc<Mutex<()>>,
    tickets: Arc<Mutex<HashMap<String, EventTicket>>>,
    playback_tickets: Arc<Mutex<HashMap<String, PlaybackTicket>>>,
}

impl AppState {
    pub fn new(store: Arc<Store>, bus: EventBus, cfg: Config) -> Self {
        let http = reqwest::Client::new();
        let cable = cfg
            .events_cable
            .then(|| CableEvents::spawn(http.clone(), &cfg.live777_url, &cfg.live777_token));
        Self {
            store,
            bus,
            cfg,
            http,
            cable,
            logs: ClientLogStore::new(),
            media_sessions: Arc::new(Mutex::new(HashMap::new())),
            write_gate: Arc::new(Mutex::new(())),
            tickets: Arc::new(Mutex::new(HashMap::new())),
            playback_tickets: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/room/", post(create_room))
        .route("/room/{roomId}", get(show_room).patch(update_room))
        .route("/room/{roomId}/join", post(join_meeting))
        .route("/room/{roomId}/leave", post(leave_meeting))
        .route("/room/{roomId}/end", post(end_meeting))
        .route("/room/{roomId}/mute", post(mute_all))
        .route(
            "/room/{roomId}/participant/{userId}",
            delete(remove_participant),
        )
        .route("/room/{roomId}/presence", patch(set_presence))
        .route("/room/{roomId}/message", post(create_message))
        .route(
            "/room/{roomId}/recording",
            post(start_recording).delete(stop_recording),
        )
        .route("/room/{roomId}/records", get(room_records))
        .route(
            "/room/{roomId}/records/{meetingNo}/playback/ticket",
            post(create_playback_ticket),
        )
        .route(
            "/room/{roomId}/records/{meetingNo}/minutes",
            post(meeting_minutes),
        )
        .route(
            "/room/{roomId}/records/{meetingNo}/cleanup",
            post(cleanup_transcript),
        )
        .route("/room/{roomId}/events/ticket", post(create_event_ticket))
        .route("/user/records", get(user_records))
        .merge(media_routes())
        .route_layer(middleware::from_fn_with_state(state.clone(), jwt_auth));

    Router::new()
        .merge(protected)
        .merge(admin_routes(&state))
        .route("/user/", post(create_user))
        .route(
            "/log",
            post(client_log)
                .get(read_client_logs)
                .layer(DefaultBodyLimit::max(MAX_CLIENT_LOG_BODY)),
        )
        .route("/room/{roomId}/caption", post(create_caption))
        .route("/caption/streams", get(caption_streams))
        .route("/room/{roomId}/events", get(room_events))
        .route(
            "/room/{roomId}/records/{meetingNo}/playback/{*path}",
            get(record_playback),
        )
        .fallback(spa::handler)
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &axum::http::Request<Body>| {
                tracing::info_span!(
                    "http.request",
                    method = %request.method(),
                    path = %request.uri().path()
                )
            }),
        )
        .with_state(state)
}

fn media_routes() -> Router<AppState> {
    Router::new()
        .route("/whip/{uuid}", any(proxy::forward))
        .route("/whip/{uuid}/{*rest}", any(proxy::forward))
        .route("/whep/{uuid}", any(proxy::forward))
        .route("/whep/{uuid}/{*rest}", any(proxy::forward))
        .route("/session/{*rest}", any(proxy::forward))
}

/// Admin console API. The whole surface only exists when ADMIN_USER and
/// ADMIN_PASSWORD are configured; otherwise these paths fall through to the
/// SPA handler, which answers 404 for the `api` prefix. `/api/admin/login`
/// stays public; everything else requires an admin token.
fn admin_routes(state: &AppState) -> Router<AppState> {
    if state.cfg.admin_user.is_none() {
        return Router::new();
    }
    let records = Router::new()
        .route("/api/admin/records", get(admin_records))
        .route(
            "/api/admin/records/{meetingNo}",
            get(admin_record_detail).delete(admin_delete_record),
        )
        .route(
            "/api/admin/records/{meetingNo}/minutes",
            post(admin_meeting_minutes),
        )
        .route(
            "/api/admin/records/{meetingNo}/cleanup",
            post(admin_cleanup_transcript),
        )
        .route(
            "/api/admin/records/{meetingNo}/playback/ticket",
            post(create_admin_playback_ticket),
        )
        .route(
            "/api/admin/records/{meetingNo}/recordings/{*recordDir}",
            delete(admin_delete_recording),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), admin_auth));
    // Media GETs authenticate by ticket query parameter because DASH players
    // cannot set Authorization headers.
    Router::new()
        .route("/api/admin/login", post(admin_login))
        .route(
            "/api/admin/records/{meetingNo}/playback/{*path}",
            get(admin_record_playback),
        )
        .merge(records)
}

pub async fn sweep(state: &AppState) {
    sweep_at(
        state,
        crate::store::now_secs(),
        PRESENCE_TTL_SECS,
        PARTICIPANT_TTL_SECS,
    )
    .await;
}

async fn sweep_at(state: &AppState, now: i64, presence_ttl: u64, participant_ttl: u64) {
    {
        let _guard = state.write_gate.lock().await;
        match state.store.sweep(now, presence_ttl, participant_ttl).await {
            Ok(events) => {
                for event in events {
                    publish_event(state, event);
                }
            }
            Err(error) => tracing::error!("participant/presence sweep failed: {error}"),
        }
    }
    let invalid = proxy::take_invalid_media_sessions(state).await;
    recorder::stop_for_sessions(state, &invalid).await;
    proxy::revoke_media_sessions(state, invalid).await;
    recorder::reconcile(state).await;
}

#[derive(Clone)]
pub(crate) struct UserId(pub String);

#[derive(Serialize, Deserialize)]
struct Claims {
    id: String,
    exp: usize,
    iat: usize,
    nbf: usize,
}

fn token_from_header(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

fn decode_token(secret: &str, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let key = DecodingKey::from_secret(secret.as_bytes())?;
    Ok(decode::<Claims>(token, &key, &Validation::new(Algorithm::HS512))?.claims)
}

async fn jwt_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let Some(token) = token_from_header(req.headers()) else {
        return error(StatusCode::UNAUTHORIZED, "invalid token");
    };
    match decode_token(&state.cfg.secret, token) {
        Ok(claims) if !claims.id.is_empty() => {
            req.extensions_mut().insert(UserId(claims.id));
            next.run(req).await
        }
        _ => error(StatusCode::UNAUTHORIZED, "invalid token"),
    }
}

/// Admin tokens are a separate claims shape from user tokens: a user JWT has
/// no `sub`/`adm` fields and an admin JWT has no `id`, so neither can pass
/// the other's middleware.
#[derive(Serialize, Deserialize)]
struct AdminClaims {
    sub: String,
    adm: bool,
    exp: usize,
    iat: usize,
    nbf: usize,
}

fn decode_admin_token(
    secret: &str,
    token: &str,
) -> Result<AdminClaims, jsonwebtoken::errors::Error> {
    let key = DecodingKey::from_secret(secret.as_bytes())?;
    Ok(decode::<AdminClaims>(token, &key, &Validation::new(Algorithm::HS512))?.claims)
}

async fn admin_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let Some(token) = token_from_header(req.headers()) else {
        return error(StatusCode::UNAUTHORIZED, "invalid admin token");
    };
    match decode_admin_token(&state.cfg.secret, token) {
        Ok(claims) if claims.adm => next.run(req).await,
        _ => error(StatusCode::UNAUTHORIZED, "invalid admin token"),
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, message.to_string()).into_response()
}

fn store_error(error: StoreError) -> Response {
    let status = match error {
        StoreError::NotFound | StoreError::NoMeeting => StatusCode::NOT_FOUND,
        StoreError::NotParticipant | StoreError::Forbidden => StatusCode::FORBIDDEN,
        StoreError::Invalid(_) => StatusCode::BAD_REQUEST,
        StoreError::RoomIdExhausted => StatusCode::SERVICE_UNAVAILABLE,
        StoreError::InvalidData(_)
        | StoreError::Io(_)
        | StoreError::Json(_)
        | StoreError::Task(_) => {
            tracing::error!("store command failed: {error}");
            return self::error(StatusCode::INTERNAL_SERVER_ERROR, "storage error");
        }
    };
    self::error(status, &error.to_string())
}

/// Fan out a committed room event: SSE subscribers via the in-process bus
/// and, when `EVENTS_CABLE` is enabled, the room's Live777 events stream.
/// Both sites run under the write gate, so cable injection order matches
/// commit order.
fn publish_event(state: &AppState, event: RoomEvent) {
    if let Some(cable) = &state.cable {
        cable.enqueue(&event);
    }
    state.bus.publish(event);
}

async fn publish<T>(state: &AppState, command: &Command<T>) {
    if let Some(event) = command.event.clone() {
        publish_event(state, event);
    }
}

// ---------- user ----------

async fn create_user(State(state): State<AppState>) -> Response {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let now = jsonwebtoken::get_current_timestamp();
    let claims = Claims {
        id: stream_id.clone(),
        exp: (now + 10 * 365 * 24 * 3600) as usize,
        iat: now as usize,
        nbf: now as usize,
    };
    let result = EncodingKey::from_secret(state.cfg.secret.as_bytes())
        .and_then(|key| encode(&Header::new(Algorithm::HS512), &claims, &key));
    match result {
        Ok(token) => Json(json!({ "streamId": stream_id, "token": token })).into_response(),
        Err(error) => {
            tracing::error!("JWT encoding failed: {error}");
            self::error(StatusCode::INTERNAL_SERVER_ERROR, "token error")
        }
    }
}

async fn user_records(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Json<Vec<Record>> {
    Json(state.store.records_for_user(&user.0).await)
}

// ---------- room output ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomView {
    room_id: String,
    owner: String,
    topic: String,
    locked: bool,
    presenter: String,
    mute_all_at: i64,
    created_at: i64,
}

impl From<Room> for RoomView {
    fn from(room: Room) -> Self {
        Self {
            room_id: room.room_id,
            owner: room.owner,
            topic: room.topic,
            locked: room.locked,
            presenter: room.presenter,
            mute_all_at: room.mute_all_at,
            created_at: room.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomDetail {
    #[serde(flatten)]
    room: RoomView,
    meeting: Option<crate::model::Meeting>,
    participants: Vec<Participant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    events_stream: Option<String>,
}

impl RoomDetail {
    fn new(state: RoomState, events_stream: Option<String>) -> Self {
        Self {
            room: state.room.into(),
            meeting: state.meeting,
            participants: state.participants,
            events_stream,
        }
    }
}

async fn room_detail(
    state: &AppState,
    room_id: &str,
    user_id: String,
) -> Result<RoomDetail, Box<Response>> {
    let mut room = state
        .store
        .room_state(room_id)
        .await
        .ok_or_else(|| Box::new(error(StatusCode::NOT_FOUND, "room not found")))?;
    let active = state.store.is_active(room_id, &user_id).await;
    if !active {
        room.meeting = None;
        room.participants.clear();
    }
    // The cable events stream is advertised only to active participants;
    // lobby viewers get the redacted view without it.
    let events_stream =
        (active && state.cfg.events_cable).then(|| cable::events_stream_id(room_id));
    Ok(RoomDetail::new(room, events_stream))
}

// ---------- room ----------

async fn create_room(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    match state.store.create_room(&user.0).await {
        Ok(room) => Json(RoomDetail::new(
            RoomState {
                room,
                meeting: None,
                participants: Vec::new(),
                streams: HashMap::new(),
            },
            None,
        ))
        .into_response(),
        Err(error) => store_error(error),
    }
}

async fn show_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    match room_detail(&state, &room_id, user.0).await {
        Ok(room) => Json(room).into_response(),
        Err(response) => *response,
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateRoom {
    topic: Option<String>,
    password: Option<String>,
    locked: Option<bool>,
    presenter: Option<String>,
}

async fn update_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(body): Json<UpdateRoom>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    let command = state
        .store
        .update_room(
            &room_id,
            &user.0,
            RoomPatch {
                topic: body.topic,
                password: body.password,
                locked: body.locked,
                presenter: body.presenter,
            },
        )
        .await;
    match command {
        Ok(command) => {
            publish(&state, &command).await;
            match room_detail(&state, &room_id, user.0).await {
                Ok(room) => Json(room).into_response(),
                Err(response) => *response,
            }
        }
        Err(error) => store_error(error),
    }
}

// ---------- meeting ----------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct JoinRequest {
    name: Option<String>,
    password: Option<String>,
}

fn join_response(result: JoinResult) -> Response {
    Json(json!({
        "meetingNo": result.meeting_no,
        "userId": result.user_id,
        "role": result.role,
        "name": result.name,
    }))
    .into_response()
}

async fn join_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(body): Json<JoinRequest>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    match state
        .store
        .join(&room_id, &user.0, body.name, body.password.as_deref())
        .await
    {
        Ok(command) => {
            publish(&state, &command).await;
            join_response(command.value)
        }
        Err(error) => store_error(error),
    }
}

async fn leave_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let guard = state.write_gate.lock().await;
    match state.store.leave(&room_id, &user.0).await {
        Ok(command) => {
            let sessions = proxy::take_media_sessions(&state, &room_id, Some(&user.0)).await;
            publish(&state, &command).await;
            drop(guard);
            recorder::stop_for_sessions(&state, &sessions).await;
            proxy::revoke_media_sessions(&state, sessions).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => store_error(error),
    }
}

async fn end_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let guard = state.write_gate.lock().await;
    match state.store.end(&room_id, &user.0).await {
        Ok(command) => {
            let sessions = proxy::take_media_sessions(&state, &room_id, None).await;
            publish(&state, &command).await;
            drop(guard);
            recorder::stop_for_sessions(&state, &sessions).await;
            proxy::revoke_media_sessions(&state, sessions).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => store_error(error),
    }
}

async fn mute_all(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    match state.store.mute(&room_id, &user.0).await {
        Ok(command) => {
            publish(&state, &command).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => store_error(error),
    }
}

async fn remove_participant(
    State(state): State<AppState>,
    Path((room_id, target)): Path<(String, String)>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let guard = state.write_gate.lock().await;
    match state.store.kick(&room_id, &user.0, &target).await {
        Ok(command) => {
            let sessions = proxy::take_media_sessions(&state, &room_id, Some(&target)).await;
            publish(&state, &command).await;
            drop(guard);
            recorder::stop_for_sessions(&state, &sessions).await;
            proxy::revoke_media_sessions(&state, sessions).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => store_error(error),
    }
}

async fn room_records(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    match state.store.records_for_room(&room_id, &user.0).await {
        Ok(records) => Json(records).into_response(),
        Err(error) => store_error(error),
    }
}

// ---------- minutes & transcript cleanup ----------

const MINUTES_TIMEOUT: Duration = Duration::from_secs(60);
const MINUTES_TRANSCRIPT_LIMIT: usize = 100_000;
const CLEANUP_CHUNK_LIMIT: usize = 100_000;
const MINUTES_SYSTEM_PROMPT: &str = "You are a concise meeting assistant. Turn the meeting \
     transcript into structured meeting minutes in Markdown: a short summary, key discussion \
     points, and action items. Answer in the dominant language of the transcript.";
const CLEANUP_SYSTEM_PROMPT: &str = "You are cleaning up an automatically transcribed \
     meeting (ASR). Fix recognition errors, restore punctuation, keep every utterance's \
     content and the `name: text` speaker labels, segment by topic with `###` headings, do \
     not summarize or omit content, and respond in the language(s) of the transcript.";

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArtifactKind {
    Minutes,
    Cleanup,
}

impl ArtifactKind {
    fn system_prompt(self) -> &'static str {
        match self {
            Self::Minutes => MINUTES_SYSTEM_PROMPT,
            Self::Cleanup => CLEANUP_SYSTEM_PROMPT,
        }
    }

    fn response_key(self) -> &'static str {
        match self {
            Self::Minutes => "minutes",
            Self::Cleanup => "polishedTranscript",
        }
    }

    fn cached_of(self, record: &Record) -> &str {
        match self {
            Self::Minutes => &record.minutes,
            Self::Cleanup => &record.polished_transcript,
        }
    }

    fn store_artifact(self) -> crate::store::RecordArtifact {
        match self {
            Self::Minutes => crate::store::RecordArtifact::Minutes,
            Self::Cleanup => crate::store::RecordArtifact::PolishedTranscript,
        }
    }
}

fn transcript_of(captions: &[crate::model::Caption]) -> String {
    let mut transcript = String::new();
    for (index, caption) in captions.iter().enumerate() {
        if index > 0 {
            transcript.push('\n');
        }
        transcript.push_str(&caption.name);
        transcript.push_str(": ");
        transcript.push_str(&caption.text);
    }
    transcript
}

fn cap_transcript(mut transcript: String, limit: usize) -> String {
    if transcript.len() > limit {
        let mut start = transcript.len() - limit;
        while !transcript.is_char_boundary(start) {
            start += 1;
        }
        transcript.drain(..start);
    }
    transcript
}

/// Split a transcript into chunks of at most `limit` bytes, cutting only on
/// line boundaries so no line is ever split. A single line longer than
/// `limit` forms its own oversized chunk. `chunks.join("\n") == transcript`.
fn transcript_chunks(transcript: &str, limit: usize) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut chunk_start = 0;
    let mut len = 0;
    let mut offset = 0;
    for line in transcript.split('\n') {
        let added = if len == 0 {
            line.len()
        } else {
            len + 1 + line.len()
        };
        if len > 0 && added > limit {
            chunks.push(&transcript[chunk_start..offset - 1]);
            chunk_start = offset;
            len = line.len();
        } else {
            len = added;
        }
        offset += line.len() + 1;
    }
    let tail = &transcript[chunk_start..];
    if !tail.is_empty() || chunks.is_empty() {
        chunks.push(tail);
    }
    chunks
}

async fn call_minutes_upstream(
    state: &AppState,
    base_url: &str,
    model: &str,
    system: &str,
    user: &str,
) -> Result<String, Box<Response>> {
    let request = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "stream": false,
    });
    let mut upstream = state
        .http
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .timeout(MINUTES_TIMEOUT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(request.to_string());
    if let Some(api_key) = state.cfg.minutes_api_key.as_deref() {
        upstream = upstream.bearer_auth(api_key);
    }
    let response = upstream.send().await.map_err(|error| {
        tracing::error!("minutes upstream request failed: {error}");
        Box::new(self::error(
            StatusCode::BAD_GATEWAY,
            "minutes upstream error",
        ))
    })?;
    let status = response.status();
    let body = response.bytes().await.map_err(|error| {
        tracing::error!("minutes upstream body read failed: {error}");
        Box::new(self::error(
            StatusCode::BAD_GATEWAY,
            "minutes upstream error",
        ))
    })?;
    if !status.is_success() {
        tracing::error!("minutes upstream returned {status}");
        return Err(Box::new(self::error(
            StatusCode::BAD_GATEWAY,
            "minutes upstream error",
        )));
    }
    serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|body| {
            body["choices"].as_array()?.first()?["message"]["content"]
                .as_str()
                .map(str::to_string)
        })
        .ok_or_else(|| {
            tracing::error!("minutes upstream returned a malformed response");
            Box::new(self::error(
                StatusCode::BAD_GATEWAY,
                "minutes upstream error",
            ))
        })
}

fn minutes_config(state: &AppState) -> Option<(&str, &str)> {
    match (
        state.cfg.minutes_url.as_deref(),
        state.cfg.minutes_model.as_deref(),
    ) {
        (Some(base_url), Some(model)) => Some((base_url, model)),
        _ => None,
    }
}

/// Shared minutes/cleanup pipeline for both the user-facing and the admin
/// endpoints. The caller resolves and authorizes the record; this only runs
/// the LLM generation and caches the result on the record.
async fn generate_artifact(
    state: &AppState,
    record: &Record,
    force: bool,
    kind: ArtifactKind,
    size: usize,
) -> Response {
    let Some((base_url, model)) = minutes_config(state) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if record.captions.is_empty() {
        return error(StatusCode::BAD_REQUEST, "no transcript");
    }
    let cached = kind.cached_of(record);
    if !force && !cached.is_empty() {
        return Json(json!({ kind.response_key(): cached, "cached": true })).into_response();
    }
    let transcript = transcript_of(&record.captions);
    let generated = match kind {
        ArtifactKind::Minutes => {
            call_minutes_upstream(
                state,
                base_url,
                model,
                kind.system_prompt(),
                &cap_transcript(transcript, size),
            )
            .await
        }
        ArtifactKind::Cleanup => {
            let mut parts = Vec::new();
            for chunk in transcript_chunks(&transcript, size) {
                match call_minutes_upstream(state, base_url, model, kind.system_prompt(), chunk)
                    .await
                {
                    Ok(part) => parts.push(part),
                    Err(response) => return *response,
                }
            }
            Ok(parts.join("\n\n"))
        }
    };
    let content = match generated {
        Ok(content) => content,
        Err(response) => return *response,
    };
    if let Err(error) = state
        .store
        .save_record_artifact(
            &record.room_id,
            &record.meeting_no,
            kind.store_artifact(),
            content.clone(),
        )
        .await
    {
        return store_error(error);
    }
    Json(json!({ kind.response_key(): content, "cached": false })).into_response()
}

#[derive(Deserialize)]
struct ArtifactQuery {
    force: Option<bool>,
}

async fn meeting_minutes(
    State(state): State<AppState>,
    Path((room_id, meeting_no)): Path<(String, String)>,
    Query(query): Query<ArtifactQuery>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    if minutes_config(&state).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let record = match state
        .store
        .record_for_minutes(&room_id, &meeting_no, &user.0)
        .await
    {
        Ok(record) => record,
        Err(error) => return store_error(error),
    };
    generate_artifact(
        &state,
        &record,
        query.force.unwrap_or(false),
        ArtifactKind::Minutes,
        MINUTES_TRANSCRIPT_LIMIT,
    )
    .await
}

async fn cleanup_transcript(
    State(state): State<AppState>,
    Path((room_id, meeting_no)): Path<(String, String)>,
    Query(query): Query<ArtifactQuery>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    if minutes_config(&state).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let record = match state
        .store
        .record_for_minutes(&room_id, &meeting_no, &user.0)
        .await
    {
        Ok(record) => record,
        Err(error) => return store_error(error),
    };
    generate_artifact(
        &state,
        &record,
        query.force.unwrap_or(false),
        ArtifactKind::Cleanup,
        CLEANUP_CHUNK_LIMIT,
    )
    .await
}

// ---------- presence ----------

async fn set_presence(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(presence): Json<Presence>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    match state.store.set_presence(&room_id, &user.0, presence).await {
        Ok(command) => {
            publish(&state, &command).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => store_error(error),
    }
}

// ---------- chat ----------

const MAX_MESSAGE_LEN: usize = 500;

#[derive(Deserialize)]
struct MessageRequest {
    content: Option<String>,
}

async fn create_message(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(body): Json<MessageRequest>,
) -> Response {
    let content = body
        .content
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_MESSAGE_LEN)
        .collect::<String>();
    if content.is_empty() {
        return error(StatusCode::BAD_REQUEST, "empty message");
    }
    let _guard = state.write_gate.lock().await;
    match state.store.add_message(&room_id, &user.0, content).await {
        Ok(command) => {
            publish(&state, &command).await;
            (StatusCode::CREATED, Json(command.value)).into_response()
        }
        Err(error) => store_error(error),
    }
}

// ---------- recording & playback ----------

async fn start_recording(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let already = state
        .store
        .room_state(&room_id)
        .await
        .and_then(|room| room.meeting)
        .is_some_and(|meeting| meeting.recording_at.is_some());
    if !already && !recorder::available(&state).await {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "recording unavailable on this server",
        );
    }
    let guard = state.write_gate.lock().await;
    let command = match state.store.set_recording(&room_id, &user.0, true).await {
        Ok(command) => command,
        Err(error) => return store_error(error),
    };
    publish(&state, &command).await;
    drop(guard);
    if let Some(meeting) = state
        .store
        .room_state(&room_id)
        .await
        .and_then(|room| room.meeting)
    {
        recorder::start_meeting(&state, &room_id, &meeting.meeting_no).await;
    }
    Json(json!({ "recording": true })).into_response()
}

async fn stop_recording(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let guard = state.write_gate.lock().await;
    let command = match state.store.set_recording(&room_id, &user.0, false).await {
        Ok(command) => command,
        Err(error) => return store_error(error),
    };
    publish(&state, &command).await;
    drop(guard);
    if let Some(meeting) = state
        .store
        .room_state(&room_id)
        .await
        .and_then(|room| room.meeting)
    {
        recorder::stop_meeting(&state, &meeting.meeting_no).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

const PLAYBACK_TICKET_TTL_SECS: i64 = 3600;

async fn issue_playback_ticket(state: &AppState, meeting_no: &str) -> Response {
    let now = crate::store::now_secs();
    let expires_at = now + PLAYBACK_TICKET_TTL_SECS;
    let ticket = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let mut tickets = state.playback_tickets.lock().await;
    tickets.retain(|_, ticket| ticket.expires_at > now);
    tickets.insert(
        ticket.clone(),
        PlaybackTicket {
            meeting_no: meeting_no.to_string(),
            expires_at,
        },
    );
    Json(json!({ "ticket": ticket, "expiresAt": expires_at })).into_response()
}

/// Playback tickets follow the same visibility rule as minutes: the room
/// owner or any participant of that meeting.
async fn create_playback_ticket(
    State(state): State<AppState>,
    Path((room_id, meeting_no)): Path<(String, String)>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    match state
        .store
        .record_for_minutes(&room_id, &meeting_no, &user.0)
        .await
    {
        Ok(_) => issue_playback_ticket(&state, &meeting_no).await,
        Err(error) => store_error(error),
    }
}

async fn valid_playback_ticket(state: &AppState, meeting_no: &str, ticket: Option<&str>) -> bool {
    let Some(ticket_value) = ticket else {
        return false;
    };
    let now = crate::store::now_secs();
    let mut tickets = state.playback_tickets.lock().await;
    tickets.retain(|_, ticket| ticket.expires_at > now);
    tickets
        .get(ticket_value)
        .is_some_and(|ticket| ticket.meeting_no == meeting_no && ticket.expires_at > now)
}

/// Proxy one recording object (DASH manifest or fMP4 segment) from Live777
/// storage. The path must stay inside one of the meeting's record dirs.
async fn playback_object(
    state: &AppState,
    meeting_no: &str,
    path: &str,
    ticket: Option<&str>,
) -> Response {
    if !valid_playback_ticket(state, meeting_no, ticket).await {
        return error(StatusCode::UNAUTHORIZED, "invalid playback ticket");
    }
    if path.split('/').any(|segment| segment == "..") {
        return error(StatusCode::BAD_REQUEST, "invalid path");
    }
    let record = match state.store.record_by_meeting_no(meeting_no).await {
        Ok(record) => record,
        Err(_) => return error(StatusCode::NOT_FOUND, "record not found"),
    };
    let allowed = record
        .recordings
        .iter()
        .any(|entry| path.starts_with(&format!("{}/", entry.record_dir)));
    if !allowed {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut request = state.http.get(format!(
        "{}/api/record/object/{path}",
        state.cfg.live777_url.trim_end_matches('/')
    ));
    if !state.cfg.live777_token.is_empty() {
        request = request.bearer_auth(&state.cfg.live777_token);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("Live777 record object {path} failed: {error}");
            return self::error(StatusCode::BAD_GATEWAY, "upstream request failed");
        }
    };
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
    match response.bytes().await {
        Ok(body) => {
            let mut builder = Response::builder().status(status);
            if let Some(value) = content_type {
                builder = builder.header(header::CONTENT_TYPE, value);
            }
            builder
                .body(Body::from(body))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(error) => {
            tracing::warn!("Live777 record object {path} body failed: {error}");
            self::error(StatusCode::BAD_GATEWAY, "upstream response body failed")
        }
    }
}

async fn record_playback(
    State(state): State<AppState>,
    Path((room_id, meeting_no, path)): Path<(String, String, String)>,
    Query(query): Query<AuthQuery>,
) -> Response {
    // The room id in the path is cosmetic (the ticket binds the meeting), but
    // mismatches are rejected to keep URLs truthful.
    match state.store.record_by_meeting_no(&meeting_no).await {
        Ok(record) if record.room_id == room_id => {}
        _ => return StatusCode::NOT_FOUND.into_response(),
    }
    playback_object(&state, &meeting_no, &path, query.ticket.as_deref()).await
}

// ---------- browser log intake ----------

async fn client_log(
    State(state): State<AppState>,
    Json(batch): Json<ClientLogBatch>,
) -> StatusCode {
    for record in state.logs.append_batch(batch) {
        match serde_json::to_string(&record) {
            Ok(line) => tracing::info!(target: "client_log", "{}", line),
            Err(error) => tracing::warn!("client log JSON encoding failed: {error}"),
        }
    }
    StatusCode::NO_CONTENT
}

async fn read_client_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<ClientLogFilter>,
) -> Response {
    let Some(expected_token) = state.cfg.log_read_token.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if token_from_header(&headers) != Some(expected_token) {
        return error(StatusCode::UNAUTHORIZED, "invalid log read token");
    }

    let mut body = String::new();
    for record in state.logs.query(&filter) {
        match serde_json::to_string(&record) {
            Ok(line) => {
                body.push_str(&line);
                body.push('\n');
            }
            Err(error) => {
                tracing::warn!("client log JSON encoding failed: {error}");
                return self::error(StatusCode::INTERNAL_SERVER_ERROR, "log encoding error");
            }
        }
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"woom-client-logs.ndjson\"",
        )
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ---------- captions ----------

const MAX_CAPTION_LEN: usize = 500;
const MAX_CAPTION_ID_LEN: usize = 64;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CaptionRequest {
    id: Option<String>,
    user_id: Option<String>,
    text: Option<String>,
    is_final: bool,
}

fn caption_token_error(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    let Some(expected_token) = state.cfg.caption_token.as_deref() else {
        return Some(StatusCode::NOT_FOUND.into_response());
    };
    if token_from_header(headers) != Some(expected_token) {
        return Some(error(StatusCode::UNAUTHORIZED, "invalid caption token"));
    }
    None
}

async fn create_caption(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CaptionRequest>,
) -> Response {
    if let Some(response) = caption_token_error(&state, &headers) {
        return response;
    }
    let user_id = body.user_id.unwrap_or_default().trim().to_string();
    if user_id.is_empty() {
        return error(StatusCode::BAD_REQUEST, "missing user id");
    }
    let text = body
        .text
        .unwrap_or_default()
        .trim()
        .chars()
        .take(MAX_CAPTION_LEN)
        .collect::<String>();
    if text.is_empty() {
        return error(StatusCode::BAD_REQUEST, "empty caption");
    }
    let segment_id = body
        .id
        .map(|id| id.chars().take(MAX_CAPTION_ID_LEN).collect::<String>())
        .filter(|id| !id.is_empty());
    let _guard = state.write_gate.lock().await;
    match state
        .store
        .caption(&room_id, &user_id, segment_id, text, body.is_final)
        .await
    {
        Ok(command) => {
            publish(&state, &command).await;
            (StatusCode::CREATED, Json(command.value)).into_response()
        }
        Err(error) => store_error(error),
    }
}

async fn caption_streams(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(response) = caption_token_error(&state, &headers) {
        return response;
    }
    Json(json!({ "rooms": state.store.caption_rooms().await })).into_response()
}

// ---------- admin console ----------

const ADMIN_TOKEN_TTL_SECS: i64 = 12 * 3600;

#[derive(Deserialize)]
struct AdminLoginRequest {
    username: Option<String>,
    password: Option<String>,
}

async fn admin_login(
    State(state): State<AppState>,
    Json(body): Json<AdminLoginRequest>,
) -> Response {
    let (Some(expected_user), Some(expected_password)) = (
        state.cfg.admin_user.as_deref(),
        state.cfg.admin_password.as_deref(),
    ) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let username = body.username.unwrap_or_default();
    let password = body.password.unwrap_or_default();
    if username != expected_user || password != expected_password {
        return error(StatusCode::UNAUTHORIZED, "invalid credentials");
    }
    let now = jsonwebtoken::get_current_timestamp();
    let expires_at = now + ADMIN_TOKEN_TTL_SECS as u64;
    let claims = AdminClaims {
        sub: username,
        adm: true,
        exp: expires_at as usize,
        iat: now as usize,
        nbf: now as usize,
    };
    match EncodingKey::from_secret(state.cfg.secret.as_bytes())
        .and_then(|key| encode(&Header::new(Algorithm::HS512), &claims, &key))
    {
        Ok(token) => Json(json!({ "token": token, "expiresAt": expires_at })).into_response(),
        Err(error) => {
            tracing::error!("admin JWT encoding failed: {error}");
            self::error(StatusCode::INTERNAL_SERVER_ERROR, "token error")
        }
    }
}

/// Flat per-record listing for the admin console: no message/caption bodies,
/// just counts and artifact status. Records carry no room topic of their own,
/// so the room's current topic is joined in when the room still exists.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordSummary {
    meeting_no: String,
    room_id: String,
    room_topic: Option<String>,
    started_at: i64,
    ended_at: i64,
    max_concurrent: usize,
    participant_count: usize,
    message_count: usize,
    caption_count: usize,
    recording_count: usize,
    has_minutes: bool,
    has_polished_transcript: bool,
}

async fn admin_records(State(state): State<AppState>) -> Response {
    let mut summaries = Vec::new();
    for record in state.store.all_records().await {
        summaries.push(RecordSummary {
            meeting_no: record.meeting_no,
            room_topic: state.store.room_topic(&record.room_id).await,
            room_id: record.room_id,
            started_at: record.started_at,
            ended_at: record.ended_at,
            max_concurrent: record.max_concurrent,
            participant_count: record.participants.len(),
            message_count: record.messages.len(),
            caption_count: record.captions.len(),
            recording_count: record.recordings.len(),
            has_minutes: !record.minutes.is_empty(),
            has_polished_transcript: !record.polished_transcript.is_empty(),
        });
    }
    Json(summaries).into_response()
}

async fn admin_record_detail(
    State(state): State<AppState>,
    Path(meeting_no): Path<String>,
) -> Response {
    match state.store.record_by_meeting_no(&meeting_no).await {
        Ok(record) => Json(record).into_response(),
        Err(error) => store_error(error),
    }
}

async fn admin_delete_record(
    State(state): State<AppState>,
    Path(meeting_no): Path<String>,
) -> Response {
    match state.store.delete_record(&meeting_no).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => store_error(error),
    }
}

/// Admin artifact generation authorizes by meeting number alone: the admin
/// token replaces the owner/participant visibility check of the user routes.
async fn admin_generate_artifact(
    state: &AppState,
    meeting_no: &str,
    force: bool,
    kind: ArtifactKind,
    size: usize,
) -> Response {
    if minutes_config(state).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let record = match state.store.record_by_meeting_no(meeting_no).await {
        Ok(record) => record,
        Err(error) => return store_error(error),
    };
    generate_artifact(state, &record, force, kind, size).await
}

async fn admin_meeting_minutes(
    State(state): State<AppState>,
    Path(meeting_no): Path<String>,
    Query(query): Query<ArtifactQuery>,
) -> Response {
    admin_generate_artifact(
        &state,
        &meeting_no,
        query.force.unwrap_or(false),
        ArtifactKind::Minutes,
        MINUTES_TRANSCRIPT_LIMIT,
    )
    .await
}

async fn admin_cleanup_transcript(
    State(state): State<AppState>,
    Path(meeting_no): Path<String>,
    Query(query): Query<ArtifactQuery>,
) -> Response {
    admin_generate_artifact(
        &state,
        &meeting_no,
        query.force.unwrap_or(false),
        ArtifactKind::Cleanup,
        CLEANUP_CHUNK_LIMIT,
    )
    .await
}

async fn create_admin_playback_ticket(
    State(state): State<AppState>,
    Path(meeting_no): Path<String>,
) -> Response {
    match state.store.record_by_meeting_no(&meeting_no).await {
        Ok(_) => issue_playback_ticket(&state, &meeting_no).await,
        Err(error) => store_error(error),
    }
}

async fn admin_record_playback(
    State(state): State<AppState>,
    Path((meeting_no, path)): Path<(String, String)>,
    Query(query): Query<AuthQuery>,
) -> Response {
    playback_object(&state, &meeting_no, &path, query.ticket.as_deref()).await
}

/// Remove a recording entry from an archived record. The Live777 index row is
/// cleaned up best-effort; the media files themselves stay in storage (no
/// Live777 API deletes files) and are reclaimed by deployment-side retention.
async fn admin_delete_recording(
    State(state): State<AppState>,
    Path((meeting_no, record_dir)): Path<(String, String)>,
) -> Response {
    if record_dir.split('/').any(|segment| segment == "..") {
        return error(StatusCode::BAD_REQUEST, "invalid path");
    }
    let record = match state.store.record_by_meeting_no(&meeting_no).await {
        Ok(record) => record,
        Err(error) => return store_error(error),
    };
    let Some(entry) = record
        .recordings
        .iter()
        .find(|entry| entry.record_dir == record_dir)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let stream_id = entry.stream_id.clone();
    if let Err(error) = state
        .store
        .delete_recording_entry(&meeting_no, &record_dir)
        .await
    {
        return store_error(error);
    }
    if let Some(record_id) = record_dir.rsplit('/').next() {
        recorder::drop_index_entry(&state, &stream_id, record_id).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

// ---------- SSE ----------

async fn create_event_ticket(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    if !state.store.is_active(&room_id, &user.0).await {
        return error(StatusCode::FORBIDDEN, "not an active participant");
    }
    let now = crate::store::now_secs();
    let expires_at = now + TICKET_TTL_SECS;
    let ticket = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let mut tickets = state.tickets.lock().await;
    tickets.retain(|_, ticket| ticket.expires_at > now);
    tickets.insert(
        ticket.clone(),
        EventTicket {
            room_id,
            user_id: user.0,
            expires_at,
        },
    );
    Json(json!({ "ticket": ticket, "expiresAt": expires_at })).into_response()
}

#[derive(Deserialize)]
struct AuthQuery {
    ticket: Option<String>,
}

async fn event_user(
    state: &AppState,
    room_id: &str,
    headers: &HeaderMap,
    query: &AuthQuery,
) -> Option<UserId> {
    if let Some(token) = token_from_header(headers) {
        return decode_token(&state.cfg.secret, token)
            .ok()
            .map(|claims| UserId(claims.id));
    }
    let ticket_value = query.ticket.as_deref()?;
    let now = crate::store::now_secs();
    let mut tickets = state.tickets.lock().await;
    tickets.retain(|_, ticket| ticket.expires_at > now);
    let ticket = tickets.get(ticket_value)?;
    (ticket.room_id == room_id && ticket.expires_at > now).then(|| UserId(ticket.user_id.clone()))
}

type SnapshotFuture = Pin<Box<dyn Future<Output = Option<RoomEvent>> + Send>>;

struct RoomEventStream {
    receiver: BroadcastStream<RoomEvent>,
    state: AppState,
    room_id: String,
    user_id: String,
    initial: Option<RoomEvent>,
    last_revision: u64,
    lagged_snapshot: Option<SnapshotFuture>,
    done: bool,
}

impl Stream for RoomEventStream {
    type Item = RoomEvent;

    fn poll_next(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = &mut *self;
        if this.done {
            return Poll::Ready(None);
        }
        if let Some(initial) = this.initial.take() {
            return Poll::Ready(Some(initial));
        }

        loop {
            if let Some(future) = this.lagged_snapshot.as_mut() {
                match future.as_mut().poll(context) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(event) => {
                        this.lagged_snapshot = None;
                        let Some(event) = event else {
                            this.done = true;
                            return Poll::Ready(None);
                        };
                        this.last_revision = event.revision;
                        if event
                            .snapshot_ref()
                            .is_some_and(|snapshot| !snapshot.is_active(&this.user_id))
                        {
                            this.done = true;
                            // Synthesized per-connection end frame; never
                            // published, so it is not injected into the cable.
                            // Cable clients detect meeting end from broadcast
                            // snapshots (meetingNo mismatch / own leaveAt).
                            return Poll::Ready(Some(RoomEvent::snapshot(
                                &this.room_id,
                                crate::events::Snapshot::ended(event.revision),
                            )));
                        }
                        return Poll::Ready(Some(event));
                    }
                }
            }

            match Pin::new(&mut this.receiver).poll_next(context) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Some(Ok(event))) => {
                    if event.revision <= this.last_revision {
                        continue;
                    }
                    this.last_revision = event.revision;
                    this.done = event
                        .snapshot_ref()
                        .is_some_and(|snapshot| !snapshot.is_active(&this.user_id));
                    return Poll::Ready(Some(event));
                }
                Poll::Ready(Some(Err(_))) => {
                    let state = this.state.clone();
                    let room_id = this.room_id.clone();
                    this.lagged_snapshot = Some(Box::pin(async move {
                        let snapshot = state.store.snapshot(&room_id).await.ok()?;
                        Some(RoomEvent::snapshot(&room_id, snapshot))
                    }));
                }
                Poll::Ready(None) => {
                    this.done = true;
                    return Poll::Ready(None);
                }
            }
        }
    }
}

async fn room_events(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<AuthQuery>,
) -> Response {
    let Some(user) = event_user(&state, &room_id, &headers, &query).await else {
        return error(StatusCode::UNAUTHORIZED, "invalid ticket or token");
    };
    match state.store.require_active(&room_id, &user.0).await {
        Ok(()) => {}
        Err(StoreError::NotFound) => return error(StatusCode::NOT_FOUND, "room not found"),
        Err(StoreError::NotParticipant) => {
            return error(StatusCode::FORBIDDEN, "not an active participant")
        }
        Err(error) => return store_error(error),
    }
    let receiver = state.bus.subscribe(&room_id);
    let initial = match state.store.snapshot(&room_id).await {
        Ok(snapshot) if snapshot.is_active(&user.0) => snapshot,
        Ok(_) => return error(StatusCode::FORBIDDEN, "not an active participant"),
        Err(StoreError::NotFound) => return error(StatusCode::NOT_FOUND, "room not found"),
        Err(error) => return store_error(error),
    };
    let initial_event = RoomEvent::snapshot(&room_id, initial);
    let stream = RoomEventStream {
        receiver: BroadcastStream::new(receiver),
        state,
        room_id,
        user_id: user.0,
        last_revision: initial_event.revision,
        initial: Some(initial_event),
        lagged_snapshot: None,
        done: false,
    };
    let stream =
        stream.map(|event| Ok::<_, Infallible>(Event::default().data(event.payload_json())));
    Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

#[cfg(test)]
mod tests;
