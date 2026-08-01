use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::{delete, get, patch, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::trace::TraceLayer;

use crate::{
    config::Config,
    events::{self, EventBus},
    helper,
    model::{Meeting, Message, Participant, Presence, Record, Role, Room},
    proxy, spa,
    store::{now_millis, now_secs, Store},
};

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<dyn Store>,
    pub bus: EventBus,
    pub cfg: Config,
    pub http: reqwest::Client,
}

pub fn router(store: Arc<dyn Store>, bus: EventBus, cfg: Config) -> Router {
    let state = AppState {
        store,
        bus,
        cfg,
        http: reqwest::Client::new(),
    };

    let protected = Router::new()
        .route("/room/", post(create_room))
        .route("/room/{roomId}", get(show_room).patch(update_room))
        .route("/room/{roomId}/join", post(join_meeting))
        .route("/room/{roomId}/leave", post(leave_meeting))
        .route("/room/{roomId}/end", post(end_meeting))
        .route("/room/{roomId}/mute", post(mute_all))
        .route("/room/{roomId}/participant/{userId}", delete(remove_participant))
        .route("/room/{roomId}/presence", patch(set_presence))
        .route("/room/{roomId}/message", post(create_message))
        .route("/room/{roomId}/records", get(room_records))
        .route("/user/records", get(user_records))
        .route_layer(middleware::from_fn_with_state(state.clone(), jwt_auth));

    Router::new()
        .merge(protected)
        .route("/user/", post(create_user))
        // browser log intake. Unauthenticated on purpose: failures must be
        // reportable even before the client managed to get a token
        .route("/log", post(client_log))
        // EventSource cannot set headers: this route accepts the JWT via
        // the Authorization header or the ?token= query parameter
        .route("/room/{roomId}/events", get(room_events))
        .route("/whip/{uuid}", any(proxy::forward))
        .route("/whep/{uuid}", any(proxy::forward))
        .fallback(spa::handler)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

use axum::routing::any;

#[derive(Clone)]
struct UserId(String);

#[derive(Serialize, Deserialize)]
struct Claims {
    id: String,
    exp: usize,
    iat: usize,
    nbf: usize,
}

fn token_from_header(headers: &HeaderMap) -> &str {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if bearer.len() > 7 && bearer[..6].eq_ignore_ascii_case("bearer") {
        &bearer[7..]
    } else {
        ""
    }
}

fn decode_token(secret: &str, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    Ok(decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS512),
    )?
    .claims)
}

async fn jwt_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let token = token_from_header(req.headers()).to_string();
    match decode_token(&state.cfg.secret, &token) {
        Ok(claims) => {
            req.extensions_mut().insert(UserId(claims.id));
            next.run(req).await
        }
        Err(e) => (StatusCode::UNAUTHORIZED, e.to_string()).into_response(),
    }
}

/// JWT from header or ?token= (for EventSource)
fn auth_user(state: &AppState, headers: &HeaderMap, query: &Query<AuthQuery>) -> Option<UserId> {
    let header_token = token_from_header(headers);
    let token = if header_token.is_empty() {
        query.token.as_deref().unwrap_or("")
    } else {
        header_token
    };
    decode_token(&state.cfg.secret, token).ok().map(|c| UserId(c.id))
}

#[derive(Deserialize)]
struct AuthQuery {
    token: Option<String>,
}

fn error(status: StatusCode, msg: &str) -> Response {
    (status, msg.to_string()).into_response()
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
    match encode(
        &Header::new(Algorithm::HS512),
        &claims,
        &EncodingKey::from_secret(state.cfg.secret.as_bytes()),
    ) {
        Ok(token) => Json(json!({ "streamId": stream_id, "token": token })).into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn user_records(State(state): State<AppState>, axum::Extension(user): axum::Extension<UserId>) -> Json<Vec<Record>> {
    Json(state.store.records_for_user(&user.0).await)
}

// ---------- room ----------

async fn create_room(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let room = Room {
        room_id: helper::add_split_symbol(&helper::gen_number_secret(9)),
        owner: user.0,
        created_at: now_secs(),
        ..Default::default()
    };
    state.store.create_room(room.clone()).await;
    Json(room).into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomDetail {
    #[serde(flatten)]
    room: Room,
    meeting: Option<Meeting>,
    participants: Vec<Participant>,
}

async fn show_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    let meeting = state.store.current_meeting(&room_id).await;
    let participants = match &meeting {
        Some(m) => state.store.participants(&m.meeting_no).await,
        None => Vec::new(),
    };
    Json(RoomDetail {
        room,
        meeting,
        participants,
    })
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct UpdateRoom {
    topic: Option<String>,
    password: Option<String>,
    locked: Option<bool>,
    presenter: Option<String>,
}

impl Default for UpdateRoom {
    fn default() -> Self {
        Self {
            topic: None,
            password: None,
            locked: None,
            presenter: None,
        }
    }
}

async fn update_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(body): Json<UpdateRoom>,
) -> Response {
    let Some(mut room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    if room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the room owner can update the room");
    }
    if let Some(topic) = body.topic {
        room.topic = topic;
    }
    if let Some(password) = body.password {
        room.password = password;
    }
    if let Some(locked) = body.locked {
        room.locked = locked;
    }
    if let Some(presenter) = body.presenter {
        room.presenter = presenter;
    }
    state.store.update_room(room.clone()).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    Json(room).into_response()
}

// ---------- meeting ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct JoinRequest {
    name: Option<String>,
    password: Option<String>,
}

impl Default for JoinRequest {
    fn default() -> Self {
        Self {
            name: None,
            password: None,
        }
    }
}

async fn join_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(body): Json<JoinRequest>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    let is_owner = room.owner == user.0;
    if room.locked && !is_owner {
        return error(StatusCode::FORBIDDEN, "room is locked");
    }
    if !room.password.is_empty() && !is_owner && body.password.as_deref() != Some(room.password.as_str()) {
        return error(StatusCode::FORBIDDEN, "invalid password");
    }

    // first participant starts the meeting instance
    let meeting = match state.store.current_meeting(&room_id).await {
        Some(m) => m,
        None => {
            let meeting = Meeting {
                meeting_no: uuid::Uuid::new_v4().to_string(),
                room_id: room_id.clone(),
                started_at: now_secs(),
                ended_at: None,
                max_concurrent: 0,
            };
            state.store.create_meeting(meeting.clone()).await;
            meeting
        }
    };

    let role = if is_owner { Role::Owner } else { Role::Member };
    let name = body.name.filter(|n| !n.is_empty()).unwrap_or_else(|| user.0.clone());
    let participants = state
        .store
        .join_participant(
            &meeting.meeting_no,
            Participant {
                user_id: user.0.clone(),
                name: name.clone(),
                role: role.clone(),
                join_at: now_secs(),
                leave_at: None,
            },
        )
        .await;
    let active = participants.iter().filter(|p| p.leave_at.is_none()).count();
    state.store.bump_concurrent(&meeting.meeting_no, active).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;

    Json(json!({
        "meetingNo": meeting.meeting_no,
        "userId": user.0,
        "role": role,
        "name": name,
    }))
    .into_response()
}

async fn leave_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let Some(meeting) = state.store.current_meeting(&room_id).await else {
        return StatusCode::NO_CONTENT.into_response();
    };
    state
        .store
        .leave_participant(&meeting.meeting_no, &user.0, now_secs())
        .await;
    state.store.remove_presence(&meeting.meeting_no, &user.0).await;
    archive_if_empty(&state, &room_id, &meeting).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    StatusCode::NO_CONTENT.into_response()
}

/// End the meeting when nobody is left, archiving the record.
async fn archive_if_empty(state: &AppState, room_id: &str, meeting: &Meeting) {
    let participants = state.store.participants(&meeting.meeting_no).await;
    if participants.iter().any(|p| p.leave_at.is_none()) {
        return;
    }
    end_and_archive(state, room_id, meeting).await;
}

async fn end_and_archive(state: &AppState, room_id: &str, meeting: &Meeting) {
    let ended_at = now_secs();
    // mark everyone left, so the record has complete durations
    let participants = state.store.participants(&meeting.meeting_no).await;
    for p in participants.iter().filter(|p| p.leave_at.is_none()) {
        state
            .store
            .leave_participant(&meeting.meeting_no, &p.user_id, ended_at)
            .await;
    }
    state.store.clear_presence(&meeting.meeting_no).await;
    let Some(ended) = state.store.end_meeting(&meeting.meeting_no, ended_at).await else {
        return;
    };
    let participants = state.store.participants(&meeting.meeting_no).await;
    let messages = state.store.take_messages(&meeting.meeting_no).await;
    state
        .store
        .archive_record(Record {
            meeting_no: ended.meeting_no,
            room_id: room_id.to_string(),
            started_at: ended.started_at,
            ended_at,
            max_concurrent: ended.max_concurrent,
            participants,
            messages,
        })
        .await;
}

async fn end_meeting(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    if room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the room owner can end the meeting");
    }
    let Some(meeting) = state.store.current_meeting(&room_id).await else {
        return StatusCode::NO_CONTENT.into_response();
    };
    end_and_archive(&state, &room_id, &meeting).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    StatusCode::NO_CONTENT.into_response()
}

/// Mute everyone (except the owner, exempted client-side). This only bumps
/// the broadcast timestamp; clients mute their own mic when they see it.
async fn mute_all(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let Some(mut room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    if room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the room owner can mute everyone");
    }
    room.mute_all_at = now_millis();
    state.store.update_room(room).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    StatusCode::NO_CONTENT.into_response()
}

async fn remove_participant(
    State(state): State<AppState>,
    Path((room_id, target)): Path<(String, String)>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    if room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the room owner can remove participants");
    }
    if target == user.0 {
        return error(StatusCode::BAD_REQUEST, "cannot remove yourself");
    }
    let Some(meeting) = state.store.current_meeting(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "no ongoing meeting");
    };
    let participants = state.store.participants(&meeting.meeting_no).await;
    let Some(p) = participants
        .iter()
        .find(|p| p.user_id == target && p.leave_at.is_none())
    else {
        return error(StatusCode::NOT_FOUND, "participant not found");
    };
    if p.role == Role::Owner {
        return error(StatusCode::FORBIDDEN, "cannot remove the room owner");
    }

    state
        .store
        .leave_participant(&meeting.meeting_no, &target, now_secs())
        .await;
    state.store.remove_presence(&meeting.meeting_no, &target).await;
    archive_if_empty(&state, &room_id, &meeting).await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    StatusCode::NO_CONTENT.into_response()
}

async fn room_records(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    if room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the room owner can list room records");
    }
    Json(state.store.records_for_room(&room_id).await).into_response()
}

// ---------- presence ----------

async fn set_presence(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    axum::Extension(user): axum::Extension<UserId>,
    Json(presence): Json<Presence>,
) -> Response {
    let Some(room) = state.store.get_room(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "room not found");
    };
    let Some(meeting) = state.store.current_meeting(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "no ongoing meeting");
    };
    // only the designated presenter (or the owner) may share their screen
    if presence.screen && !room.presenter.is_empty() && room.presenter != user.0 && room.owner != user.0 {
        return error(StatusCode::FORBIDDEN, "only the presenter can share screen");
    }
    state
        .store
        .set_presence(&meeting.meeting_no, &user.0, presence)
        .await;
    events::publish_room(&state.store, &state.bus, &room_id).await;
    StatusCode::NO_CONTENT.into_response()
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
    let Some(meeting) = state.store.current_meeting(&room_id).await else {
        return error(StatusCode::NOT_FOUND, "no ongoing meeting");
    };
    // display name comes from the participant record (what others see),
    // falling back to the user id
    let name = state
        .store
        .participants(&meeting.meeting_no)
        .await
        .iter()
        .find(|p| p.user_id == user.0)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| user.0.clone());
    let msg = Message {
        id: uuid::Uuid::new_v4().to_string(),
        user_id: user.0,
        name,
        content,
        ts: now_secs(),
    };
    state.store.add_message(&meeting.meeting_no, msg.clone()).await;
    events::publish_message(&state.bus, &room_id, &msg);
    (StatusCode::CREATED, Json(msg)).into_response()
}

// ---------- browser log intake ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientLogBatch {
    session_id: Option<String>,
    meeting_id: Option<String>,
    logs: Vec<ClientLogEntry>,
}

#[derive(Deserialize)]
struct ClientLogEntry {
    ts: Option<i64>,
    level: Option<String>,
    event: Option<String>,
    msg: Option<String>,
    data: Option<serde_json::Value>,
}

/// Write browser-reported logs as NDJSON lines on the `client_log` target;
/// `docker logs woom | grep client_log` answers "what did users hit".
async fn client_log(Json(batch): Json<ClientLogBatch>) -> StatusCode {
    for entry in batch.logs.iter().take(100) {
        let line = json!({
            "src": "browser",
            "sessionId": batch.session_id,
            "meetingId": batch.meeting_id,
            "ts": entry.ts,
            "level": entry.level.as_deref().unwrap_or("info"),
            "event": entry.event,
            "msg": entry.msg.as_deref().map(|m| m.chars().take(500).collect::<String>()),
            "data": entry.data,
        });
        tracing::info!(target: "client_log", "{}", line.to_string());
    }
    StatusCode::NO_CONTENT
}

// ---------- SSE ----------

async fn room_events(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
) -> Response {
    if auth_user(&state, &headers, &query).is_none() {
        return error(StatusCode::UNAUTHORIZED, "invalid token");
    }
    if state.store.get_room(&room_id).await.is_none() {
        return error(StatusCode::NOT_FOUND, "room not found");
    }

    let initial = events::snapshot(&state.store, &room_id).await;
    let stream = BroadcastStream::new(state.bus.subscribe()).filter_map(move |msg| {
        match msg {
            Ok(event) if event.room_id == room_id => {
                Some(Ok::<_, Infallible>(Event::default().data(event.payload)))
            }
            // lagged behind: the next publish carries a full snapshot anyway
            _ => None,
        }
    });
    let initial_stream = tokio_stream::once(Ok(Event::default().data(initial)));
    Sse::new(initial_stream.chain(stream))
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response()
}
