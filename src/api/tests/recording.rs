use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    extract::{OriginalUri, Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, patch},
    Json, Router,
};
use serde_json::{json, Value};

use super::admin::{admin_login_token, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER};
use super::*;

/// Fake Live777 with the recorder endpoints: WHIP handshake + session +
/// /api/record/* + /api/playback + /api/recordings + /api/record/object/*.
type StoredObjects = HashMap<String, (String, Vec<u8>)>;

#[derive(Clone, Default)]
struct RecorderUpstream {
    starts: Arc<Mutex<Vec<String>>>,
    stops: Arc<Mutex<Vec<String>>>,
    index_writes: Arc<Mutex<Vec<String>>>,
    objects: Arc<Mutex<StoredObjects>>,
    recorder_available: Arc<AtomicBool>,
    next_id: Arc<AtomicUsize>,
}

impl RecorderUpstream {
    fn available(self) -> Self {
        self.recorder_available.store(true, Ordering::SeqCst);
        self
    }
}

async fn whip_handshake(
    State(upstream): State<RecorderUpstream>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    let id = upstream.next_id.fetch_add(1, Ordering::SeqCst);
    let location = format!("/session/whip-{id}?resource=whip");
    (
        StatusCode::CREATED,
        [(header::LOCATION, HeaderValue::from_str(&location).unwrap())],
        Json(json!({ "resource": uri.path() })),
    )
        .into_response()
}

async fn session_ok() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn record_start(
    State(upstream): State<RecorderUpstream>,
    Path(stream): Path<String>,
    headers: HeaderMap,
) -> Response {
    // Live777 parses a JSON StartRecordRequest and rejects other content types
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("application/json") {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    upstream.starts.lock().unwrap().push(stream.clone());
    Json(json!({
        "id": stream,
        "record_id": "1762842203",
        "record_dir": format!("{stream}/1762842203"),
        "mpd_path": format!("{stream}/1762842203/manifest.mpd"),
    }))
    .into_response()
}

async fn record_stop(
    State(upstream): State<RecorderUpstream>,
    Path(stream): Path<String>,
) -> StatusCode {
    upstream.stops.lock().unwrap().push(stream);
    StatusCode::OK
}

async fn playback_probe(State(upstream): State<RecorderUpstream>) -> Response {
    if upstream.recorder_available.load(Ordering::SeqCst) {
        Json(json!([])).into_response()
    } else {
        StatusCode::NOT_IMPLEMENTED.into_response()
    }
}

async fn record_object(
    State(upstream): State<RecorderUpstream>,
    Path(path): Path<String>,
) -> Response {
    match upstream.objects.lock().unwrap().get(&path) {
        Some((content_type, bytes)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .body(axum::body::Body::from(bytes.clone()))
            .unwrap(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn recordings_index(
    State(upstream): State<RecorderUpstream>,
    method: Method,
    Json(body): Json<Value>,
) -> Response {
    upstream
        .index_writes
        .lock()
        .unwrap()
        .push(format!("{method} {body}"));
    Json(json!({ "acked": 1, "deleted": 1 })).into_response()
}

fn recorder_router(upstream: RecorderUpstream) -> Router {
    Router::new()
        .route("/whip/{uuid}", any(whip_handshake))
        .route("/session/{*rest}", any(session_ok))
        .route("/api/playback", get(playback_probe))
        .route(
            "/api/record/{stream}",
            axum::routing::post(record_start).delete(record_stop),
        )
        .route("/api/record/object/{*path}", get(record_object))
        .route(
            "/api/recordings",
            patch(recordings_index).delete(recordings_index),
        )
        .with_state(upstream)
}

async fn spawn_recording_app(upstream_url: &str) -> (TestServer, AppState) {
    let cfg = Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: upstream_url.to_string(),
        live777_token: "upstream-token".to_string(),
        log_read_token: None,
        caption_token: None,
        minutes_url: None,
        minutes_model: None,
        minutes_api_key: None,
        admin_user: Some(TEST_ADMIN_USER.to_string()),
        admin_password: Some(TEST_ADMIN_PASSWORD.to_string()),
        events_cable: false,
        data_file: PathBuf::from(":memory:"),
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let server = serve(router(state.clone())).await;
    (server, state)
}

async fn publish(client: &reqwest::Client, server: &TestServer, user: &TestUser) {
    let response = bearer(
        client.post(format!("{}/whip/{}", server.origin, user.stream_id)),
        user,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::CREATED);
}

async fn start_recording(
    client: &reqwest::Client,
    server: &TestServer,
    room_id: &str,
    user: &TestUser,
) -> reqwest::Response {
    bearer(
        client.post(format!("{}/room/{room_id}/recording", server.origin)),
        user,
    )
    .send()
    .await
    .unwrap()
}

async fn room_recording_at(
    client: &reqwest::Client,
    server: &TestServer,
    room_id: &str,
    user: &TestUser,
) -> Value {
    bearer(
        client.get(format!("{}/room/{room_id}", server.origin)),
        user,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap()["meeting"]["recordingAt"]
        .clone()
}

#[tokio::test]
async fn recording_toggle_requires_an_owner_and_a_meeting() {
    let upstream = serve(recorder_router(RecorderUpstream::default().available())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;

    // No ongoing meeting yet.
    let response = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(response.status(), ReqwestStatus::NOT_FOUND);

    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;

    // Members cannot toggle recording.
    let forbidden = start_recording(&client, &server, &room_id, &guest).await;
    assert_eq!(forbidden.status(), ReqwestStatus::FORBIDDEN);

    let started = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(started.status(), ReqwestStatus::OK);
    assert!(room_recording_at(&client, &server, &room_id, &owner)
        .await
        .is_number());

    // Idempotent re-start.
    let again = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(again.status(), ReqwestStatus::OK);

    // Nobody publishes, so nothing reaches the upstream recorder.
    let stopped = bearer(
        client.delete(format!("{}/room/{room_id}/recording", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(stopped.status(), ReqwestStatus::NO_CONTENT);
    assert!(room_recording_at(&client, &server, &room_id, &owner)
        .await
        .is_null());
}

#[tokio::test]
async fn recording_streams_follow_publishers_and_stop_on_leave_and_end() {
    let upstream_state = RecorderUpstream::default().available();
    let upstream = serve(recorder_router(upstream_state.clone())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    publish(&client, &server, &owner).await;
    publish(&client, &server, &guest).await;
    assert!(upstream_state.starts.lock().unwrap().is_empty());

    let started = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(started.status(), ReqwestStatus::OK);
    let mut starts = upstream_state.starts.lock().unwrap().clone();
    starts.sort();
    let mut expected = vec![owner.stream_id.clone(), guest.stream_id.clone()];
    expected.sort();
    assert_eq!(starts, expected);

    // A guest leaving mid-recording finalizes their stream only.
    let left = bearer(
        client.post(format!("{}/room/{room_id}/leave", server.origin)),
        &guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(left.status(), ReqwestStatus::NO_CONTENT);
    assert_eq!(
        upstream_state.stops.lock().unwrap().as_slice(),
        std::slice::from_ref(&guest.stream_id)
    );

    // Ending the meeting stops the rest and archives the entries.
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    let mut stops = upstream_state.stops.lock().unwrap().clone();
    stops.sort();
    assert_eq!(stops, expected);

    let records = bearer(
        client.get(format!("{}/room/{room_id}/records", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    let recordings = records[0]["recordings"].as_array().unwrap();
    assert_eq!(recordings.len(), 2);
    for entry in recordings {
        assert_eq!(
            entry["recordDir"],
            format!("{}/1762842203", entry["streamId"].as_str().unwrap())
        );
        assert!(entry["endedAt"].is_number());
        assert_eq!(entry["name"], "test-user");
    }

    // The admin summary carries the recording count.
    let token = admin_login_token(&client, &server).await;
    let summaries = client
        .get(format!("{}/api/admin/records", server.origin))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(summaries[0]["recordingCount"], 2);
}

#[tokio::test]
async fn recording_starts_for_late_publishers() {
    let upstream_state = RecorderUpstream::default().available();
    let upstream = serve(recorder_router(upstream_state.clone())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    // Recording is on before anyone publishes; publishing picks it up.
    let started = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(started.status(), ReqwestStatus::OK);
    assert!(upstream_state.starts.lock().unwrap().is_empty());
    publish(&client, &server, &owner).await;
    assert_eq!(
        upstream_state.starts.lock().unwrap().as_slice(),
        std::slice::from_ref(&owner.stream_id)
    );
}

#[tokio::test]
async fn recording_toggle_surfaces_a_missing_recorder_feature() {
    // Upstream without the recorder feature: /api/playback answers 501.
    let upstream = serve(recorder_router(RecorderUpstream::default())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let response = start_recording(&client, &server, &room_id, &owner).await;
    assert_eq!(response.status(), ReqwestStatus::SERVICE_UNAVAILABLE);
    assert!(room_recording_at(&client, &server, &room_id, &owner)
        .await
        .is_null());
}

/// Seed an archived meeting with one recorded stream; returns the ids.
async fn archived_recording(
    client: &reqwest::Client,
    server: &TestServer,
) -> (TestUser, TestUser, String, String) {
    let owner = new_user(client, server).await;
    let outsider = new_user(client, server).await;
    let room_id = new_room(client, server, &owner).await;
    join(client, server, &room_id, &owner).await;
    publish(client, server, &owner).await;
    let started = start_recording(client, server, &room_id, &owner).await;
    assert_eq!(started.status(), ReqwestStatus::OK);
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    let records = bearer(
        client.get(format!("{}/room/{room_id}/records", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    let meeting_no = records[0]["meetingNo"].as_str().unwrap().to_string();
    (owner, outsider, room_id, meeting_no)
}

#[tokio::test]
async fn playback_proxy_serves_objects_with_tickets() {
    let upstream_state = RecorderUpstream::default().available();
    let upstream = serve(recorder_router(upstream_state.clone())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let (owner, outsider, room_id, meeting_no) = archived_recording(&client, &server).await;

    let manifest_path = format!("{}/1762842203/manifest.mpd", owner.stream_id);
    upstream_state.objects.lock().unwrap().insert(
        manifest_path.clone(),
        ("application/dash+xml".to_string(), b"<MPD/>".to_vec()),
    );

    // Only the owner or a meeting participant gets a ticket.
    let forbidden = bearer(
        client.post(format!(
            "{}/room/{room_id}/records/{meeting_no}/playback/ticket",
            server.origin
        )),
        &outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(forbidden.status(), ReqwestStatus::FORBIDDEN);
    let ticket = bearer(
        client.post(format!(
            "{}/room/{room_id}/records/{meeting_no}/playback/ticket",
            server.origin
        )),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_string();

    let playback_url = || {
        format!(
            "{}/room/{room_id}/records/{meeting_no}/playback/{manifest_path}",
            server.origin
        )
    };
    let unauthorized = client.get(playback_url()).send().await.unwrap();
    assert_eq!(unauthorized.status(), ReqwestStatus::UNAUTHORIZED);
    let wrong_ticket = client
        .get(format!("{}?ticket=wrong", playback_url()))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_ticket.status(), ReqwestStatus::UNAUTHORIZED);

    let manifest = client
        .get(format!("{}?ticket={ticket}", playback_url()))
        .send()
        .await
        .unwrap();
    assert_eq!(manifest.status(), ReqwestStatus::OK);
    assert_eq!(
        manifest.headers()[header::CONTENT_TYPE.as_str()],
        "application/dash+xml"
    );
    assert_eq!(manifest.text().await.unwrap(), "<MPD/>");

    // Paths outside the meeting's record dirs are not served.
    let outside = client
        .get(format!(
            "{}/room/{room_id}/records/{meeting_no}/playback/other/1762842203/manifest.mpd?ticket={ticket}",
            server.origin
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(outside.status(), ReqwestStatus::NOT_FOUND);

    // The admin ticket route unlocks the admin playback URL.
    let admin_token = admin_login_token(&client, &server).await;
    let admin_ticket = client
        .post(format!(
            "{}/api/admin/records/{meeting_no}/playback/ticket",
            server.origin
        ))
        .bearer_auth(&admin_token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_string();
    let admin_manifest = client
        .get(format!(
            "{}/api/admin/records/{meeting_no}/playback/{manifest_path}?ticket={admin_ticket}",
            server.origin
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(admin_manifest.status(), ReqwestStatus::OK);
    // User tokens do not pass as playback tickets.
    let bearer_is_not_ticket = client
        .get(playback_url())
        .bearer_auth(&owner.token)
        .send()
        .await
        .unwrap();
    assert_eq!(bearer_is_not_ticket.status(), ReqwestStatus::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_deletes_recording_entries() {
    let upstream_state = RecorderUpstream::default().available();
    let upstream = serve(recorder_router(upstream_state.clone())).await;
    let (server, _state) = spawn_recording_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let (owner, _outsider, _room_id, meeting_no) = archived_recording(&client, &server).await;
    let token = admin_login_token(&client, &server).await;
    let record_dir = format!("{}/1762842203", owner.stream_id);

    let deleted = client
        .delete(format!(
            "{}/api/admin/records/{meeting_no}/recordings/{record_dir}",
            server.origin
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), ReqwestStatus::NO_CONTENT);

    let detail = client
        .get(format!("{}/api/admin/records/{meeting_no}", server.origin))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(detail["recordings"].as_array().unwrap().len(), 0);

    let again = client
        .delete(format!(
            "{}/api/admin/records/{meeting_no}/recordings/{record_dir}",
            server.origin
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(again.status(), ReqwestStatus::NOT_FOUND);

    // The Live777 index row is acked and deleted best-effort.
    let writes = upstream_state.index_writes.lock().unwrap().clone();
    assert_eq!(writes.len(), 2);
    assert!(writes[0].starts_with("PATCH"));
    assert!(writes[1].starts_with("DELETE"));
    assert!(writes[0].contains(&owner.stream_id));
    assert!(writes[0].contains("1762842203"));
}
