//! WOOM HTTP client for the caption contract.
//!
//! Both endpoints are guarded by a static bearer token (the WOOM server's
//! `CAPTION_TOKEN`):
//!
//! - `GET {WOOM_URL}/caption/streams` lists rooms with ongoing meetings and
//!   the participants currently publishing audio. A speaker's `userId` is the
//!   Live777 stream id they publish WHIP under.
//! - `POST {WOOM_URL}/room/{roomId}/caption` submits a caption segment
//!   (`201 Created`). Posts sharing an `id` revise the same segment
//!   client-side: partials of one utterance share an id, the final commits it.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct WoomClient {
    http: reqwest::Client,
    /// Base URL without a trailing slash, e.g. `http://localhost:4000`.
    base_url: String,
    caption_token: String,
}

/// Top-level payload of `GET /caption/streams`.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CaptionStreams {
    #[serde(default)]
    pub rooms: Vec<RoomSpeakers>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoomSpeakers {
    pub room_id: String,
    #[serde(default)]
    pub speakers: Vec<SpeakerInfo>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerInfo {
    pub user_id: String,
    #[serde(default)]
    pub name: String,
}

/// Body of `POST /room/{roomId}/caption`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptionSegment {
    pub id: String,
    pub user_id: String,
    pub text: String,
    pub is_final: bool,
}

impl WoomClient {
    pub fn new(base_url: &str, caption_token: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("build WOOM HTTP client")?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            caption_token: caption_token.to_string(),
        })
    }

    /// Fetch the rooms/speakers currently eligible for captioning.
    ///
    /// Any failure (network, non-200, malformed body) is retryable: the
    /// caller is expected to log and try again on the next poll.
    pub async fn caption_streams(&self) -> Result<Vec<RoomSpeakers>> {
        let url = format!("{}/caption/streams", self.base_url);
        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.caption_token)
            .send()
            .await
            .with_context(|| format!("GET {url}"))?;
        if response.status() != StatusCode::OK {
            return Err(response_error("GET", &url, response).await);
        }
        let streams: CaptionStreams = response
            .json()
            .await
            .with_context(|| format!("parse {url} response body"))?;
        Ok(streams.rooms)
    }

    /// Post one caption segment; expects `201 Created`.
    ///
    /// Failures are logged-and-dropped by the caller: captions are ephemeral
    /// and retrying a stale partial would look worse than skipping it.
    pub async fn post_caption(&self, room_id: &str, segment: &CaptionSegment) -> Result<()> {
        let url = format!("{}/room/{}/caption", self.base_url, room_id);
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.caption_token)
            .json(segment)
            .send()
            .await
            .with_context(|| format!("POST {url}"))?;
        if response.status() != StatusCode::CREATED {
            return Err(response_error("POST", &url, response).await);
        }
        Ok(())
    }
}

/// Error body snippets are bounded so a misbehaving endpoint cannot flood the logs.
async fn response_error(method: &str, url: &str, response: reqwest::Response) -> anyhow::Error {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let snippet: String = body.chars().take(256).collect();
    anyhow!("{method} {url} -> {status}: {snippet}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_caption_streams_contract_example() {
        let body = r#"{"rooms":[{"roomId":"123-456-789","speakers":[{"userId":"<uuid>","name":"Alice"}]}]}"#;
        let streams: CaptionStreams = serde_json::from_str(body).unwrap();
        assert_eq!(streams.rooms.len(), 1);
        assert_eq!(streams.rooms[0].room_id, "123-456-789");
        assert_eq!(
            streams.rooms[0].speakers,
            vec![SpeakerInfo {
                user_id: "<uuid>".to_string(),
                name: "Alice".to_string(),
            }]
        );
    }

    #[test]
    fn parses_empty_rooms_and_missing_speakers() {
        let streams: CaptionStreams = serde_json::from_str(r#"{"rooms":[]}"#).unwrap();
        assert!(streams.rooms.is_empty());
        let streams: CaptionStreams =
            serde_json::from_str(r#"{"rooms":[{"roomId":"r1"}]}"#).unwrap();
        assert!(streams.rooms[0].speakers.is_empty());
    }

    #[test]
    fn caption_segment_serializes_to_contract_json() {
        let segment = CaptionSegment {
            id: "segment-id".to_string(),
            user_id: "user-1".to_string(),
            text: "hello".to_string(),
            is_final: true,
        };
        let json = serde_json::to_value(&segment).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "segment-id",
                "userId": "user-1",
                "text": "hello",
                "isFinal": true,
            })
        );
    }

    #[test]
    fn base_url_trailing_slash_is_stripped() {
        let client = WoomClient::new("http://localhost:4000/", "token").unwrap();
        assert_eq!(client.base_url, "http://localhost:4000");
    }
}
