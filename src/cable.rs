//! Optional second room-events transport over a Live777 cable (WebRTC
//! datachannel pipe). When `EVENTS_CABLE` is enabled, every event published
//! on the in-process bus is also injected into a per-room Live777 stream
//! (`{room_id}-events`) through the Live777 cable message API, so browsers
//! can receive the identical event stream over WHEP instead of SSE. SSE
//! remains fully functional; the cable is additive.
//!
//! Requires Live777 >= 0.11.0 (cable messages API). Against older versions
//! every inject fails and is logged, while SSE keeps working.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::mpsc;

use crate::events::RoomEvent;

/// Cable label carrying room events. Undeclared labels fall to the Live777
/// anonymous default bus pair, so no Live777 configuration is needed.
pub const CABLE_LABEL: &str = "events";
const EVENTS_STREAM_SUFFIX: &str = "-events";
/// Bounded so a sustained Live777 outage cannot grow memory without limit;
/// events are tiny, so this still covers long bursts.
const QUEUE_CAPACITY: usize = 4096;

/// Per-room Live777 stream id carrying the room's events. Room ids are
/// `\d{3}-\d{3}-\d{3}` and user stream ids are uuid v4, so the derived id
/// never collides with a user stream.
pub fn events_stream_id(room_id: &str) -> String {
    format!("{room_id}{EVENTS_STREAM_SUFFIX}")
}

/// Inverse of [`events_stream_id`]; `None` for ordinary stream ids.
pub fn events_room_id(stream_id: &str) -> Option<&str> {
    stream_id
        .strip_suffix(EVENTS_STREAM_SUFFIX)
        .filter(|room_id| !room_id.is_empty())
}

struct Job {
    stream: String,
    data: String,
}

/// Handle to the single global inject worker. One queue is enough: all
/// enqueue sites run under the API write gate, so enqueue order matches
/// commit order and per-room event order is preserved.
#[derive(Clone)]
pub struct CableEvents {
    sender: mpsc::Sender<Job>,
    dropped: Arc<AtomicU64>,
}

impl CableEvents {
    /// Spawn the background inject worker. The task is never joined and is
    /// aborted with the runtime on shutdown; queued events may be lost, which
    /// is recoverable client-side.
    pub fn spawn(http: reqwest::Client, live777_url: &str, live777_token: &str) -> Self {
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
        let base = live777_url.trim_end_matches('/').to_string();
        let token = live777_token.to_string();
        tokio::spawn(run(receiver, http, base, token));
        Self {
            sender,
            dropped: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Queue the exact SSE wire string of a just-published room event for
    /// injection into the room's events stream. When the queue is full the
    /// new job is dropped: event loss converges client-side because every
    /// snapshot carries the full room state.
    pub fn enqueue(&self, event: &RoomEvent) {
        let job = Job {
            stream: events_stream_id(&event.room_id),
            data: event.payload_json(),
        };
        if let Err(mpsc::error::TrySendError::Full(_)) = self.sender.try_send(job) {
            // Rate-limited: first drop and then every 100th.
            let dropped = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped % 100 == 1 {
                tracing::warn!("Live777 cable inject queue full; dropped {dropped} events so far");
            }
        }
        // Closed means the worker is gone (runtime shutdown); drop silently.
    }

    #[cfg(test)]
    fn test_handle(capacity: usize) -> (Self, mpsc::Receiver<Job>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (
            Self {
                sender,
                dropped: Arc::new(AtomicU64::new(0)),
            },
            receiver,
        )
    }
}

async fn run(
    mut receiver: mpsc::Receiver<Job>,
    http: reqwest::Client,
    base: String,
    token: String,
) {
    while let Some(job) = receiver.recv().await {
        inject(&http, &base, &token, &job).await;
    }
}

fn inject_request(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    job: &Job,
) -> reqwest::RequestBuilder {
    let url = format!(
        "{base}/api/streams/{}/cables/{CABLE_LABEL}/messages",
        job.stream
    );
    let mut request = http
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "data": job.data }).to_string());
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    request
}

async fn inject(http: &reqwest::Client, base: &str, token: &str, job: &Job) {
    match inject_request(http, base, token, job).send().await {
        Ok(response) if response.status().is_success() => return,
        Ok(response) if response.status() == reqwest::StatusCode::NOT_FOUND => {}
        Ok(response) => {
            tracing::warn!(
                "Live777 cable inject for {} returned {}",
                job.stream,
                response.status()
            );
            return;
        }
        Err(error) => {
            tracing::warn!("Live777 cable inject for {} failed: {error}", job.stream);
            return;
        }
    }
    // Unknown stream: provision the per-room events stream lazily, then retry
    // the inject once. "Already exists" (409) counts as success here.
    let mut create = http.post(format!("{base}/api/streams/{}", job.stream));
    if !token.is_empty() {
        create = create.bearer_auth(token);
    }
    match create.send().await {
        Ok(response)
            if response.status().is_success()
                || response.status() == reqwest::StatusCode::CONFLICT => {}
        Ok(response) => {
            tracing::warn!(
                "Live777 events stream create for {} returned {}",
                job.stream,
                response.status()
            );
            return;
        }
        Err(error) => {
            tracing::warn!(
                "Live777 events stream create for {} failed: {error}",
                job.stream
            );
            return;
        }
    }
    match inject_request(http, base, token, job).send().await {
        Ok(response) if response.status().is_success() => {}
        Ok(response) => tracing::warn!(
            "Live777 cable inject retry for {} returned {}",
            job.stream,
            response.status()
        ),
        Err(error) => {
            tracing::warn!(
                "Live777 cable inject retry for {} failed: {error}",
                job.stream
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Message;

    #[test]
    fn events_stream_ids_round_trip() {
        assert_eq!(events_stream_id("123-456-789"), "123-456-789-events");
        assert_eq!(events_room_id("123-456-789-events"), Some("123-456-789"));
        assert_eq!(events_room_id("123-456-789"), None);
        assert_eq!(events_room_id("-events"), None);
        // uuid v4 user stream ids never end with the suffix
        assert_eq!(events_room_id("7f3b2c1a-9d4e-4f5a-8b6c-1d2e3f4a5b6c"), None);
    }

    #[test]
    fn full_queue_drops_new_jobs_until_drained() {
        let (cable, mut receiver) = CableEvents::test_handle(2);
        let event = |revision: u64| {
            RoomEvent::message(
                "123-456-789",
                revision,
                Message {
                    id: revision.to_string(),
                    user_id: "user".to_string(),
                    name: "user".to_string(),
                    content: "hi".to_string(),
                    ts: 0,
                },
            )
        };
        cable.enqueue(&event(1));
        cable.enqueue(&event(2));
        cable.enqueue(&event(3));
        assert_eq!(cable.dropped.load(Ordering::Relaxed), 1);
        assert_eq!(receiver.try_recv().unwrap().data, event(1).payload_json());
        cable.enqueue(&event(4));
        assert_eq!(cable.dropped.load(Ordering::Relaxed), 1);
        assert_eq!(receiver.try_recv().unwrap().data, event(2).payload_json());
        assert_eq!(receiver.try_recv().unwrap().data, event(4).payload_json());
        assert!(receiver.try_recv().is_err());
    }
}
