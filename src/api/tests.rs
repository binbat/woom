use std::path::PathBuf;

use axum::{extract::OriginalUri, http::HeaderValue};
use reqwest::{RequestBuilder, StatusCode as ReqwestStatus};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;

use super::*;
use crate::model::Message;

mod admin;
mod cable;
mod logging;
mod minutes;
mod recording;
mod revocation;

const TEST_SECRET: &str = "test-secret-0123456789abcdef0123456789";
const TEST_LOG_READ_TOKEN: &str = "log-read-token-0123456789abcdef0123456789";
const TEST_CAPTION_TOKEN: &str = "caption-token-0123456789abcdef0123456789";

struct TestServer {
    origin: String,
    task: JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(app: Router) -> TestServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    TestServer {
        origin: format!("http://{address}"),
        task,
    }
}

fn test_config(live777_url: &str) -> Config {
    Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: live777_url.to_string(),
        live777_token: "upstream-token".to_string(),
        log_read_token: None,
        caption_token: None,
        minutes_url: None,
        minutes_model: None,
        minutes_api_key: None,
        admin_user: None,
        admin_password: None,
        events_cable: false,
        data_file: PathBuf::from(":memory:"),
    }
}

async fn spawn_app_with_tokens(
    live777_url: &str,
    log_read_token: Option<&str>,
    caption_token: Option<&str>,
) -> (TestServer, AppState) {
    let cfg = Config {
        log_read_token: log_read_token.map(str::to_string),
        caption_token: caption_token.map(str::to_string),
        ..test_config(live777_url)
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let server = serve(router(state.clone())).await;
    (server, state)
}

async fn spawn_app(live777_url: &str) -> (TestServer, AppState) {
    spawn_app_with_tokens(
        live777_url,
        Some(TEST_LOG_READ_TOKEN),
        Some(TEST_CAPTION_TOKEN),
    )
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestUser {
    stream_id: String,
    token: String,
}

fn bearer(request: RequestBuilder, user: &TestUser) -> RequestBuilder {
    request.bearer_auth(&user.token)
}

async fn new_user(client: &reqwest::Client, server: &TestServer) -> TestUser {
    client
        .post(format!("{}/user/", server.origin))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn new_room(client: &reqwest::Client, server: &TestServer, owner: &TestUser) -> String {
    let response = bearer(client.post(format!("{}/room/", server.origin)), owner)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    response.json::<Value>().await.unwrap()["roomId"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn join(client: &reqwest::Client, server: &TestServer, room_id: &str, user: &TestUser) {
    let response = bearer(
        client.post(format!("{}/room/{room_id}/join", server.origin)),
        user,
    )
    .json(&json!({ "name": "test-user" }))
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
}

async fn response_text(response: reqwest::Response) -> String {
    response.text().await.unwrap()
}

#[tokio::test]
async fn active_membership_passwords_and_lobby_redaction_are_enforced() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let outsider = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;

    let response = bearer(
        client.patch(format!("{}/room/{room_id}", server.origin)),
        &owner,
    )
    .json(&json!({ "password": "room-password" }))
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    assert!(!response_text(response).await.contains("room-password"));
    join(&client, &server, &room_id, &owner).await;

    let presence = bearer(
        client.patch(format!("{}/room/{room_id}/presence", server.origin)),
        &outsider,
    )
    .json(&Presence::default())
    .send()
    .await
    .unwrap();
    assert_eq!(presence.status(), ReqwestStatus::FORBIDDEN);
    let message = bearer(
        client.post(format!("{}/room/{room_id}/message", server.origin)),
        &outsider,
    )
    .json(&json!({ "content": "not allowed" }))
    .send()
    .await
    .unwrap();
    assert_eq!(message.status(), ReqwestStatus::FORBIDDEN);
    let ticket = bearer(
        client.post(format!("{}/room/{room_id}/events/ticket", server.origin)),
        &outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ticket.status(), ReqwestStatus::FORBIDDEN);
    let events = bearer(
        client.get(format!("{}/room/{room_id}/events", server.origin)),
        &outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(events.status(), ReqwestStatus::FORBIDDEN);
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
    assert_eq!(lobby["meeting"], Value::Null);
    assert!(lobby["participants"].as_array().unwrap().is_empty());
    assert!(lobby.get("streamId").is_none());
    assert!(lobby.get("streams").is_none());
    let locked_join = bearer(
        client.post(format!("{}/room/{room_id}/join", server.origin)),
        &outsider,
    )
    .json(&json!({ "name": "outsider" }))
    .send()
    .await
    .unwrap();
    assert_eq!(locked_join.status(), ReqwestStatus::FORBIDDEN);

    let guest_join = bearer(
        client.post(format!("{}/room/{room_id}/join", server.origin)),
        &guest,
    )
    .json(&json!({ "name": "guest", "password": "room-password" }))
    .send()
    .await
    .unwrap();
    assert_eq!(guest_join.status(), ReqwestStatus::OK);
    let guest_join = guest_join.json::<Value>().await.unwrap();
    assert!(guest_join["meetingNo"].is_string());
    assert_eq!(guest_join["userId"], guest.stream_id);

    let changed_lock = bearer(
        client.patch(format!("{}/room/{room_id}", server.origin)),
        &owner,
    )
    .json(&json!({ "locked": true, "password": "new-password" }))
    .send()
    .await
    .unwrap();
    assert_eq!(changed_lock.status(), ReqwestStatus::OK);
    let active_rejoin = bearer(
        client.post(format!("{}/room/{room_id}/join", server.origin)),
        &guest,
    )
    .json(&json!({ "name": "guest" }))
    .send()
    .await
    .unwrap();
    assert_eq!(active_rejoin.status(), ReqwestStatus::OK);

    let guest_presence = bearer(
        client.patch(format!("{}/room/{room_id}/presence", server.origin)),
        &guest,
    )
    .json(&json!({ "name": "guest", "state": "connected", "audio": true }))
    .send()
    .await
    .unwrap();
    assert_eq!(guest_presence.status(), ReqwestStatus::NO_CONTENT);

    let foreign_whip = bearer(
        client.post(format!("{}/whip/{}", server.origin, guest.stream_id)),
        &outsider,
    )
    .body("sdp")
    .send()
    .await
    .unwrap();
    assert_eq!(foreign_whip.status(), ReqwestStatus::FORBIDDEN);
    let foreign_whep = bearer(
        client.get(format!("{}/whep/{}", server.origin, owner.stream_id)),
        &outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(foreign_whep.status(), ReqwestStatus::FORBIDDEN);

    let left = bearer(
        client.post(format!("{}/room/{room_id}/leave", server.origin)),
        &guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(left.status(), ReqwestStatus::NO_CONTENT);
    let rejected_presence = bearer(
        client.patch(format!("{}/room/{room_id}/presence", server.origin)),
        &guest,
    )
    .json(&Presence::default())
    .send()
    .await
    .unwrap();
    assert_eq!(rejected_presence.status(), ReqwestStatus::FORBIDDEN);
    let rejected_whip = bearer(
        client.post(format!("{}/whip/{}", server.origin, guest.stream_id)),
        &guest,
    )
    .body("sdp")
    .send()
    .await
    .unwrap();
    assert_eq!(rejected_whip.status(), ReqwestStatus::FORBIDDEN);

    let room = bearer(
        client.get(format!("{}/room/{room_id}", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert!(room["meeting"].is_object());
    assert!(room["participants"].is_array());
    assert!(room.get("streamId").is_none());
    assert!(room.get("streams").is_none());
    assert!(room.get("password").is_none());

    let old_post = bearer(
        client.post(format!("{}/room/{room_id}/stream", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(old_post.status(), ReqwestStatus::NOT_FOUND);
    let old_patch = bearer(
        client.patch(format!(
            "{}/room/{room_id}/stream/{}",
            server.origin, owner.stream_id
        )),
        &owner,
    )
    .json(&Presence::default())
    .send()
    .await
    .unwrap();
    assert_eq!(old_patch.status(), ReqwestStatus::NOT_FOUND);
    let old_delete = bearer(
        client.delete(format!(
            "{}/room/{room_id}/stream/{}",
            server.origin, owner.stream_id
        )),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(old_delete.status(), ReqwestStatus::NOT_FOUND);

    let old_query = client
        .get(format!(
            "{}/room/{room_id}/events?token={}",
            server.origin, owner.token
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(old_query.status(), ReqwestStatus::UNAUTHORIZED);
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    let after_end = bearer(
        client.post(format!("{}/whip/{}", server.origin, owner.stream_id)),
        &owner,
    )
    .body("sdp")
    .send()
    .await
    .unwrap();
    assert_eq!(after_end.status(), ReqwestStatus::FORBIDDEN);
}

async fn upstream(headers: HeaderMap, OriginalUri(uri): OriginalUri) -> Response {
    let value = |name: header::HeaderName| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let location =
        HeaderValue::from_str(&format!("http://upstream.invalid{}", uri.path())).unwrap();
    (
        StatusCode::CREATED,
        [(header::LOCATION, location)],
        Json(json!({
            "authorization": value(header::AUTHORIZATION),
            "ifMatch": value(header::IF_MATCH),
            "endToEnd": value(header::HeaderName::from_static("x-end-to-end")),
        })),
    )
        .into_response()
}

#[tokio::test]
async fn media_proxy_authorizes_nested_routes_and_preserves_headers() {
    let upstream_router = Router::new()
        .route("/whip/{uuid}/{*rest}", any(upstream))
        .route("/whep/{uuid}", any(upstream));
    let upstream = serve(upstream_router).await;
    let (server, _state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;

    let response = bearer(
        client.post(format!(
            "{}/whip/{}/session",
            server.origin, owner.stream_id
        )),
        &owner,
    )
    .header(header::IF_MATCH.as_str(), "\"etag\"")
    .header("x-end-to-end", "preserved")
    .body("sdp")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::CREATED);
    assert_eq!(
        response.headers()[header::LOCATION.as_str()],
        format!("/whip/{}/session", owner.stream_id)
    );
    let body = response.json::<Value>().await.unwrap();
    assert_eq!(body["authorization"], "Bearer upstream-token");
    assert_eq!(body["ifMatch"], "\"etag\"");
    assert_eq!(body["endToEnd"], "preserved");

    let outsider = new_user(&client, &server).await;
    let other_room = new_room(&client, &server, &outsider).await;
    join(&client, &server, &other_room, &outsider).await;
    let different_meeting = bearer(
        client.get(format!("{}/whep/{}", server.origin, owner.stream_id)),
        &outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(different_meeting.status(), ReqwestStatus::FORBIDDEN);
    let shared = bearer(
        client.get(format!("{}/whep/{}", server.origin, owner.stream_id)),
        &guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(shared.status(), ReqwestStatus::CREATED);
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
    let after_kick = bearer(
        client.get(format!("{}/whep/{}", server.origin, owner.stream_id)),
        &guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(after_kick.status(), ReqwestStatus::FORBIDDEN);
    let missing_auth = client
        .post(format!("{}/whip/{}", server.origin, owner.stream_id))
        .body("sdp")
        .send()
        .await
        .unwrap();
    assert_eq!(missing_auth.status(), ReqwestStatus::UNAUTHORIZED);
}

async fn session_upstream(headers: HeaderMap, OriginalUri(uri): OriginalUri) -> Response {
    let location = match uri.path() {
        path if path.starts_with("/whip/") => {
            "http://upstream.invalid/session/whip-session?resource=whip".to_string()
        }
        path if path.starts_with("/whep/") => "/session/whep-session?resource=whep".to_string(),
        path => format!("http://upstream.invalid{path}"),
    };
    (
        StatusCode::CREATED,
        [(header::LOCATION, HeaderValue::from_str(&location).unwrap())],
        Json(json!({
            "authorization": headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
            "resource": uri.path_and_query().map(|value| value.as_str()).unwrap_or(""),
        })),
    )
        .into_response()
}

#[tokio::test]
async fn media_sessions_preserve_location_and_enforce_binding_and_membership() {
    let upstream_router = Router::new()
        .route("/whip/{uuid}", any(session_upstream))
        .route("/whep/{uuid}", any(session_upstream))
        .route("/session/{*rest}", any(session_upstream));
    let upstream = serve(upstream_router).await;
    let (server, _state) = spawn_app(&upstream.origin).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let outsider = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    let other_room = new_room(&client, &server, &outsider).await;
    join(&client, &server, &other_room, &outsider).await;

    let initial = bearer(
        client.post(format!("{}/whip/{}", server.origin, owner.stream_id)),
        &owner,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(initial.status(), ReqwestStatus::CREATED);
    assert_eq!(
        initial.headers()[header::LOCATION.as_str()],
        "/session/whip-session?resource=whip"
    );
    initial.json::<Value>().await.unwrap();

    for user in [&guest, &outsider] {
        let rejected = bearer(
            client.patch(format!(
                "{}/session/whip-session?resource=whip",
                server.origin
            )),
            user,
        )
        .body("update")
        .send()
        .await
        .unwrap();
        assert_eq!(rejected.status(), ReqwestStatus::FORBIDDEN);
    }
    let anonymous = client
        .patch(format!(
            "{}/session/whip-session?resource=whip",
            server.origin
        ))
        .body("update")
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status(), ReqwestStatus::UNAUTHORIZED);
    let changed_query = bearer(
        client.patch(format!(
            "{}/session/whip-session?resource=other",
            server.origin
        )),
        &owner,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(changed_query.status(), ReqwestStatus::CREATED);
    assert_eq!(
        changed_query.json::<Value>().await.unwrap()["resource"],
        "/session/whip-session?resource=other"
    );

    let valid = bearer(
        client.patch(format!(
            "{}/session/whip-session?resource=whip",
            server.origin
        )),
        &owner,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(valid.status(), ReqwestStatus::CREATED);
    let valid = valid.json::<Value>().await.unwrap();
    assert_eq!(valid["authorization"], "Bearer upstream-token");
    assert_eq!(valid["resource"], "/session/whip-session?resource=whip");

    let deleted = bearer(
        client.delete(format!(
            "{}/session/whip-session?resource=whip",
            server.origin
        )),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(deleted.status(), ReqwestStatus::CREATED);
    deleted.json::<Value>().await.unwrap();
    let after_delete = bearer(
        client.patch(format!(
            "{}/session/whip-session?resource=whip",
            server.origin
        )),
        &owner,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(after_delete.status(), ReqwestStatus::FORBIDDEN);

    let initial = bearer(
        client.post(format!("{}/whep/{}", server.origin, owner.stream_id)),
        &guest,
    )
    .body("offer")
    .send()
    .await
    .unwrap();
    assert_eq!(initial.status(), ReqwestStatus::CREATED);
    assert_eq!(
        initial.headers()[header::LOCATION.as_str()],
        "/session/whep-session?resource=whep"
    );
    initial.json::<Value>().await.unwrap();
    let valid = bearer(
        client.patch(format!(
            "{}/session/whep-session?resource=whep",
            server.origin
        )),
        &guest,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(valid.status(), ReqwestStatus::CREATED);
    let other_user = bearer(
        client.patch(format!(
            "{}/session/whep-session?resource=whep",
            server.origin
        )),
        &owner,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(other_user.status(), ReqwestStatus::FORBIDDEN);

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
    let after_kick = bearer(
        client.patch(format!(
            "{}/session/whep-session?resource=whep",
            server.origin
        )),
        &guest,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(after_kick.status(), ReqwestStatus::FORBIDDEN);
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    let after_end = bearer(
        client.patch(format!(
            "{}/session/whip-session?resource=whip",
            server.origin
        )),
        &owner,
    )
    .body("update")
    .send()
    .await
    .unwrap();
    assert_eq!(after_end.status(), ReqwestStatus::FORBIDDEN);
}

#[tokio::test]
async fn proxy_response_body_errors_are_bad_gateway() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_address = listener.local_addr().unwrap();
    let upstream_task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        let _ = socket.read(&mut request).await.unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort")
            .await
            .unwrap();
    });
    let (server, _state) = spawn_app(&format!("http://{upstream_address}")).await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    let response = bearer(
        client.post(format!("{}/whip/{}", server.origin, owner.stream_id)),
        &owner,
    )
    .body("sdp")
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::BAD_GATEWAY);
    upstream_task.await.unwrap();
}

struct SseReader {
    response: reqwest::Response,
    buffer: String,
}

impl SseReader {
    fn new(response: reqwest::Response) -> Self {
        Self {
            response,
            buffer: String::new(),
        }
    }

    async fn next_event(&mut self) -> Result<Option<Value>, Box<dyn std::error::Error>> {
        loop {
            if let Some(end) = self.buffer.find("\n\n") {
                let block = self.buffer.drain(..end + 2).collect::<String>();
                let data = block
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:"))
                    .map(str::trim)
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                return Ok(Some(serde_json::from_str(&data)?));
            }
            let chunk =
                tokio::time::timeout(Duration::from_secs(5), self.response.chunk()).await??;
            let Some(chunk) = chunk else {
                return Ok(None);
            };
            self.buffer.push_str(std::str::from_utf8(&chunk)?);
        }
    }
}

#[tokio::test]
async fn sse_uses_tickets_revisions_lag_recovery_and_final_close() {
    let (server, state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    let other_room = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;

    let ticket = bearer(
        client.post(format!("{}/room/{room_id}/events/ticket", server.origin)),
        &guest,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    let ticket_value = ticket["ticket"].as_str().unwrap();
    assert!(ticket["expiresAt"].as_i64().unwrap() > crate::store::now_secs());
    let wrong_room = client
        .get(format!(
            "{}/room/{other_room}/events?ticket={ticket_value}",
            server.origin
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_room.status(), ReqwestStatus::UNAUTHORIZED);

    let response = client
        .get(format!(
            "{}/room/{room_id}/events?ticket={ticket_value}",
            server.origin
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    let mut events = SseReader::new(response);
    let initial = events.next_event().await.unwrap().unwrap();
    assert_eq!(initial["type"], "snapshot");
    let initial_revision = initial["revision"].as_u64().unwrap();

    let duplicate = state.store.snapshot(&room_id).await.unwrap();
    state.bus.publish(RoomEvent::snapshot(&room_id, duplicate));
    let message = bearer(
        client.post(format!("{}/room/{room_id}/message", server.origin)),
        &owner,
    )
    .json(&json!({ "content": "hello" }))
    .send()
    .await
    .unwrap();
    assert_eq!(message.status(), ReqwestStatus::CREATED);
    let message = events.next_event().await.unwrap().unwrap();
    assert_eq!(message["type"], "message");
    let revision = message["revision"].as_u64().unwrap();
    assert!(revision > initial_revision);

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
    let final_snapshot = events.next_event().await.unwrap().unwrap();
    assert_eq!(final_snapshot["type"], "snapshot");
    let guest_participant = final_snapshot["participants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|participant| participant["userId"] == guest.stream_id)
        .unwrap();
    assert!(guest_participant["leaveAt"].is_number());
    assert!(events.next_event().await.unwrap().is_none());

    let owner_response = bearer(
        client.get(format!("{}/room/{room_id}/events", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(owner_response.status(), ReqwestStatus::OK);
    let mut owner_events = SseReader::new(owner_response);
    assert_eq!(
        owner_events.next_event().await.unwrap().unwrap()["type"],
        "snapshot"
    );
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    let final_snapshot = owner_events.next_event().await.unwrap().unwrap();
    assert_eq!(final_snapshot["type"], "snapshot");
    assert!(final_snapshot["meetingNo"].is_null());
    assert!(owner_events.next_event().await.unwrap().is_none());
}

#[tokio::test]
async fn event_stream_recovers_a_full_snapshot_after_lag() {
    let cfg = Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: "http://127.0.0.1:9".to_string(),
        live777_token: String::new(),
        log_read_token: None,
        caption_token: None,
        minutes_url: None,
        minutes_model: None,
        minutes_api_key: None,
        admin_user: None,
        admin_password: None,
        events_cable: false,
        data_file: PathBuf::from(":memory:"),
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let room_id = state.store.create_room("owner").await.unwrap().room_id;
    state
        .store
        .join(&room_id, "owner", None, None)
        .await
        .unwrap();
    let snapshot = state.store.snapshot(&room_id).await.unwrap();
    let revision = snapshot.revision;
    let (sender, receiver) = tokio::sync::broadcast::channel(1);
    let mut stream = RoomEventStream {
        receiver: BroadcastStream::new(receiver),
        state,
        room_id: room_id.clone(),
        user_id: "owner".to_string(),
        initial: None,
        last_revision: revision,
        lagged_snapshot: None,
        done: false,
    };
    for index in 0..2 {
        let message = Message {
            id: format!("synthetic-{index}"),
            user_id: "owner".to_string(),
            name: "owner".to_string(),
            content: "lag".to_string(),
            ts: crate::store::now_secs(),
        };
        sender
            .send(RoomEvent::message(&room_id, revision + index + 1, message))
            .unwrap();
    }

    let recovered = stream.next().await.unwrap();
    let recovered = recovered.snapshot_ref().unwrap();
    assert_eq!(recovered.kind, "snapshot");
    assert_eq!(recovered.revision, revision);
    assert!(recovered.is_active("owner"));
}

#[tokio::test]
async fn spa_and_client_log_boundaries_are_enforced() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let navigation = client
        .get(format!("{}/123-456-789", server.origin))
        .header(header::ACCEPT.as_str(), "text/html,application/xhtml+xml")
        .send()
        .await
        .unwrap();
    assert_eq!(navigation.status(), ReqwestStatus::OK);
    for path in [
        "/missing.js",
        "/api/missing",
        "/room/missing/unknown",
        "/log/missing",
    ] {
        let response = client
            .get(format!("{}{}", server.origin, path))
            .header(header::ACCEPT.as_str(), "text/html")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), ReqwestStatus::NOT_FOUND, "{path}");
    }
    let protected_session = client
        .get(format!("{}/session/missing", server.origin))
        .header(header::ACCEPT.as_str(), "text/html")
        .send()
        .await
        .unwrap();
    assert_eq!(protected_session.status(), ReqwestStatus::UNAUTHORIZED);
    let non_html = client
        .get(format!("{}/123-456-789", server.origin))
        .header(header::ACCEPT.as_str(), "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(non_html.status(), ReqwestStatus::NOT_FOUND);

    let valid_log = client
        .post(format!("{}/log", server.origin))
        .json(&json!({
            "sessionId": "session",
            "logs": [{ "event": "test", "data": { "token": "do-not-log" } }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(valid_log.status(), ReqwestStatus::NO_CONTENT);
    let oversized = client
        .post(format!("{}/log", server.origin))
        .header(header::CONTENT_TYPE.as_str(), "application/json")
        .body(format!(
            "{{\"logs\":[],\"padding\":\"{}\"}}",
            "x".repeat(70 * 1024)
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(oversized.status(), ReqwestStatus::PAYLOAD_TOO_LARGE);
}

// ---------- captions ----------

async fn post_caption(
    client: &reqwest::Client,
    server: &TestServer,
    room_id: &str,
    body: Value,
) -> reqwest::Response {
    client
        .post(format!("{}/room/{room_id}/caption", server.origin))
        .bearer_auth(TEST_CAPTION_TOKEN)
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn get_caption_streams(client: &reqwest::Client, server: &TestServer) -> reqwest::Response {
    client
        .get(format!("{}/caption/streams", server.origin))
        .bearer_auth(TEST_CAPTION_TOKEN)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn caption_endpoints_require_a_configured_static_token() {
    let client = reqwest::Client::new();
    let (disabled, _state) = spawn_app_with_tokens("http://127.0.0.1:9", None, None).await;
    for token in [None, Some(TEST_CAPTION_TOKEN)] {
        let post = client.post(format!("{}/room/123-456-789/caption", disabled.origin));
        let post = match token {
            Some(token) => post.bearer_auth(token),
            None => post,
        };
        let post = post
            .json(&json!({ "userId": "user", "text": "hello" }))
            .send()
            .await
            .unwrap();
        assert_eq!(post.status(), ReqwestStatus::NOT_FOUND);
        let get = client.get(format!("{}/caption/streams", disabled.origin));
        let get = match token {
            Some(token) => get.bearer_auth(token),
            None => get,
        };
        assert_eq!(get.send().await.unwrap().status(), ReqwestStatus::NOT_FOUND);
    }

    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let user = new_user(&client, &server).await;
    for token in [None, Some("wrong-token"), Some(user.token.as_str())] {
        let post = client.post(format!("{}/room/123-456-789/caption", server.origin));
        let post = match token {
            Some(token) => post.bearer_auth(token),
            None => post,
        };
        let post = post
            .json(&json!({ "userId": "user", "text": "hello" }))
            .send()
            .await
            .unwrap();
        assert_eq!(post.status(), ReqwestStatus::UNAUTHORIZED);
        assert!(response_text(post).await.contains("invalid caption token"));
        let get = client.get(format!("{}/caption/streams", server.origin));
        let get = match token {
            Some(token) => get.bearer_auth(token),
            None => get,
        };
        assert_eq!(
            get.send().await.unwrap().status(),
            ReqwestStatus::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn caption_is_broadcast_with_server_filled_name_and_timestamp() {
    let (server, state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    let mut events = state.bus.subscribe(&room_id);

    let before = crate::store::now_secs();
    let response = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id, "text": "  hello world  ", "isFinal": true }),
    )
    .await;
    assert_eq!(response.status(), ReqwestStatus::CREATED);
    let caption = response.json::<Value>().await.unwrap();
    let caption_id = caption["id"].as_str().unwrap().to_string();
    assert!(!caption_id.is_empty());
    assert_eq!(caption["userId"], owner.stream_id);
    assert_eq!(caption["name"], "test-user");
    assert_eq!(caption["text"], "hello world");
    assert_eq!(caption["isFinal"], true);
    let ts = caption["ts"].as_i64().unwrap();
    assert!(ts >= before && ts <= crate::store::now_secs());

    let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event.room_id, room_id);
    assert!(event.snapshot_ref().is_none());
    let payload: Value = serde_json::from_str(&event.payload_json()).unwrap();
    assert_eq!(payload["type"], "caption");
    assert_eq!(payload["revision"], event.revision);
    assert!(payload["revision"].as_u64().unwrap() > 0);
    assert_eq!(payload["caption"]["id"], caption_id);
    assert_eq!(payload["caption"]["text"], "hello world");
    assert_eq!(payload["caption"]["isFinal"], true);
}

#[tokio::test]
async fn caption_validation_and_store_errors_are_mapped() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let outsider = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;

    let no_meeting = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id, "text": "hello" }),
    )
    .await;
    assert_eq!(no_meeting.status(), ReqwestStatus::NOT_FOUND);
    let unknown = post_caption(
        &client,
        &server,
        "000-000-000",
        json!({ "userId": owner.stream_id, "text": "hello" }),
    )
    .await;
    assert_eq!(unknown.status(), ReqwestStatus::NOT_FOUND);

    join(&client, &server, &room_id, &owner).await;

    let blank_text = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id, "text": "   " }),
    )
    .await;
    assert_eq!(blank_text.status(), ReqwestStatus::BAD_REQUEST);
    assert!(response_text(blank_text).await.contains("empty caption"));
    let missing_text = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id }),
    )
    .await;
    assert_eq!(missing_text.status(), ReqwestStatus::BAD_REQUEST);
    for body in [
        json!({ "text": "hello" }),
        json!({ "userId": "  ", "text": "hello" }),
    ] {
        let response = post_caption(&client, &server, &room_id, body).await;
        assert_eq!(response.status(), ReqwestStatus::BAD_REQUEST);
    }
    let not_participant = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": outsider.stream_id, "text": "hello" }),
    )
    .await;
    assert_eq!(not_participant.status(), ReqwestStatus::FORBIDDEN);
}

#[tokio::test]
async fn caption_ids_pass_through_for_partial_updates_and_fields_are_capped() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;

    let first = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "id": "segment-1", "userId": owner.stream_id, "text": "partial" }),
    )
    .await;
    assert_eq!(first.status(), ReqwestStatus::CREATED);
    let second = post_caption(
        &client,
        &server,
        &room_id,
        json!({
            "id": "segment-1",
            "userId": owner.stream_id,
            "text": "partial updated",
            "isFinal": true,
        }),
    )
    .await;
    assert_eq!(second.status(), ReqwestStatus::CREATED);
    let first = first.json::<Value>().await.unwrap();
    let second = second.json::<Value>().await.unwrap();
    assert_eq!(first["id"], "segment-1");
    assert_eq!(second["id"], "segment-1");
    assert_eq!(second["text"], "partial updated");
    assert_eq!(second["isFinal"], true);

    let generated_a = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id, "text": "a" }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let generated_b = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "id": "", "userId": owner.stream_id, "text": "b" }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    assert!(!generated_a["id"].as_str().unwrap().is_empty());
    assert!(!generated_b["id"].as_str().unwrap().is_empty());
    assert_ne!(generated_a["id"], generated_b["id"]);

    let capped = post_caption(
        &client,
        &server,
        &room_id,
        json!({
            "id": "i".repeat(80),
            "userId": owner.stream_id,
            "text": "t".repeat(600),
        }),
    )
    .await;
    assert_eq!(capped.status(), ReqwestStatus::CREATED);
    let capped = capped.json::<Value>().await.unwrap();
    assert_eq!(capped["id"].as_str().unwrap().len(), 64);
    assert_eq!(capped["text"].as_str().unwrap().chars().count(), 500);
}

#[tokio::test]
async fn caption_streams_lists_audio_speakers_for_rooms_with_meetings() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let other = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    let other_room = new_room(&client, &server, &other).await;
    let lobby_room = new_room(&client, &server, &owner).await;

    let response = get_caption_streams(&client, &server).await;
    assert_eq!(response.status(), ReqwestStatus::OK);
    let body = response.json::<Value>().await.unwrap();
    assert!(body["rooms"].as_array().unwrap().is_empty());

    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;
    join(&client, &server, &other_room, &other).await;
    for (user, presence) in [
        (
            &owner,
            json!({ "name": "owner", "state": "connected", "audio": true }),
        ),
        (
            &guest,
            json!({ "name": "guest", "state": "connected", "video": true }),
        ),
    ] {
        let response = bearer(
            client.patch(format!("{}/room/{room_id}/presence", server.origin)),
            user,
        )
        .json(&presence)
        .send()
        .await
        .unwrap();
        assert_eq!(response.status(), ReqwestStatus::NO_CONTENT);
    }

    let response = get_caption_streams(&client, &server).await;
    assert_eq!(response.status(), ReqwestStatus::OK);
    let body = response.json::<Value>().await.unwrap();
    let rooms = body["rooms"].as_array().unwrap();
    assert_eq!(rooms.len(), 2);
    let room = rooms.iter().find(|room| room["roomId"] == room_id).unwrap();
    let speakers = room["speakers"].as_array().unwrap();
    assert_eq!(speakers.len(), 1);
    assert_eq!(speakers[0]["userId"], owner.stream_id);
    assert_eq!(speakers[0]["name"], "test-user");
    let quiet = rooms
        .iter()
        .find(|room| room["roomId"] == other_room)
        .unwrap();
    assert!(quiet["speakers"].as_array().unwrap().is_empty());
    assert!(rooms.iter().all(|room| room["roomId"] != lobby_room));
}

#[tokio::test]
async fn final_captions_are_archived_and_served_by_records_endpoints() {
    let (server, state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let owner = new_user(&client, &server).await;
    let guest = new_user(&client, &server).await;
    let room_id = new_room(&client, &server, &owner).await;
    join(&client, &server, &room_id, &owner).await;
    join(&client, &server, &room_id, &guest).await;

    let partial = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "userId": owner.stream_id, "text": "draft", "isFinal": false }),
    )
    .await;
    assert_eq!(partial.status(), ReqwestStatus::CREATED);
    let final_segment = post_caption(
        &client,
        &server,
        &room_id,
        json!({ "id": "seg-1", "userId": owner.stream_id, "text": "final words", "isFinal": true }),
    )
    .await;
    assert_eq!(final_segment.status(), ReqwestStatus::CREATED);

    let snapshot = serde_json::to_value(state.store.snapshot(&room_id).await.unwrap()).unwrap();
    assert!(snapshot.get("captions").is_none());

    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);

    let room_records = bearer(
        client.get(format!("{}/room/{room_id}/records", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    let captions = room_records[0]["captions"].as_array().unwrap();
    assert_eq!(captions.len(), 1);
    assert_eq!(captions[0]["id"], "seg-1");
    assert_eq!(captions[0]["userId"], owner.stream_id);
    assert_eq!(captions[0]["name"], "test-user");
    assert_eq!(captions[0]["text"], "final words");
    assert_eq!(captions[0]["isFinal"], true);
    assert!(captions[0]["ts"].is_number());

    let user_records = bearer(
        client.get(format!("{}/user/records", server.origin)),
        &guest,
    )
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(user_records.as_array().unwrap().len(), 1);
    let captions = user_records[0]["captions"].as_array().unwrap();
    assert_eq!(captions.len(), 1);
    assert_eq!(captions[0]["text"], "final words");
}
