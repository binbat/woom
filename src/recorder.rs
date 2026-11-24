//! Live777 recorder integration. WOOM drives recording per meeting (owner
//! toggle) by starting/stopping Live777's per-stream recorder for every
//! publishing participant. Live777 `auto_streams` is not used because WOOM
//! stream ids are per-user UUIDs that map to rooms only through WOOM state.
//!
//! Stop signals follow media-session revocation: whoever revokes a WHIP
//! session (leave, kick, meeting end, sweep) also stops its recording, and
//! the periodic reconcile repairs drift (WOOM restart, crashed publishers).

use axum::http::StatusCode;
use reqwest::{Method, RequestBuilder};
use serde::Deserialize;

use crate::api::AppState;
use crate::model::RecordingInfo;
use crate::proxy::MediaSession;
use crate::store::now_secs;

#[derive(Default, Deserialize)]
struct StartRecordResponse {
    record_dir: String,
}

fn live777(state: &AppState, method: Method, path: &str) -> RequestBuilder {
    let request = state.http.request(
        method,
        format!("{}{path}", state.cfg.live777_url.trim_end_matches('/')),
    );
    if state.cfg.live777_token.is_empty() {
        request
    } else {
        request.bearer_auth(&state.cfg.live777_token)
    }
}

/// Whether the Live777 upstream has the recorder feature compiled in.
pub(crate) async fn available(state: &AppState) -> bool {
    match live777(state, Method::GET, "/api/playback").send().await {
        Ok(response) => response.status() != StatusCode::NOT_IMPLEMENTED,
        Err(error) => {
            tracing::warn!("Live777 recorder probe failed: {error}");
            false
        }
    }
}

/// Start recording one stream and note the entry on the meeting. Returns the
/// entry on success; Live777 errors (including 501 = feature missing) are
/// logged and yield `None`.
async fn start_stream(
    state: &AppState,
    meeting_no: &str,
    stream_id: &str,
    user_id: &str,
    name: &str,
) -> Option<RecordingInfo> {
    // Live777 expects a JSON body (StartRecordRequest), even an empty one.
    let response = match live777(state, Method::POST, &format!("/api/record/{stream_id}"))
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body("{}")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("Live777 record start for {stream_id} failed: {error}");
            return None;
        }
    };
    if !response.status().is_success() {
        tracing::warn!(
            "Live777 record start for {stream_id} returned {}",
            response.status()
        );
        return None;
    }
    let record_dir = response
        .text()
        .await
        .ok()
        .and_then(|body| serde_json::from_str::<StartRecordResponse>(&body).ok())
        .map(|body| body.record_dir)
        .unwrap_or_default();
    if record_dir.is_empty() {
        tracing::warn!("Live777 record start for {stream_id} returned no record_dir");
        return None;
    }
    let entry = RecordingInfo {
        stream_id: stream_id.to_string(),
        user_id: user_id.to_string(),
        name: name.to_string(),
        record_dir,
        started_at: now_secs(),
        ended_at: None,
    };
    if let Err(error) = state
        .store
        .add_recording_entry(meeting_no, entry.clone())
        .await
    {
        tracing::error!("recording entry persist failed: {error}");
        return None;
    }
    Some(entry)
}

async fn stop_stream(state: &AppState, stream_id: &str) {
    match live777(state, Method::DELETE, &format!("/api/record/{stream_id}"))
        .send()
        .await
    {
        // 404 = never recorded or already finalized
        Ok(response)
            if response.status().is_success() || response.status() == StatusCode::NOT_FOUND => {}
        Ok(response) => tracing::warn!(
            "Live777 record stop for {stream_id} returned {}",
            response.status()
        ),
        Err(error) => tracing::warn!("Live777 record stop for {stream_id} failed: {error}"),
    }
}

/// Start recording for a freshly registered WHIP session when its meeting is
/// flagged as recording. Called from the media proxy after a successful
/// publish handshake.
pub(crate) async fn start_for_session(state: &AppState, session: &MediaSession) {
    if session.kind != "whip" {
        return;
    }
    let Some(room) = state.store.room_state(&session.room_id).await else {
        return;
    };
    let Some(meeting) = room.meeting.as_ref() else {
        return;
    };
    if meeting.meeting_no != session.meeting_no || meeting.recording_at.is_none() {
        return;
    }
    let meeting_no = meeting.meeting_no.clone();
    let open = state.store.meeting_recordings(&meeting_no).await;
    if open
        .iter()
        .any(|entry| entry.stream_id == session.stream_id && entry.ended_at.is_none())
    {
        return;
    }
    let name = room
        .participants
        .iter()
        .find(|participant| participant.user_id == session.user_id)
        .map(|participant| participant.name.clone())
        .unwrap_or_default();
    start_stream(
        state,
        &meeting_no,
        &session.stream_id,
        &session.user_id,
        &name,
    )
    .await;
}

/// Stop recording for a revoked WHIP session when it has a recording entry.
/// Safe to call for sessions that were never recorded (checks the store
/// first, so no Live777 call is made in the common case).
pub(crate) async fn stop_for_session(state: &AppState, session: &MediaSession) {
    if session.kind != "whip" {
        return;
    }
    if !state
        .store
        .stream_recording_exists(&session.meeting_no, &session.stream_id)
        .await
    {
        return;
    }
    stop_stream(state, &session.stream_id).await;
    // Still-open entries belong to an ongoing meeting; archived ones were
    // already closed by end_meeting and this persist is a no-op.
    let _ = state
        .store
        .finish_recording_entry(&session.meeting_no, &session.stream_id, now_secs())
        .await;
}

/// Stop recordings for a batch of revoked sessions (leave/kick/end/sweep).
pub(crate) async fn stop_for_sessions(state: &AppState, sessions: &[MediaSession]) {
    for session in sessions {
        stop_for_session(state, session).await;
    }
}

/// Start recording every publishing stream of the meeting. Entries dedupe per
/// stream, so re-entry is safe.
pub(crate) async fn start_meeting(state: &AppState, room_id: &str, meeting_no: &str) {
    let sessions: Vec<MediaSession> = state
        .media_sessions
        .lock()
        .await
        .values()
        .filter(|session| {
            session.kind == "whip" && session.room_id == room_id && session.meeting_no == meeting_no
        })
        .cloned()
        .collect();
    for session in sessions {
        start_for_session(state, &session).await;
    }
}

/// Stop every open recording of an ongoing meeting (owner switched recording
/// off). Meeting end is covered by per-session stops on the revoke path.
pub(crate) async fn stop_meeting(state: &AppState, meeting_no: &str) {
    for entry in state.store.meeting_recordings(meeting_no).await {
        if entry.ended_at.is_none() {
            stop_stream(state, &entry.stream_id).await;
        }
    }
    let _ = state.store.finish_recordings(meeting_no, now_secs()).await;
}

/// Best-effort removal of a recording's Live777 index row (ack + delete).
/// Files in storage are never touched by any API; retention is handled by the
/// deployment (bucket lifecycle rules, filesystem pruning).
pub(crate) async fn drop_index_entry(state: &AppState, stream_id: &str, record_id: &str) {
    let body = serde_json::json!({
        "records": [{ "stream": stream_id, "record": record_id }]
    });
    for method in [Method::PATCH, Method::DELETE] {
        match live777(state, method.clone(), "/api/recordings")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {}
            Ok(response) => tracing::warn!(
                "Live777 recording index {method} for {stream_id}/{record_id} returned {}",
                response.status()
            ),
            Err(error) => {
                tracing::warn!(
                    "Live777 recording index {method} for {stream_id}/{record_id} failed: {error}"
                )
            }
        }
    }
}

/// Periodic drift repair driven by the API sweep: for meetings flagged as
/// recording, start publishers that lack an open entry (WOOM restart, hook
/// misses) and stop entries whose publisher session is gone.
pub(crate) async fn reconcile(state: &AppState) {
    for (room_id, meeting_no) in state.store.recording_meetings().await {
        let sessions: Vec<MediaSession> = state
            .media_sessions
            .lock()
            .await
            .values()
            .filter(|session| {
                session.kind == "whip"
                    && session.room_id == room_id
                    && session.meeting_no == meeting_no
            })
            .cloned()
            .collect();
        for entry in state.store.meeting_recordings(&meeting_no).await {
            if entry.ended_at.is_none()
                && !sessions
                    .iter()
                    .any(|session| session.stream_id == entry.stream_id)
            {
                stop_stream(state, &entry.stream_id).await;
                let _ = state
                    .store
                    .finish_recording_entry(&meeting_no, &entry.stream_id, now_secs())
                    .await;
            }
        }
        for session in sessions {
            start_for_session(state, &session).await;
        }
    }
}
