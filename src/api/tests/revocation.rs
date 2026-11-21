use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

use axum::{
    extract::{OriginalUri, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use serde_json::{json, Value};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

use super::*;
use crate::model::Presence;

#[derive(Clone, Debug, PartialEq, Eq)]
struct DeleteRecord {
    resource: String,
    authorization: String,
}

#[derive(Clone, Default)]
struct RecordingUpstream {
    next_id: Arc<AtomicUsize>,
    deletes: Arc<std::sync::Mutex<Vec<DeleteRecord>>>,
    fail_next: Arc<AtomicBool>,
    delay_initial: bool,
    initial_started: Arc<tokio::sync::Notify>,
    release_initial: Arc<tokio::sync::Notify>,
    delay_delete: bool,
    delete_started: Arc<tokio::sync::Notify>,
    release_delete: Arc<tokio::sync::Notify>,
}

impl RecordingUpstream {
    fn deleted(&self) -> Vec<DeleteRecord> {
        self.deletes.lock().unwrap().clone()
    }
}

async fn recording_upstream(
    State(upstream): State<RecordingUpstream>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response {
    let resource = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("");
    if method == Method::DELETE {
        upstream.deletes.lock().unwrap().push(DeleteRecord {
            resource: resource.to_string(),
            authorization: headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string(),
        });
        if upstream.delay_delete {
            upstream.delete_started.notify_one();
            upstream.release_delete.notified().await;
        }
        return StatusCode::NO_CONTENT.into_response();
    }
    if upstream.fail_next.swap(false, Ordering::SeqCst) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if upstream.delay_initial && method == Method::POST {
        upstream.initial_started.notify_one();
        upstream.release_initial.notified().await;
    }

    let id = upstream.next_id.fetch_add(1, Ordering::SeqCst);
    let kind = if uri.path().starts_with("/whip/") {
        "whip"
    } else {
        "whep"
    };
    let location = format!("/session/{kind}-{id}?resource={kind}");
    (
        StatusCode::CREATED,
        [(header::LOCATION, HeaderValue::from_str(&location).unwrap())],
        Json(json!({ "resource": resource })),
    )
        .into_response()
}

fn upstream_router(upstream: RecordingUpstream) -> Router {
    Router::new()
        .route("/whip/{uuid}", any(recording_upstream))
        .route("/whip/{uuid}/{*rest}", any(recording_upstream))
        .route("/whep/{uuid}", any(recording_upstream))
        .route("/whep/{uuid}/{*rest}", any(recording_upstream))
        .route("/session/{*rest}", any(recording_upstream))
        .with_state(upstream)
}

async fn start_media(
    client: &reqwest::Client,
    server: &TestServer,
    user: &TestUser,
    kind: &str,
    target: &str,
) -> String {
    let response = bearer(
        client.post(format!("{}/{kind}/{target}", server.origin)),
        user,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::CREATED);
    let location = response.headers()[header::LOCATION.as_str()]
        .to_str()
        .unwrap()
        .to_string();
    response.json::<Value>().await.unwrap();
    location
}

async fn session_count(state: &AppState) -> usize {
    state.media_sessions.lock().await.len()
}

#[tokio::test]
async fn kick_and_end_revoke_media_with_upstream_token() {
    let recorder = RecordingUpstream::default();
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;

    let owner_publish = start_media(&client, &server, &owner, "whip", &owner.stream_id).await;
    let guest_view = start_media(&client, &server, &guest, "whep", &owner.stream_id).await;
    let owner_view = start_media(&client, &server, &owner, "whep", &guest.stream_id).await;
    assert_eq!(session_count(&state).await, 3);

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
    assert_eq!(session_count(&state).await, 2);
    assert_eq!(
        recorder.deleted(),
        vec![DeleteRecord {
            resource: guest_view.clone(),
            authorization: "Bearer upstream-token".to_string(),
        }]
    );

    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    assert_eq!(session_count(&state).await, 0);
    let mut deleted = recorder
        .deleted()
        .into_iter()
        .map(|record| record.resource)
        .collect::<Vec<_>>();
    deleted.sort();
    let mut expected = vec![guest_view, owner_publish, owner_view];
    expected.sort();
    assert_eq!(deleted, expected);
    assert!(recorder
        .deleted()
        .iter()
        .all(|record| record.authorization == "Bearer upstream-token"));
}

#[tokio::test]
async fn leave_revokes_only_the_departing_users_sessions() {
    let recorder = RecordingUpstream::default();
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    let owner_publish = start_media(&client, &server, &owner, "whip", &owner.stream_id).await;
    let guest_view = start_media(&client, &server, &guest, "whep", &owner.stream_id).await;

    let left = bearer(
        client.post(format!("{}/room/{room_id}/leave", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(left.status(), ReqwestStatus::NO_CONTENT);
    assert_eq!(session_count(&state).await, 1);
    assert_eq!(recorder.deleted()[0].resource, owner_publish);

    let left = bearer(
        client.post(format!("{}/room/{room_id}/leave", server.origin)),
        &guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(left.status(), ReqwestStatus::NO_CONTENT);
    assert_eq!(session_count(&state).await, 0);
    let mut deleted = recorder
        .deleted()
        .into_iter()
        .map(|record| record.resource)
        .collect::<Vec<_>>();
    deleted.sort();
    let mut expected = vec![owner_publish, guest_view];
    expected.sort();
    assert_eq!(deleted, expected);
}

#[tokio::test]
async fn upstream_revocation_does_not_hold_the_room_write_gate() {
    let recorder = RecordingUpstream {
        delay_delete: true,
        ..RecordingUpstream::default()
    };
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    start_media(&client, &server, &owner, "whip", &owner.stream_id).await;

    let request_client = client.clone();
    let request_url = format!("{}/room/{room_id}/leave", server.origin);
    let request_token = owner.token.clone();
    let leave = tokio::spawn(async move {
        request_client
            .post(request_url)
            .bearer_auth(request_token)
            .send()
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(5), recorder.delete_started.notified())
        .await
        .unwrap();
    let patched = tokio::time::timeout(
        Duration::from_secs(2),
        bearer(
            client.patch(format!("{}/room/{room_id}", server.origin)),
            &owner,
        )
        .json(&json!({ "topic": "write gate is free" }))
        .send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(patched.status(), ReqwestStatus::OK);
    recorder.release_delete.notify_one();
    assert_eq!(leave.await.unwrap().status(), ReqwestStatus::NO_CONTENT);
    assert_eq!(session_count(&state).await, 0);
}

#[tokio::test]
async fn participant_sweep_cleans_sessions_without_expiring_active_media() {
    let recorder = RecordingUpstream::default();
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    start_media(&client, &server, &owner, "whip", &owner.stream_id).await;
    start_media(&client, &server, &guest, "whep", &owner.stream_id).await;
    let now = crate::store::now_secs();

    sweep_at(&state, now + 46, 45, 3600).await;
    assert_eq!(session_count(&state).await, 2);
    assert!(recorder.deleted().is_empty());

    sweep_at(&state, now + 3601, 45, 3600).await;
    assert_eq!(session_count(&state).await, 0);
    assert_eq!(recorder.deleted().len(), 2);
    assert!(!state.store.is_active(&room_id, &owner.stream_id).await);
    assert!(!state.store.is_active(&room_id, &guest.stream_id).await);
}

#[tokio::test]
async fn churn_replaces_old_sessions_and_upstream_404_cleans_mapping() {
    let recorder = RecordingUpstream::default();
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let first = start_media(&client, &server, &owner, "whip", &owner.stream_id).await;
    let second = start_media(&client, &server, &owner, "whip", &owner.stream_id).await;
    assert_ne!(first, second);
    assert_eq!(session_count(&state).await, 1);
    assert_eq!(recorder.deleted()[0].resource, first);

    recorder.fail_next.store(true, Ordering::SeqCst);
    let missing = bearer(client.patch(format!("{}{}", server.origin, second)), &owner)
        .body("update")
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), ReqwestStatus::NOT_FOUND);
    assert_eq!(session_count(&state).await, 0);
    let rejected = bearer(client.patch(format!("{}{}", server.origin, second)), &owner)
        .body("update")
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), ReqwestStatus::FORBIDDEN);
}

#[tokio::test]
async fn initial_signaling_rechecks_authorization_and_cleans_up_on_race() {
    let recorder = RecordingUpstream {
        delay_initial: true,
        ..RecordingUpstream::default()
    };
    let upstream = serve(upstream_router(recorder.clone())).await;
    let (server, state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let request_client = client.clone();
    let request_url = format!("{}/whip/{}", server.origin, owner.stream_id);
    let request_token = owner.token.clone();
    let initial = tokio::spawn(async move {
        request_client
            .post(request_url)
            .bearer_auth(request_token)
            .body("offer")
            .send()
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(5), recorder.initial_started.notified())
        .await
        .unwrap();
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    recorder.release_initial.notify_one();

    let initial = initial.await.unwrap();
    assert_eq!(initial.status(), ReqwestStatus::FORBIDDEN);
    assert_eq!(session_count(&state).await, 0);
    let deleted = recorder.deleted();
    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].resource.starts_with("/session/whip-"));
    assert!(deleted[0].resource.ends_with("?resource=whip"));
    assert_eq!(deleted[0].authorization, "Bearer upstream-token");
}

#[tokio::test]
async fn lag_after_kick_and_new_meeting_returns_only_safe_end_snapshot() {
    let cfg = Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: "http://127.0.0.1:9".to_string(),
        live777_token: String::new(),
        log_read_token: None,
        data_file: PathBuf::from(":memory:"),
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let room_id = state.store.create_room("owner").await.unwrap().room_id;
    state
        .store
        .join(&room_id, "owner", None, None)
        .await
        .unwrap();
    state
        .store
        .join(&room_id, "guest", None, None)
        .await
        .unwrap();
    let initial_revision = state.store.snapshot(&room_id).await.unwrap().revision;
    let (sender, receiver) = tokio::sync::broadcast::channel(1);
    let mut stream = RoomEventStream {
        receiver: BroadcastStream::new(receiver),
        state: state.clone(),
        room_id: room_id.clone(),
        user_id: "guest".to_string(),
        initial: None,
        last_revision: initial_revision,
        lagged_snapshot: None,
        done: false,
    };

    let kicked = state
        .store
        .kick(&room_id, "owner", "guest")
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(kicked).unwrap();
    let chat = state
        .store
        .add_message(&room_id, "owner", "old-meeting-secret".to_string())
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(chat).unwrap();
    let ended = state
        .store
        .end(&room_id, "owner")
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(ended).unwrap();
    let joined = state
        .store
        .join(&room_id, "owner", None, None)
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(joined).unwrap();
    let presence = state
        .store
        .set_presence(
            &room_id,
            "owner",
            Presence {
                video: true,
                ..Presence::default()
            },
        )
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(presence).unwrap();
    let new_chat = state
        .store
        .add_message(&room_id, "owner", "new-meeting-secret".to_string())
        .await
        .unwrap()
        .event
        .unwrap();
    sender.send(new_chat).unwrap();

    let current = state.store.snapshot(&room_id).await.unwrap();
    assert!(current.meeting_no.is_some());
    assert!(!current.messages.is_empty());
    assert!(!current.streams.is_empty());
    let recovered = stream.next().await.unwrap();
    let snapshot = recovered.snapshot_ref().unwrap();
    assert_eq!(snapshot.revision, current.revision);
    assert!(snapshot.meeting_no.is_none());
    assert!(snapshot.streams.is_empty());
    assert!(snapshot.participants.is_empty());
    assert!(snapshot.messages.is_empty());
    assert!(snapshot.presenter.is_empty());
    let payload = recovered.payload_json();
    assert!(!payload.contains("old-meeting-secret"));
    assert!(!payload.contains("new-meeting-secret"));
    assert!(!payload.contains(current.meeting_no.as_deref().unwrap()));
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn missing_or_inactive_rooms_do_not_grow_the_event_bus() {
    let (server, state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let missing = bearer(
        client.get(format!("{}/room/not-a-room/events", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(missing.status(), ReqwestStatus::NOT_FOUND);
    assert_eq!(state.bus.room_count(), 0);

    let room_id = new_room(&client, &server, &owner).await;
    let inactive = bearer(
        client.get(format!("{}/room/{room_id}/events", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(inactive.status(), ReqwestStatus::FORBIDDEN);
    assert_eq!(state.bus.room_count(), 0);

    join(&client, &server, &room_id, &owner).await;
    let active = bearer(
        client.get(format!("{}/room/{room_id}/events", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(active.status(), ReqwestStatus::OK);
    assert_eq!(state.bus.room_count(), 1);
}
