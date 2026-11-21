use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::sync::broadcast;

use crate::model::{Message, Participant, Presence};

pub const SNAPSHOT_MESSAGE_LIMIT: usize = 50;
const EVENT_BUFFER: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub revision: u64,
    pub meeting_no: Option<String>,
    pub streams: HashMap<String, Presence>,
    pub presenter: String,
    pub locked: bool,
    pub participants: Vec<Participant>,
    pub messages: Vec<Message>,
    pub mute_all_at: i64,
}

impl Snapshot {
    pub fn is_active(&self, user_id: &str) -> bool {
        self.meeting_no.is_some()
            && self
                .participants
                .iter()
                .any(|participant| participant.user_id == user_id && participant.leave_at.is_none())
    }

    pub fn ended(revision: u64) -> Self {
        Self {
            kind: "snapshot",
            revision,
            meeting_no: None,
            streams: HashMap::new(),
            presenter: String::new(),
            locked: false,
            participants: Vec::new(),
            messages: Vec::new(),
            mute_all_at: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageEvent {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub revision: u64,
    pub message: Message,
}

#[derive(Clone, Debug)]
pub enum EventPayload {
    Snapshot(Snapshot),
    Message(MessageEvent),
}

#[derive(Clone, Debug)]
pub struct RoomEvent {
    pub room_id: String,
    pub revision: u64,
    pub payload: EventPayload,
}

impl RoomEvent {
    pub fn snapshot(room_id: &str, snapshot: Snapshot) -> Self {
        Self {
            room_id: room_id.to_string(),
            revision: snapshot.revision,
            payload: EventPayload::Snapshot(snapshot),
        }
    }

    pub fn message(room_id: &str, revision: u64, message: Message) -> Self {
        Self {
            room_id: room_id.to_string(),
            revision,
            payload: EventPayload::Message(MessageEvent {
                kind: "message",
                revision,
                message,
            }),
        }
    }

    pub fn payload_json(&self) -> String {
        match &self.payload {
            EventPayload::Snapshot(snapshot) => serde_json::to_string(snapshot),
            EventPayload::Message(message) => serde_json::to_string(message),
        }
        .unwrap_or_else(|_| "{}".to_string())
    }

    pub fn snapshot_ref(&self) -> Option<&Snapshot> {
        match &self.payload {
            EventPayload::Snapshot(snapshot) => Some(snapshot),
            EventPayload::Message(_) => None,
        }
    }
}

#[derive(Clone, Default)]
pub struct EventBus {
    rooms: Arc<Mutex<HashMap<String, broadcast::Sender<RoomEvent>>>>,
}

impl EventBus {
    pub fn subscribe(&self, room_id: &str) -> broadcast::Receiver<RoomEvent> {
        let mut rooms = self.rooms.lock().expect("event bus lock poisoned");
        rooms
            .entry(room_id.to_string())
            .or_insert_with(|| broadcast::channel(EVENT_BUFFER).0)
            .subscribe()
    }

    pub fn publish(&self, event: RoomEvent) {
        let sender = self
            .rooms
            .lock()
            .expect("event bus lock poisoned")
            .get(&event.room_id)
            .cloned();
        if let Some(sender) = sender {
            let _ = sender.send(event);
        }
    }

    #[cfg(test)]
    pub fn room_count(&self) -> usize {
        self.rooms.lock().expect("event bus lock poisoned").len()
    }
}

pub fn new_bus() -> EventBus {
    EventBus::default()
}
