use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CLIENT_LOG_CAPACITY: usize = 5000;
pub const MAX_CLIENT_LOG_ENTRIES: usize = 100;
pub const MAX_CLIENT_LOG_READ: usize = 2000;
const DEFAULT_CLIENT_LOG_READ: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogBatch {
    pub session_id: Option<String>,
    pub meeting_id: Option<String>,
    pub url: Option<String>,
    pub user_agent: Option<String>,
    pub logs: Vec<ClientLogEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ClientLogEntry {
    pub ts: Option<i64>,
    pub level: Option<String>,
    pub event: Option<String>,
    pub msg: Option<String>,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogRecord {
    pub src: &'static str,
    pub ts: Option<i64>,
    pub received_at: i64,
    pub session_id: Option<String>,
    pub meeting_id: Option<String>,
    pub level: String,
    pub event: Option<String>,
    pub msg: Option<String>,
    pub data: Option<Value>,
    pub url: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogFilter {
    pub session_id: Option<String>,
    pub meeting_id: Option<String>,
    pub level: Option<String>,
    pub since: Option<i64>,
    pub limit: Option<usize>,
}

impl ClientLogFilter {
    fn limit(&self) -> usize {
        self.limit
            .unwrap_or(DEFAULT_CLIENT_LOG_READ)
            .min(MAX_CLIENT_LOG_READ)
    }
}

#[derive(Clone, Default)]
pub struct ClientLogStore {
    entries: Arc<Mutex<VecDeque<ClientLogRecord>>>,
}

impl ClientLogStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append_batch(&self, batch: ClientLogBatch) -> Vec<ClientLogRecord> {
        let session_id = batch.session_id.map(|value| sanitize(&value, 128));
        let meeting_id = batch.meeting_id.map(|value| sanitize(&value, 128));
        let url = batch.url.map(|value| sanitize(&value, 2048));
        let user_agent = batch.user_agent.map(|value| sanitize(&value, 512));
        let received_at = now_millis();
        let records = batch
            .logs
            .into_iter()
            .take(MAX_CLIENT_LOG_ENTRIES)
            .map(|entry| ClientLogRecord {
                src: "browser",
                ts: entry.ts,
                received_at,
                session_id: session_id.clone(),
                meeting_id: meeting_id.clone(),
                level: sanitize(entry.level.as_deref().unwrap_or("info"), 16),
                event: entry.event.map(|value| sanitize(&value, 128)),
                msg: entry.msg.map(|value| sanitize(&value, 500)),
                data: entry.data.map(|value| redact_json(value, 0)),
                url: url.clone(),
                user_agent: user_agent.clone(),
            })
            .collect::<Vec<_>>();

        let mut entries = self.entries.lock().expect("client log store lock poisoned");
        for record in &records {
            entries.push_back(record.clone());
            if entries.len() > CLIENT_LOG_CAPACITY {
                entries.pop_front();
            }
        }
        records
    }

    pub fn query(&self, filter: &ClientLogFilter) -> Vec<ClientLogRecord> {
        let entries = self.entries.lock().expect("client log store lock poisoned");
        let mut records = entries
            .iter()
            .rev()
            .filter(|record| {
                filter
                    .session_id
                    .as_ref()
                    .is_none_or(|value| record.session_id.as_ref() == Some(value))
                    && filter
                        .meeting_id
                        .as_ref()
                        .is_none_or(|value| record.meeting_id.as_ref() == Some(value))
                    && filter
                        .level
                        .as_ref()
                        .is_none_or(|value| record.level == *value)
                    && filter.since.is_none_or(|since| record.received_at >= since)
            })
            .take(filter.limit())
            .cloned()
            .collect::<Vec<_>>();
        records.reverse();
        records
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .expect("client log store lock poisoned")
            .len()
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after the Unix epoch")
        .as_millis() as i64
}

fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn sanitize(value: &str, limit: usize) -> String {
    redact_text(&truncate(value, limit))
}

fn redact_text(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while cursor < value.len() {
        let remaining = &lower[cursor..];
        let next = [("token=", 6), ("ticket=", 7), ("bearer ", 7)]
            .into_iter()
            .filter_map(|(pattern, length)| {
                remaining
                    .find(pattern)
                    .map(|index| (cursor + index, length))
            })
            .min_by_key(|(index, _)| *index);
        let Some((start, prefix_len)) = next else {
            break;
        };
        let value_start = start + prefix_len;
        output.push_str(&value[cursor..value_start]);
        let mut end = value.len();
        for (index, character) in value[value_start..].char_indices() {
            if character.is_whitespace() || matches!(character, '&' | '#' | ';' | ',' | '"' | '\'')
            {
                end = value_start + index;
                break;
            }
        }
        output.push_str("[REDACTED]");
        cursor = end;
    }
    output.push_str(&value[cursor..]);
    output
}

fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "authorization",
        "cookie",
        "credential",
        "jwt",
    ]
    .iter()
    .any(|sensitive| key.contains(sensitive))
}

fn redact_json(value: Value, depth: usize) -> Value {
    if depth > 8 {
        return Value::String("[TRUNCATED]".to_string());
    }
    match value {
        Value::String(value) => Value::String(sanitize(&value, 1000)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(64)
                .map(|value| redact_json(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .take(64)
                .map(|(key, value)| {
                    let value = if sensitive_key(&key) {
                        Value::String("[REDACTED]".to_string())
                    } else {
                        redact_json(value, depth + 1)
                    };
                    (sanitize(&key, 128), value)
                })
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn batch(event: &str) -> ClientLogBatch {
        ClientLogBatch {
            session_id: Some("session".to_string()),
            meeting_id: Some("meeting".to_string()),
            url: None,
            user_agent: None,
            logs: vec![ClientLogEntry {
                ts: None,
                level: Some("info".to_string()),
                event: Some(event.to_string()),
                msg: None,
                data: None,
            }],
        }
    }

    #[test]
    fn store_is_bounded_and_evicts_oldest_entries() {
        let store = ClientLogStore::new();
        for index in 0..CLIENT_LOG_CAPACITY + 5 {
            store.append_batch(batch(&format!("event-{index}")));
        }
        assert_eq!(store.len(), CLIENT_LOG_CAPACITY);
        let records = store.query(&ClientLogFilter {
            limit: Some(1),
            ..ClientLogFilter::default()
        });
        assert_eq!(records[0].event.as_deref(), Some("event-5004"));
        let capped = store.query(&ClientLogFilter {
            limit: Some(usize::MAX),
            ..ClientLogFilter::default()
        });
        assert_eq!(capped.len(), MAX_CLIENT_LOG_READ);
        assert_eq!(capped[0].event.as_deref(), Some("event-3005"));
        assert_eq!(capped.last().unwrap().event.as_deref(), Some("event-5004"));
        let entries = store.entries.lock().unwrap();
        assert_eq!(entries.front().unwrap().event.as_deref(), Some("event-5"));
        assert_eq!(entries.back().unwrap().event.as_deref(), Some("event-5004"));
    }

    #[test]
    fn every_text_field_and_json_value_is_redacted() {
        let store = ClientLogStore::new();
        let records = store.append_batch(ClientLogBatch {
            session_id: Some("session-token=session-secret".to_string()),
            meeting_id: Some("meeting".to_string()),
            url: Some(
                "https://example.test/?token=url-secret&ticket=ticket-secret&ok=1".to_string(),
            ),
            user_agent: Some("agent Bearer agent-secret".to_string()),
            logs: vec![ClientLogEntry {
                ts: Some(1),
                level: Some("error".to_string()),
                event: Some("event".to_string()),
                msg: Some("token=msg-secret ticket=msg-ticket Bearer msg-bearer".to_string()),
                data: Some(json!({
                    "password": "password-secret",
                    "nested": "ticket=json-secret",
                    "authorization": "Bearer json-bearer",
                    "safe": "value"
                })),
            }],
        });
        let serialized = serde_json::to_string(&records[0]).unwrap();
        for secret in [
            "session-secret",
            "url-secret",
            "ticket-secret",
            "agent-secret",
            "msg-secret",
            "msg-ticket",
            "msg-bearer",
            "password-secret",
            "json-secret",
            "json-bearer",
        ] {
            assert!(
                !serialized.contains(secret),
                "{secret} leaked in {serialized}"
            );
        }
        assert!(records[0].url.as_deref().unwrap().contains("ok=1"));
        assert!(serialized.contains("Bearer [REDACTED]"));
        assert_eq!(records[0].data.as_ref().unwrap()["safe"], "value");
    }
}
