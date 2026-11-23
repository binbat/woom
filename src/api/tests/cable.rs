use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{OriginalUri, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, post},
    Json, Router,
};
use serde_json::{json, Value};

use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
struct CableCall {
    path: String,
    authorization: String,
    body: String,
}

/// Mock Live777 cable API: records every call, answers 404 for injects into
/// unknown streams and provisions streams on create.
#[derive(Clone, Default)]
struct CableUpstream {
    calls: Arc<Mutex<Vec<CableCall>>>,
    streams: Arc<Mutex<HashSet<String>>>,
    fail_create: Arc<AtomicBool>,
}

impl CableUpstream {
    fn calls(&self) -> Vec<CableCall> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, path: String, headers: &HeaderMap, body: &[u8]) {
        self.calls.lock().unwrap().push(CableCall {
            path,
            authorization: headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string(),
            body: String::from_utf8_lossy(body).to_string(),
        });
    }
}

async fn cable_messages(
    State(upstream): State<CableUpstream>,
    Path((stream, label)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    upstream.record(
        format!("/api/streams/{stream}/cables/{label}/messages"),
        &headers,
        &body,
    );
    if !upstream.streams.lock().unwrap().contains(&stream) {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({ "receivers": 0 })).into_response()
}

async fn create_stream(
    State(upstream): State<CableUpstream>,
    Path(stream): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    upstream.record(format!("/api/streams/{stream}"), &headers, &body);
    if upstream.fail_create.load(Ordering::SeqCst) {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    upstream.streams.lock().unwrap().insert(stream);
    StatusCode::NO_CONTENT.into_response()
}

async fn whep_viewer(
    State(upstream): State<CableUpstream>,
    Path(stream): Path<String>,
    headers: HeaderMap,
) -> Response {
    upstream.record(format!("/whep/{stream}"), &headers, &[]);
    (
        StatusCode::CREATED,
        [(
            header::LOCATION,
            HeaderValue::from_static("/session/whep-events?resource=whep"),
        )],
        Json(json!({})),
    )
        .into_response()
}

async fn session_delete(
    State(upstream): State<CableUpstream>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response {
    let resource = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("");
    upstream.record(resource.to_string(), &headers, &[]);
    StatusCode::NO_CONTENT.into_response()
}

fn upstream_router(upstream: CableUpstream) -> Router {
    Router::new()
        .route("/api/streams/{stream}", post(create_stream))
        .route(
            "/api/streams/{stream}/cables/{label}/messages",
            post(cable_messages),
        )
        .route("/whep/{uuid}", any(whep_viewer))
        .route("/session/{*rest}", any(session_delete))
        .with_state(upstream)
}

async fn spawn_cable_app(live777_url: &str) -> (TestServer, AppState) {
    let cfg = Config {
        events_cable: true,
        ..test_config(live777_url)
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let server = serve(router(state.clone())).await;
    (server, state)
}

async fn wait_for_calls(upstream: &CableUpstream, count: usize) -> Vec<CableCall> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let calls = upstream.calls();
            if calls.len() >= count {
                return calls;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for cable upstream calls")
}

fn messages_path(room_id: &str) -> String {
    format!(
        "/api/streams/{}/cables/events/messages",
        crate::cable::events_stream_id(room_id)
    )
}

async fn send_chat(client: &reqwest::Client, server: &TestServer, room_id: &str, user: &TestUser) {
    let response = bearer(
        client.post(format!("{}/room/{room_id}/message", server.origin)),
        user,
    )
    .json(&json!({ "content": "hello cable" }))
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::CREATED);
}

#[tokio::test]
async fn published_events_are_injected_in_commit_order() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, state) = spawn_cable_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    upstream
        .streams
        .lock()
        .unwrap()
        .insert(crate::cable::events_stream_id(&room_id));
    let mut events = state.bus.subscribe(&room_id);

    join(&client, &server, &room_id, &owner).await;
    let presence = bearer(
        client.patch(format!("{}/room/{room_id}/presence", server.origin)),
        &owner,
    )
    .json(&json!({ "audio": true }))
    .send()
    .await
    .unwrap();
    assert_eq!(presence.status(), ReqwestStatus::NO_CONTENT);
    send_chat(&client, &server, &room_id, &owner).await;

    let mut payloads = Vec::new();
    for _ in 0..3 {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .unwrap()
            .unwrap();
        payloads.push(event.payload_json());
    }
    let calls = wait_for_calls(&upstream, 3).await;
    assert_eq!(calls.len(), 3);
    for (call, payload) in calls.iter().zip(payloads.iter()) {
        assert_eq!(call.path, messages_path(&room_id));
        assert_eq!(call.authorization, "Bearer upstream-token");
        assert_eq!(call.body, json!({ "data": payload }).to_string());
    }
}

#[tokio::test]
async fn disabled_cable_never_calls_the_upstream() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    send_chat(&client, &server, &room_id, &owner).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(upstream.calls().is_empty());
}

#[tokio::test]
async fn unknown_stream_is_provisioned_and_the_inject_retried_once() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_cable_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let calls = wait_for_calls(&upstream, 3).await;
    assert_eq!(
        calls
            .iter()
            .map(|call| call.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            messages_path(&room_id),
            format!("/api/streams/{}-events", room_id),
            messages_path(&room_id),
        ]
    );
    assert_eq!(calls[0].body, calls[2].body);
    assert!(calls
        .iter()
        .all(|call| call.authorization == "Bearer upstream-token"));
}

#[tokio::test]
async fn failed_stream_create_warns_and_later_events_are_still_attempted() {
    let upstream = CableUpstream {
        fail_create: Arc::new(AtomicBool::new(true)),
        ..CableUpstream::default()
    };
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_cable_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let create_path = format!("/api/streams/{}-events", room_id);
    let calls = wait_for_calls(&upstream, 2).await;
    assert_eq!(calls[0].path, messages_path(&room_id));
    assert_eq!(calls[1].path, create_path);

    send_chat(&client, &server, &room_id, &owner).await;
    let calls = wait_for_calls(&upstream, 4).await;
    assert_eq!(calls[2].path, messages_path(&room_id));
    assert_eq!(calls[3].path, create_path);
}

#[tokio::test]
async fn events_stream_whep_authorization_requires_active_participation() {
    let store = Store::memory();
    let room_id = store.create_room("owner").await.unwrap().room_id;
    let meeting_no = store
        .join(&room_id, "owner", None, None)
        .await
        .unwrap()
        .value
        .meeting_no;
    let other_room = store.create_room("other").await.unwrap().room_id;
    store.join(&other_room, "other", None, None).await.unwrap();
    let events_stream = crate::cable::events_stream_id(&room_id);

    let grant = store
        .whep_events_authorization("owner", &events_stream)
        .await
        .unwrap();
    assert_eq!(grant.room_id, room_id);
    assert_eq!(grant.meeting_no, meeting_no);
    assert!(store
        .whep_events_authorization("outsider", &events_stream)
        .await
        .is_none());
    assert!(store
        .whep_events_authorization("other", &events_stream)
        .await
        .is_none());
    // Publishing to the events stream is never allowed (whip requires
    // user_id == stream_id and no participant has that id).
    assert!(store
        .whip_authorization(&events_stream, &events_stream)
        .await
        .is_none());
    // Meeting turnover invalidates the grant.
    store.end(&room_id, "owner").await.unwrap();
    assert!(store
        .whep_events_authorization("owner", &events_stream)
        .await
        .is_none());
}

#[tokio::test]
async fn whep_proxy_forwards_events_stream_for_active_participants() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    let events_stream = crate::cable::events_stream_id(&room_id);

    let view = bearer(
        client.post(format!("{}/whep/{events_stream}", server.origin)),
        &owner,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(view.status(), ReqwestStatus::CREATED);
    // The events stream is ensured on Live777 before the subscribe POST is
    // forwarded upstream.
    let calls = upstream.calls();
    assert_eq!(
        calls
            .iter()
            .map(|call| call.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            format!("/api/streams/{events_stream}"),
            format!("/whep/{events_stream}"),
        ]
    );
    assert!(calls
        .iter()
        .all(|call| call.authorization == "Bearer upstream-token"));

    let denied = bearer(
        client.post(format!("{}/whep/{events_stream}", server.origin)),
        &guest,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(denied.status(), ReqwestStatus::FORBIDDEN);
    let publish = bearer(
        client.post(format!("{}/whip/{events_stream}", server.origin)),
        &owner,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(publish.status(), ReqwestStatus::FORBIDDEN);
    // Denied requests never reach the upstream.
    assert_eq!(upstream.calls().len(), 2);
}

#[tokio::test]
async fn failed_events_stream_ensure_still_forwards_the_subscribe() {
    let upstream = CableUpstream {
        fail_create: Arc::new(AtomicBool::new(true)),
        ..CableUpstream::default()
    };
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    let events_stream = crate::cable::events_stream_id(&room_id);

    let view = bearer(
        client.post(format!("{}/whep/{events_stream}", server.origin)),
        &owner,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(view.status(), ReqwestStatus::CREATED);
    let calls = upstream.calls();
    assert_eq!(
        calls
            .iter()
            .map(|call| call.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            format!("/api/streams/{events_stream}"),
            format!("/whep/{events_stream}"),
        ]
    );
}

#[tokio::test]
async fn kick_revokes_the_events_whep_session() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    let events_stream = crate::cable::events_stream_id(&room_id);

    let view = bearer(
        client.post(format!("{}/whep/{events_stream}", server.origin)),
        &guest,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(view.status(), ReqwestStatus::CREATED);

    let kicked = bearer(
        client.delete(format!(
            "{}/room/{room_id}/participant/{}",
            server.origin, guest.stream_id
        )),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(kicked.status(), ReqwestStatus::NO_CONTENT);
    // The kicked participant's events session is revoked upstream like any
    // other media session, so they stop receiving room events immediately.
    let calls = upstream.calls();
    let delete = calls
        .iter()
        .find(|call| call.path == "/session/whep-events?resource=whep")
        .expect("events session revoke DELETE missing");
    assert_eq!(delete.authorization, "Bearer upstream-token");
}

#[tokio::test]
async fn room_detail_advertises_events_stream_only_to_active_participants() {
    let upstream = CableUpstream::default();
    let live777 = serve(upstream_router(upstream.clone())).await;
    let (server, _state) = spawn_cable_app(&live777.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let outsider = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let detail = bearer(
        client.get(format!("{}/room/{room_id}", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(
        detail["eventsStream"].as_str().unwrap(),
        format!("{room_id}-events")
    );

    let lobby = bearer(
        client.get(format!("{}/room/{room_id}", server.origin)),
        &outsider,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert!(lobby.get("eventsStream").is_none());

    let (plain_server, _plain_state) = spawn_app(&live777.origin).await;
    let plain_owner = new_user(&client, &plain_server).await;
    let plain_room = new_room(&client, &plain_server, &plain_owner).await;
    join(&client, &plain_server, &plain_room, &plain_owner).await;
    let detail = bearer(
        client.get(format!("{}/room/{plain_room}", plain_server.origin)),
        &plain_owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert!(detail.get("eventsStream").is_none());
}
