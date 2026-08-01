use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;

use crate::model::{Meeting, Message, Participant, Presence, Record, Room};

/// Presence entries older than this are swept (client heartbeat is 15s).
pub const PRESENCE_TTL_SECS: u64 = 45;

/// Chat history kept per meeting (oldest dropped beyond this).
pub const MAX_MESSAGES_PER_MEETING: usize = 500;

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Storage abstraction. `MemoryStore` is the current implementation; a
/// PostgreSQL implementation can replace it without touching the API layer.
#[async_trait]
pub trait Store: Send + Sync {
    async fn create_room(&self, room: Room);
    async fn get_room(&self, room_id: &str) -> Option<Room>;
    async fn update_room(&self, room: Room);

    async fn current_meeting(&self, room_id: &str) -> Option<Meeting>;
    async fn create_meeting(&self, meeting: Meeting);
    async fn end_meeting(&self, meeting_no: &str, ended_at: i64) -> Option<Meeting>;
    async fn bump_concurrent(&self, meeting_no: &str, active: usize);

    /// Insert or re-join (clears `leave_at`). Returns the participant list.
    async fn join_participant(&self, meeting_no: &str, p: Participant) -> Vec<Participant>;
    async fn leave_participant(&self, meeting_no: &str, user_id: &str, leave_at: i64) -> Vec<Participant>;
    async fn participants(&self, meeting_no: &str) -> Vec<Participant>;

    async fn set_presence(&self, meeting_no: &str, user_id: &str, p: Presence);
    async fn remove_presence(&self, meeting_no: &str, user_id: &str) -> bool;
    async fn clear_presence(&self, meeting_no: &str);
    async fn presence_map(&self, meeting_no: &str) -> HashMap<String, Presence>;
    /// Drop expired presence entries. Returns room ids whose snapshot changed.
    async fn sweep_presence(&self, ttl_secs: u64) -> Vec<String>;

    async fn add_message(&self, meeting_no: &str, msg: Message);
    /// The most recent `limit` messages, oldest first.
    async fn messages(&self, meeting_no: &str, limit: usize) -> Vec<Message>;
    async fn take_messages(&self, meeting_no: &str) -> Vec<Message>;

    async fn archive_record(&self, record: Record);
    async fn records_for_user(&self, user_id: &str) -> Vec<Record>;
    async fn records_for_room(&self, room_id: &str) -> Vec<Record>;
}

#[derive(Default)]
pub struct MemoryStore {
    rooms: RwLock<HashMap<String, Room>>,
    /// meeting_no -> meeting
    meetings: RwLock<HashMap<String, Meeting>>,
    /// room_id -> ongoing meeting_no
    current: RwLock<HashMap<String, String>>,
    /// meeting_no -> participants
    participants: RwLock<HashMap<String, Vec<Participant>>>,
    /// meeting_no -> user_id -> (presence, updated_at)
    presence: RwLock<HashMap<String, HashMap<String, (Presence, i64)>>>,
    /// meeting_no -> chat messages, oldest first
    messages: RwLock<HashMap<String, Vec<Message>>>,
    records: RwLock<Vec<Record>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Store for MemoryStore {
    async fn create_room(&self, room: Room) {
        self.rooms
            .write()
            .unwrap()
            .insert(room.room_id.clone(), room);
    }

    async fn get_room(&self, room_id: &str) -> Option<Room> {
        self.rooms.read().unwrap().get(room_id).cloned()
    }

    async fn update_room(&self, room: Room) {
        self.rooms
            .write()
            .unwrap()
            .insert(room.room_id.clone(), room);
    }

    async fn current_meeting(&self, room_id: &str) -> Option<Meeting> {
        let meeting_no = self.current.read().unwrap().get(room_id).cloned()?;
        self.meetings.read().unwrap().get(&meeting_no).cloned()
    }

    async fn create_meeting(&self, meeting: Meeting) {
        self.current
            .write()
            .unwrap()
            .insert(meeting.room_id.clone(), meeting.meeting_no.clone());
        self.meetings
            .write()
            .unwrap()
            .insert(meeting.meeting_no.clone(), meeting);
    }

    async fn end_meeting(&self, meeting_no: &str, ended_at: i64) -> Option<Meeting> {
        let mut meetings = self.meetings.write().unwrap();
        let meeting = meetings.get_mut(meeting_no)?;
        meeting.ended_at = Some(ended_at);
        let meeting = meeting.clone();
        self.current
            .write()
            .unwrap()
            .retain(|_, no| no != meeting_no);
        Some(meeting)
    }

    async fn bump_concurrent(&self, meeting_no: &str, active: usize) {
        if let Some(meeting) = self.meetings.write().unwrap().get_mut(meeting_no) {
            meeting.max_concurrent = meeting.max_concurrent.max(active);
        }
    }

    async fn join_participant(&self, meeting_no: &str, p: Participant) -> Vec<Participant> {
        let mut participants = self.participants.write().unwrap();
        let list = participants.entry(meeting_no.to_string()).or_default();
        if let Some(existing) = list.iter_mut().find(|x| x.user_id == p.user_id) {
            existing.leave_at = None;
            existing.name = p.name;
            existing.role = p.role;
        } else {
            list.push(p);
        }
        list.clone()
    }

    async fn leave_participant(&self, meeting_no: &str, user_id: &str, leave_at: i64) -> Vec<Participant> {
        let mut participants = self.participants.write().unwrap();
        let list = participants.entry(meeting_no.to_string()).or_default();
        if let Some(existing) = list.iter_mut().find(|x| x.user_id == user_id) {
            existing.leave_at = Some(leave_at);
        }
        list.clone()
    }

    async fn participants(&self, meeting_no: &str) -> Vec<Participant> {
        self.participants
            .read()
            .unwrap()
            .get(meeting_no)
            .cloned()
            .unwrap_or_default()
    }

    async fn set_presence(&self, meeting_no: &str, user_id: &str, p: Presence) {
        self.presence
            .write()
            .unwrap()
            .entry(meeting_no.to_string())
            .or_default()
            .insert(user_id.to_string(), (p, now_secs()));
    }

    async fn remove_presence(&self, meeting_no: &str, user_id: &str) -> bool {
        self.presence
            .write()
            .unwrap()
            .get_mut(meeting_no)
            .and_then(|m| m.remove(user_id))
            .is_some()
    }

    async fn clear_presence(&self, meeting_no: &str) {
        self.presence.write().unwrap().remove(meeting_no);
    }

    async fn presence_map(&self, meeting_no: &str) -> HashMap<String, Presence> {
        self.presence
            .read()
            .unwrap()
            .get(meeting_no)
            .map(|m| {
                m.iter()
                    .map(|(k, (p, _))| (k.clone(), p.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    async fn sweep_presence(&self, ttl_secs: u64) -> Vec<String> {
        let now = now_secs();
        let mut changed_meetings = Vec::new();
        for (meeting_no, map) in self.presence.write().unwrap().iter_mut() {
            let before = map.len();
            map.retain(|_, (_, updated_at)| now - *updated_at < ttl_secs as i64);
            if map.len() != before {
                changed_meetings.push(meeting_no.clone());
            }
        }
        let meetings = self.meetings.read().unwrap();
        changed_meetings
            .into_iter()
            .filter_map(|no| meetings.get(&no).map(|m| m.room_id.clone()))
            .collect()
    }

    async fn add_message(&self, meeting_no: &str, msg: Message) {
        let mut messages = self.messages.write().unwrap();
        let list = messages.entry(meeting_no.to_string()).or_default();
        list.push(msg);
        if list.len() > MAX_MESSAGES_PER_MEETING {
            let overflow = list.len() - MAX_MESSAGES_PER_MEETING;
            list.drain(..overflow);
        }
    }

    async fn messages(&self, meeting_no: &str, limit: usize) -> Vec<Message> {
        self.messages
            .read()
            .unwrap()
            .get(meeting_no)
            .map(|list| list.iter().rev().take(limit).rev().cloned().collect())
            .unwrap_or_default()
    }

    async fn take_messages(&self, meeting_no: &str) -> Vec<Message> {
        self.messages
            .write()
            .unwrap()
            .remove(meeting_no)
            .unwrap_or_default()
    }

    async fn archive_record(&self, record: Record) {
        self.records.write().unwrap().push(record);
    }

    async fn records_for_user(&self, user_id: &str) -> Vec<Record> {
        self.records
            .read()
            .unwrap()
            .iter()
            .filter(|r| r.participants.iter().any(|p| p.user_id == user_id))
            .cloned()
            .collect()
    }

    async fn records_for_room(&self, room_id: &str) -> Vec<Record> {
        self.records
            .read()
            .unwrap()
            .iter()
            .filter(|r| r.room_id == room_id)
            .cloned()
            .collect()
    }
}
