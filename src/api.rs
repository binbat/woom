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
use serde_json::json;
use tokio::sync::Mutex;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tower_http::trace::TraceLayer;

use crate::{
    config::Config,
    events::{EventBus, RoomEvent},
    log::{ClientLogBatch, ClientLogFilter, ClientLogStore},
    model::{Participant, Presence, Record, Room},
    proxy, spa,
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

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub bus: EventBus,
    pub cfg: Config,
    pub http: reqwest::Client,
    pub(crate) logs: ClientLogStore,
    pub(crate) media_sessions: Arc<Mutex<HashMap<String, proxy::MediaSession>>>,
    pub(crate) write_gate: Arc<Mutex<()>>,
    tickets: Arc<Mutex<HashMap<String, EventTicket>>>,
}

impl AppState {
    pub fn new(store: Arc<Store>, bus: EventBus, cfg: Config) -> Self {
        Self {
            store,
            bus,
            cfg,
            http: reqwest::Client::new(),
            logs: ClientLogStore::new(),
            media_sessions: Arc::new(Mutex::new(HashMap::new())),
            write_gate: Arc::new(Mutex::new(())),
            tickets: Arc::new(Mutex::new(HashMap::new())),
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
        .route("/room/{roomId}/records", get(room_records))
        .route("/room/{roomId}/events/ticket", post(create_event_ticket))
        .route("/user/records", get(user_records))
        .merge(media_routes())
        .route_layer(middleware::from_fn_with_state(state.clone(), jwt_auth));

    Router::new()
        .merge(protected)
        .route("/user/", post(create_user))
        .route(
            "/log",
            post(client_log)
                .get(read_client_logs)
                .layer(DefaultBodyLimit::max(MAX_CLIENT_LOG_BODY)),
        )
        .route("/room/{roomId}/events", get(room_events))
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
                    state.bus.publish(event);
                }
            }
            Err(error) => tracing::error!("participant/presence sweep failed: {error}"),
        }
    }
    let invalid = proxy::take_invalid_media_sessions(state).await;
    proxy::revoke_media_sessions(state, invalid).await;
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
    Ok(decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS512),
    )?
    .claims)
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

async fn publish<T>(state: &AppState, command: &Command<T>) {
    if let Some(event) = command.event.clone() {
        state.bus.publish(event);
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
    match encode(
        &Header::new(Algorithm::HS512),
        &claims,
        &EncodingKey::from_secret(state.cfg.secret.as_bytes()),
    ) {
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
}

impl RoomDetail {
    fn new(state: RoomState) -> Self {
        Self {
            room: state.room.into(),
            meeting: state.meeting,
            participants: state.participants,
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
    if !state.store.is_active(room_id, &user_id).await {
        room.meeting = None;
        room.participants.clear();
    }
    Ok(RoomDetail::new(room))
}

// ---------- room ----------

async fn create_room(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserId>,
) -> Response {
    let _guard = state.write_gate.lock().await;
    match state.store.create_room(&user.0).await {
        Ok(room) => Json(RoomDetail::new(RoomState {
            room,
            meeting: None,
            participants: Vec::new(),
            streams: HashMap::new(),
        }))
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
