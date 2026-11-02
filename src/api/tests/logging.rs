use serde_json::{json, Value};

use super::*;

async fn post_logs(client: &reqwest::Client, server: &TestServer, batch: Value) {
    let response = client
        .post(format!("{}/log", server.origin))
        .json(&batch)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::NO_CONTENT);
}

#[tokio::test]
async fn log_read_token_can_be_disabled_and_is_independent_of_user_jwt() {
    let client = reqwest::Client::new();
    let (disabled, _state) = spawn_app_with_log_token("http://127.0.0.1:9", None).await;
    for token in [None, Some(TEST_LOG_READ_TOKEN)] {
        let request = client.get(format!("{}/log", disabled.origin));
        let request = match token {
            Some(token) => request.bearer_auth(token),
            None => request,
        };
        assert_eq!(
            request.send().await.unwrap().status(),
            ReqwestStatus::NOT_FOUND
        );
    }

    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let user = new_user(&client, &server).await;
    for token in [None, Some("wrong-token"), Some(user.token.as_str())] {
        let request = client.get(format!("{}/log", server.origin));
        let request = match token {
            Some(token) => request.bearer_auth(token),
            None => request,
        };
        assert_eq!(
            request.send().await.unwrap().status(),
            ReqwestStatus::UNAUTHORIZED
        );
    }
    let response = client
        .get(format!("{}/log", server.origin))
        .bearer_auth(TEST_LOG_READ_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE.as_str()],
        "application/x-ndjson"
    );
    assert!(response.text().await.unwrap().is_empty());
}

#[tokio::test]
async fn log_export_filters_recent_records_and_returns_sanitized_ndjson() {
    let (server, _state) = spawn_app("http://127.0.0.1:9").await;
    let client = reqwest::Client::new();
    let since = crate::store::now_millis();
    post_logs(
        &client,
        &server,
        json!({
            "sessionId": "session-1",
            "meetingId": "meeting-1",
            "url": "https://example.test/room?token=url-secret&ticket=url-ticket&ok=1",
            "userAgent": "test-agent Bearer agent-secret",
            "logs": [{
                "ts": 1,
                "level": "info",
                "event": "first",
                "msg": "first message"
            }]
        }),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(2)).await;
    post_logs(
        &client,
        &server,
        json!({
            "sessionId": "session-1",
            "meetingId": "meeting-1",
            "url": "https://example.test/room?token=url-secret&ticket=url-ticket&ok=1",
            "userAgent": "test-agent Bearer agent-secret",
            "logs": [
                {
                    "ts": 2,
                    "level": "error",
                    "event": "second",
                    "msg": "second message"
                },
                {
                    "ts": 3,
                    "level": "error",
                    "event": "third",
                    "msg": "token=third-secret ticket=third-ticket Bearer third-bearer",
                    "data": {
                        "password": "password-secret",
                        "nested": "ticket=data-secret",
                        "safe": "value"
                    }
                }
            ]
        }),
    )
    .await;
    post_logs(
        &client,
        &server,
        json!({
            "sessionId": "other-session",
            "meetingId": "other-meeting",
            "logs": [{ "ts": 4, "level": "error", "event": "other" }]
        }),
    )
    .await;

    let response = client
        .get(format!(
            "{}/log?sessionId=session-1&meetingId=meeting-1&level=error&since={since}&limit=1",
            server.origin
        ))
        .bearer_auth(TEST_LOG_READ_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), ReqwestStatus::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE.as_str()],
        "application/x-ndjson"
    );
    assert!(response.headers()[header::CONTENT_DISPOSITION.as_str()]
        .to_str()
        .unwrap()
        .starts_with("attachment; filename="));
    let body = response.text().await.unwrap();
    assert!(body.ends_with('\n'));
    assert!(!body.trim_start().starts_with('['));
    let lines = body.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 1);
    let record = serde_json::from_str::<Value>(lines[0]).unwrap();
    assert_eq!(record["src"], "browser");
    assert_eq!(record["ts"], 3);
    assert!(record["receivedAt"].as_i64().unwrap() >= since);
    assert_eq!(record["sessionId"], "session-1");
    assert_eq!(record["meetingId"], "meeting-1");
    assert_eq!(record["level"], "error");
    assert_eq!(record["event"], "third");
    assert!(record["msg"]
        .as_str()
        .unwrap()
        .contains("Bearer [REDACTED]"));
    assert_eq!(record["data"]["safe"], "value");
    assert_eq!(record["data"]["password"], "[REDACTED]");
    assert!(record["url"].as_str().unwrap().contains("ok=1"));
    assert!(record["userAgent"].is_string());
    for secret in [
        "url-secret",
        "url-ticket",
        "agent-secret",
        "third-secret",
        "third-ticket",
        "third-bearer",
        "password-secret",
        "data-secret",
    ] {
        assert!(!body.contains(secret), "{secret} leaked in {body}");
    }

    let limited = client
        .get(format!(
            "{}/log?sessionId=session-1&level=error&limit=2",
            server.origin
        ))
        .bearer_auth(TEST_LOG_READ_TOKEN)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let events = limited
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["event"].clone())
        .collect::<Vec<_>>();
    assert_eq!(events, vec![Value::from("second"), Value::from("third")]);

    for query in ["sessionId=missing", "since=9223372036854775807", "limit=0"] {
        let response = client
            .get(format!("{}/log?{query}", server.origin))
            .bearer_auth(TEST_LOG_READ_TOKEN)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), ReqwestStatus::OK);
        assert!(response.text().await.unwrap().is_empty());
    }
}
