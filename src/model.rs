use serde::{Deserialize, Serialize};

/// Persistent meeting room (the "number"). Lives until the process restarts;
/// a future PostgreSQL `Store` implementation will make it durable.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Room {
    pub room_id: String,
    pub owner: String,
    pub topic: String,
    // never serialized to clients
    #[serde(skip_serializing)]
    pub password: String,
    pub locked: bool,
    /// user id of the designated presenter; empty means anyone may share
    pub presenter: String,
    pub created_at: i64,
}

/// One meeting instance ("one sitting") of a room. A room has at most one
/// ongoing meeting; when it ends it is archived as a `Record`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub meeting_no: String,
    pub room_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub max_concurrent: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Owner,
    #[default]
    Member,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Participant {
    pub user_id: String,
    pub name: String,
    pub role: Role,
    pub join_at: i64,
    pub leave_at: Option<i64>,
}

/// Ephemeral per-user media state. This is signaling data with a TTL, not
/// part of the durable room state.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Presence {
    pub name: String,
    pub state: String,
    pub audio: bool,
    pub video: bool,
    pub screen: bool,
}

/// One chat message inside a meeting.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Message {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub content: String,
    pub ts: i64,
}

/// Archived meeting: the "meeting record" listed in history.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub meeting_no: String,
    pub room_id: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub max_concurrent: usize,
    pub participants: Vec<Participant>,
    pub messages: Vec<Message>,
}
