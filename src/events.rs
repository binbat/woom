use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::broadcast;

use crate::model::{Message, Participant, Presence};
use crate::store::Store;

/// How many recent chat messages ride each state snapshot (enough for a
/// late joiner to catch up; live delivery uses `publish_message`).
const SNAPSHOT_MESSAGE_LIMIT: usize = 50;

/// A room event broadcast to all SSE subscribers of a room.
#[derive(Clone)]
pub struct RoomEvent {
    pub room_id: String,
    pub payload: String, // pre-serialized JSON, tagged with a "type" field
}

pub type EventBus = broadcast::Sender<RoomEvent>;

pub fn new_bus() -> EventBus {
    broadcast::channel(64).0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    meeting_no: Option<&'a str>,
    streams: &'a HashMap<String, Presence>,
    presenter: &'a str,
    locked: bool,
    participants: &'a [Participant],
    messages: &'a [Message],
}

pub async fn snapshot(store: &Arc<dyn Store>, room_id: &str) -> String {
    let Some(room) = store.get_room(room_id).await else {
        return String::new();
    };
    let meeting = store.current_meeting(room_id).await;
    let (streams, participants, messages) = match &meeting {
        Some(m) => (
            store.presence_map(&m.meeting_no).await,
            store.participants(&m.meeting_no).await,
            store.messages(&m.meeting_no, SNAPSHOT_MESSAGE_LIMIT).await,
        ),
        None => (HashMap::new(), Vec::new(), Vec::new()),
    };
    serde_json::to_string(&Snapshot {
        kind: "snapshot",
        meeting_no: meeting.as_ref().map(|m| m.meeting_no.as_str()),
        streams: &streams,
        presenter: &room.presenter,
        locked: room.locked,
        participants: &participants,
        messages: &messages,
    })
    .unwrap_or_default()
}

/// Push a fresh snapshot of the room to all subscribers. Send failures are
/// ignored: they only mean nobody is listening.
pub async fn publish_room(store: &Arc<dyn Store>, bus: &EventBus, room_id: &str) {
    let payload = snapshot(store, room_id).await;
    let _ = bus.send(RoomEvent {
        room_id: room_id.to_string(),
        payload,
    });
}

/// Broadcast a single chat message to all subscribers of the room.
pub fn publish_message(bus: &EventBus, room_id: &str, msg: &Message) {
    let payload = serde_json::json!({
        "type": "message",
        "message": msg,
    })
    .to_string();
    let _ = bus.send(RoomEvent {
        room_id: room_id.to_string(),
        payload,
    });
}
