use std::sync::{Arc, Mutex};

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};

use super::*;

const TEST_MINUTES_MODEL: &str = "test-model";
const TEST_MINUTES_API_KEY: &str = "minutes-api-key";
const MINUTES_MARKDOWN: &str = "## 纪要";

#[derive(Clone, Default)]
struct MockMinutes {
    requests: Arc<Mutex<Vec<(String, Value)>>>,
    status: StatusCode,
}

async fn mock_chat_completions(
    State(mock): State<MockMinutes>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    mock.requests.lock().unwrap().push((authorization, body));
    if mock.status != StatusCode::OK {
        return mock.status.into_response();
    }
    Json(json!({
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": MINUTES_MARKDOWN },
        }]
    }))
    .into_response()
}

async fn spawn_minutes_upstream(status: StatusCode) -> (TestServer, MockMinutes) {
    let mock = MockMinutes {
        status,
        ..MockMinutes::default()
    };
    let app = Router::new()
        .route("/v1/chat/completions", post(mock_chat_completions))
        .with_state(mock.clone());
    (serve(app).await, mock)
}

async fn spawn_app_with_minutes(minutes_url: Option<&str>) -> (TestServer, AppState) {
    let cfg = Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: "http://127.0.0.1:9".to_string(),
        live777_token: "upstream-token".to_string(),
        log_read_token: None,
        caption_token: Some(TEST_CAPTION_TOKEN.to_string()),
        minutes_url: minutes_url.map(str::to_string),
        minutes_model: minutes_url.map(|_| TEST_MINUTES_MODEL.to_string()),
        minutes_api_key: minutes_url.map(|_| TEST_MINUTES_API_KEY.to_string()),
        data_file: PathBuf::from(":memory:"),
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let server = serve(router(state.clone())).await;
    (server, state)
}

struct ArchivedMeeting {
    owner: TestUser,
    guest: TestUser,
    outsider: TestUser,
    room_id: String,
    meeting_no: String,
}

async fn archived_meeting(
    client: &reqwest::Client,
    server: &TestServer,
    with_captions: bool,
) -> ArchivedMeeting {
    let owner = new_user(client, server).await;
    let guest = new_user(client, server).await;
    let outsider = new_user(client, server).await;
    let room_id = new_room(client, server, &owner).await;
    let meeting_no = bearer(
        client.post(format!("{}/room/{room_id}/join", server.origin)),
        &owner,
    )
    .json(&json!({ "name": "owner-name" }))
    .send()
    .await
    .unwrap()
    .json::<Value>()
    .await
    .unwrap()["meetingNo"]
        .as_str()
        .unwrap()
        .to_string();
    join(client, server, &room_id, &guest).await;
    if with_captions {
        for (user_id, text, is_final) in [
            (owner.stream_id.as_str(), "draft in progress", false),
            (owner.stream_id.as_str(), "hello world", true),
            (guest.stream_id.as_str(), "second speaker", true),
        ] {
            let caption = post_caption(
                client,
                server,
                &room_id,
                json!({ "userId": user_id, "text": text, "isFinal": is_final }),
            )
            .await;
            assert_eq!(caption.status(), ReqwestStatus::CREATED);
        }
    }
    let ended = bearer(
        client.post(format!("{}/room/{room_id}/end", server.origin)),
        &owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(ended.status(), ReqwestStatus::NO_CONTENT);
    ArchivedMeeting {
        owner,
        guest,
        outsider,
        room_id,
        meeting_no,
    }
}

fn post_minutes(
    client: &reqwest::Client,
    server: &TestServer,
    room_id: &str,
    meeting_no: &str,
) -> RequestBuilder {
    client.post(format!(
        "{}/room/{room_id}/records/{meeting_no}/minutes",
        server.origin
    ))
}

#[tokio::test]
async fn minutes_is_not_found_without_configuration_or_token() {
    let client = reqwest::Client::new();
    let (disabled, _state) = spawn_app_with_minutes(None).await;
    let meeting = archived_meeting(&client, &disabled, true).await;
    let response = bearer(
        post_minutes(&client, &disabled, &meeting.room_id, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::NOT_FOUND);

    let (server, _state) = spawn_app_with_minutes(Some("http://127.0.0.1:9/v1")).await;
    let meeting = archived_meeting(&client, &server, true).await;
    let anonymous = post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no)
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status(), ReqwestStatus::UNAUTHORIZED);
    let wrong_token = post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no)
        .bearer_auth(TEST_CAPTION_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_token.status(), ReqwestStatus::UNAUTHORIZED);
}

#[tokio::test]
async fn minutes_requires_an_owner_or_record_participant() {
    let (upstream, _mock) = spawn_minutes_upstream(StatusCode::OK).await;
    let (server, _state) = spawn_app_with_minutes(Some(&format!("{}/v1", upstream.origin))).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, true).await;

    let outsider = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.outsider,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(outsider.status(), ReqwestStatus::FORBIDDEN);
    let guest = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.guest,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(guest.status(), ReqwestStatus::OK);
}

#[tokio::test]
async fn minutes_unknown_room_or_meeting_is_not_found() {
    let (upstream, _mock) = spawn_minutes_upstream(StatusCode::OK).await;
    let (server, _state) = spawn_app_with_minutes(Some(&format!("{}/v1", upstream.origin))).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, true).await;

    let unknown_room = bearer(
        post_minutes(&client, &server, "000-000-000", &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(unknown_room.status(), ReqwestStatus::NOT_FOUND);
    let unknown_meeting = bearer(
        post_minutes(&client, &server, &meeting.room_id, "no-such-meeting"),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(unknown_meeting.status(), ReqwestStatus::NOT_FOUND);
    let empty_room = new_room(&client, &server, &meeting.owner).await;
    let no_record = bearer(
        post_minutes(&client, &server, &empty_room, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(no_record.status(), ReqwestStatus::NOT_FOUND);
}

#[tokio::test]
async fn minutes_without_a_transcript_is_bad_request() {
    let (upstream, _mock) = spawn_minutes_upstream(StatusCode::OK).await;
    let (server, _state) = spawn_app_with_minutes(Some(&format!("{}/v1", upstream.origin))).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, false).await;
    let response = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::BAD_REQUEST);
    assert!(response_text(response).await.contains("no transcript"));
}

#[tokio::test]
async fn minutes_returns_markdown_and_sends_the_final_transcript() {
    let (upstream, mock) = spawn_minutes_upstream(StatusCode::OK).await;
    let (server, _state) = spawn_app_with_minutes(Some(&format!("{}/v1", upstream.origin))).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, true).await;

    let response = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    let body = response.json::<Value>().await.unwrap();
    assert_eq!(body["minutes"], MINUTES_MARKDOWN);

    let requests = mock.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let (authorization, body) = &requests[0];
    assert_eq!(authorization, &format!("Bearer {TEST_MINUTES_API_KEY}"));
    assert_eq!(body["model"], TEST_MINUTES_MODEL);
    assert_eq!(body["stream"], false);
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "system");
    assert!(messages[0]["content"]
        .as_str()
        .unwrap()
        .contains("Markdown"));
    assert_eq!(messages[1]["role"], "user");
    let transcript = messages[1]["content"].as_str().unwrap();
    assert!(transcript.contains("owner-name: hello world"));
    assert!(transcript.contains("test-user: second speaker"));
    assert!(!transcript.contains("draft in progress"));
}

#[tokio::test]
async fn minutes_upstream_errors_are_bad_gateway() {
    let (server, _state) = spawn_app_with_minutes(Some("http://127.0.0.1:9/v1")).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, true).await;
    let unreachable = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(unreachable.status(), ReqwestStatus::BAD_GATEWAY);
    assert!(response_text(unreachable)
        .await
        .contains("minutes upstream error"));

    let (upstream, _mock) = spawn_minutes_upstream(StatusCode::INTERNAL_SERVER_ERROR).await;
    let (server, _state) = spawn_app_with_minutes(Some(&format!("{}/v1", upstream.origin))).await;
    let meeting = archived_meeting(&client, &server, true).await;
    let failed = bearer(
        post_minutes(&client, &server, &meeting.room_id, &meeting.meeting_no),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(failed.status(), ReqwestStatus::BAD_GATEWAY);
    assert!(response_text(failed)
        .await
        .contains("minutes upstream error"));
}
