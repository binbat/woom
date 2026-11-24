use std::sync::Arc;

use serde_json::{json, Value};

use super::minutes::{archived_meeting, spawn_minutes_upstream, MINUTES_MARKDOWN};
use super::*;

pub(super) const TEST_ADMIN_USER: &str = "admin";
pub(super) const TEST_ADMIN_PASSWORD: &str = "admin-password-0123456789";

async fn spawn_admin_app(minutes_url: Option<&str>) -> (TestServer, AppState) {
    let cfg = Config {
        secret: TEST_SECRET.to_string(),
        port: "0".to_string(),
        live777_url: "http://127.0.0.1:9".to_string(),
        live777_token: "upstream-token".to_string(),
        log_read_token: None,
        caption_token: Some(TEST_CAPTION_TOKEN.to_string()),
        minutes_url: minutes_url.map(str::to_string),
        minutes_model: minutes_url.map(|_| "test-model".to_string()),
        minutes_api_key: minutes_url.map(|_| "minutes-api-key".to_string()),
        admin_user: Some(TEST_ADMIN_USER.to_string()),
        admin_password: Some(TEST_ADMIN_PASSWORD.to_string()),
        events_cable: false,
        data_file: PathBuf::from(":memory:"),
    };
    let state = AppState::new(Arc::new(Store::memory()), crate::events::new_bus(), cfg);
    let server = serve(router(state.clone())).await;
    (server, state)
}

pub(super) async fn admin_login_token(client: &reqwest::Client, server: &TestServer) -> String {
    let response = client
        .post(format!("{}/api/admin/login", server.origin))
        .json(&json!({ "username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    let body = response.json::<Value>().await.unwrap();
    assert!(body["expiresAt"].is_number());
    body["token"].as_str().unwrap().to_string()
}

fn admin_records_request(client: &reqwest::Client, server: &TestServer) -> RequestBuilder {
    client.get(format!("{}/api/admin/records", server.origin))
}

#[tokio::test]
async fn admin_api_is_not_found_without_configuration() {
    let client = reqwest::Client::new();
    let (server, _state) = spawn_app_with_tokens("http://127.0.0.1:9", None, None).await;
    let login = client
        .post(format!("{}/api/admin/login", server.origin))
        .json(&json!({ "username": "admin", "password": "whatever" }))
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), ReqwestStatus::NOT_FOUND);
    let records = admin_records_request(&client, &server)
        .send()
        .await
        .unwrap();
    assert_eq!(records.status(), ReqwestStatus::NOT_FOUND);
}

#[tokio::test]
async fn admin_login_issues_a_token_that_only_unlocks_admin_routes() {
    let client = reqwest::Client::new();
    let (server, _state) = spawn_admin_app(None).await;

    for body in [
        json!({}),
        json!({ "username": TEST_ADMIN_USER, "password": "wrong-password" }),
        json!({ "username": "nobody", "password": TEST_ADMIN_PASSWORD }),
    ] {
        let response = client
            .post(format!("{}/api/admin/login", server.origin))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), ReqwestStatus::UNAUTHORIZED);
    }

    let token = admin_login_token(&client, &server).await;
    let records = admin_records_request(&client, &server)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(records.status(), ReqwestStatus::OK);
    assert_eq!(records.json::<Value>().await.unwrap(), json!([]));

    // Neither an anonymous caller nor a regular user JWT passes admin auth.
    let user = new_user(&client, &server).await;
    for token in [None, Some("wrong-token"), Some(user.token.as_str())] {
        let request = admin_records_request(&client, &server);
        let request = match token {
            Some(token) => request.bearer_auth(token),
            None => request,
        };
        assert_eq!(
            request.send().await.unwrap().status(),
            ReqwestStatus::UNAUTHORIZED
        );
    }

    // The admin token is not a user token either.
    let user_route = client
        .get(format!("{}/user/records", server.origin))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(user_route.status(), ReqwestStatus::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_lists_views_and_deletes_records() {
    let client = reqwest::Client::new();
    let (server, _state) = spawn_admin_app(None).await;
    let meeting = archived_meeting(&client, &server, true).await;
    let token = admin_login_token(&client, &server).await;

    // The room still exists, so its current topic is joined into the summary.
    let patched = bearer(
        client.patch(format!("{}/room/{}", server.origin, meeting.room_id)),
        &meeting.owner,
    )
    .json(&json!({ "topic": "weekly standup" }))
    .send()
    .await
    .unwrap();
    assert_eq!(patched.status(), ReqwestStatus::OK);

    let summaries = admin_records_request(&client, &server)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    let summaries = summaries.as_array().unwrap();
    assert_eq!(summaries.len(), 1);
    let summary = &summaries[0];
    assert_eq!(summary["meetingNo"], meeting.meeting_no);
    assert_eq!(summary["roomId"], meeting.room_id);
    assert_eq!(summary["roomTopic"], "weekly standup");
    assert_eq!(summary["participantCount"], 2);
    assert_eq!(summary["messageCount"], 0);
    assert_eq!(summary["captionCount"], 2);
    assert_eq!(summary["hasMinutes"], false);
    assert_eq!(summary["hasPolishedTranscript"], false);
    assert!(summaries[0].get("captions").is_none());

    let detail = client
        .get(format!(
            "{}/api/admin/records/{}",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(detail.status(), ReqwestStatus::OK);
    let detail = detail.json::<Value>().await.unwrap();
    assert_eq!(detail["meetingNo"], meeting.meeting_no);
    assert_eq!(detail["captions"].as_array().unwrap().len(), 2);
    assert_eq!(detail["captions"][0]["text"], "hello world");
    assert_eq!(detail["participants"].as_array().unwrap().len(), 2);
    assert_eq!(detail["minutes"], "");

    let missing = client
        .get(format!(
            "{}/api/admin/records/no-such-meeting",
            server.origin
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), ReqwestStatus::NOT_FOUND);

    let deleted = client
        .delete(format!(
            "{}/api/admin/records/{}",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), ReqwestStatus::NO_CONTENT);
    let summaries = admin_records_request(&client, &server)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(summaries, json!([]));
    let detail = client
        .get(format!(
            "{}/api/admin/records/{}",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(detail.status(), ReqwestStatus::NOT_FOUND);
    let deleted_again = client
        .delete(format!(
            "{}/api/admin/records/{}",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(deleted_again.status(), ReqwestStatus::NOT_FOUND);

    // The deletion is visible through the user-facing records API as well.
    let room_records = bearer(
        client.get(format!(
            "{}/room/{}/records",
            server.origin, meeting.room_id
        )),
        &meeting.owner,
    )
    .send()
    .await
    .unwrap();
    assert_eq!(room_records.status(), ReqwestStatus::OK);
    assert_eq!(room_records.json::<Value>().await.unwrap(), json!([]));
}

#[tokio::test]
async fn admin_generates_minutes_for_any_record() {
    let (upstream, mock) = spawn_minutes_upstream(StatusCode::OK).await;
    let (server, _state) = spawn_admin_app(Some(&format!("{}/v1", upstream.origin))).await;
    let client = reqwest::Client::new();
    let meeting = archived_meeting(&client, &server, true).await;
    let token = admin_login_token(&client, &server).await;

    // The admin is neither the room owner nor a meeting participant.
    let minutes = client
        .post(format!(
            "{}/api/admin/records/{}/minutes",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(minutes.status(), ReqwestStatus::OK);
    let body = minutes.json::<Value>().await.unwrap();
    assert_eq!(body["minutes"], MINUTES_MARKDOWN);
    assert_eq!(body["cached"], false);

    let cached = client
        .post(format!(
            "{}/api/admin/records/{}/minutes",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(cached["cached"], true);
    assert_eq!(mock.requests.lock().unwrap().len(), 1);

    let forced = client
        .post(format!(
            "{}/api/admin/records/{}/minutes?force=true",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(forced["cached"], false);
    assert_eq!(mock.requests.lock().unwrap().len(), 2);

    // The artifact is visible on the admin detail and summary afterwards.
    let detail = client
        .get(format!(
            "{}/api/admin/records/{}",
            server.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(detail["minutes"], MINUTES_MARKDOWN);
    let summaries = admin_records_request(&client, &server)
        .bearer_auth(&token)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(summaries[0]["hasMinutes"], true);

    let missing = client
        .post(format!(
            "{}/api/admin/records/no-such-meeting/minutes",
            server.origin
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), ReqwestStatus::NOT_FOUND);

    // Without MINUTES_URL the admin minutes endpoint is disabled as well.
    let (disabled, _state) = spawn_admin_app(None).await;
    let meeting = archived_meeting(&client, &disabled, true).await;
    let token = admin_login_token(&client, &disabled).await;
    let response = client
        .post(format!(
            "{}/api/admin/records/{}/minutes",
            disabled.origin, meeting.meeting_no
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::NOT_FOUND);
}
