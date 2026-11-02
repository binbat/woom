use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::events::{RoomEvent, Snapshot, SNAPSHOT_MESSAGE_LIMIT};
use crate::helper;
use crate::model::{Meeting, Message, Participant, Presence, Record, Role, Room};

pub const PRESENCE_TTL_SECS: u64 = 45;
pub const PARTICIPANT_TTL_SECS: u64 = 24 * 60 * 60;
pub const MAX_MESSAGES_PER_MEETING: usize = 500;
const DATA_VERSION: u32 = 1;
const ROOM_ID_ATTEMPTS: usize = 16;

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after the Unix epoch")
        .as_secs() as i64
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after the Unix epoch")
        .as_millis() as i64
}

#[derive(Debug)]
pub enum StoreError {
    NotFound,
    NoMeeting,
    NotParticipant,
    Forbidden,
    Invalid(&'static str),
    InvalidData(String),
    RoomIdExhausted,
    Io(std::io::Error),
    Json(serde_json::Error),
    Task(tokio::task::JoinError),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(f, "room not found"),
            Self::NoMeeting => write!(f, "no ongoing meeting"),
            Self::NotParticipant => write!(f, "not an active participant"),
            Self::Forbidden => write!(f, "forbidden"),
            Self::Invalid(message) => write!(f, "{message}"),
            Self::InvalidData(message) => write!(f, "invalid data file: {message}"),
            Self::RoomIdExhausted => write!(f, "could not allocate a unique room id"),
            Self::Io(error) => write!(f, "storage I/O error: {error}"),
            Self::Json(error) => write!(f, "storage JSON error: {error}"),
            Self::Task(error) => write!(f, "storage task error: {error}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<tokio::task::JoinError> for StoreError {
    fn from(error: tokio::task::JoinError) -> Self {
        Self::Task(error)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Data {
    version: u32,
    rooms: HashMap<String, Room>,
    meetings: HashMap<String, Meeting>,
    current: HashMap<String, String>,
    participants: HashMap<String, Vec<Participant>>,
    messages: HashMap<String, Vec<Message>>,
    records: Vec<Record>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            version: DATA_VERSION,
            rooms: HashMap::new(),
            meetings: HashMap::new(),
            current: HashMap::new(),
            participants: HashMap::new(),
            messages: HashMap::new(),
            records: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct TimedPresence {
    value: Presence,
    updated_at: i64,
}

#[derive(Clone, Debug, Default)]
struct Inner {
    data: Data,
    presence: HashMap<String, HashMap<String, TimedPresence>>,
    last_seen: HashMap<(String, String), i64>,
    revisions: HashMap<String, u64>,
}

impl Inner {
    fn next_revision(&mut self, room_id: &str) -> u64 {
        let revision = self.revisions.entry(room_id.to_string()).or_default();
        *revision += 1;
        *revision
    }

    fn active_participant(&self, meeting_no: &str, user_id: &str) -> Option<&Participant> {
        self.data
            .participants
            .get(meeting_no)?
            .iter()
            .find(|participant| participant.user_id == user_id && participant.leave_at.is_none())
    }

    fn active_in_room(&self, room_id: &str, user_id: &str) -> bool {
        self.data
            .current
            .get(room_id)
            .is_some_and(|meeting_no| self.active_participant(meeting_no, user_id).is_some())
    }

    fn presence_for(&self, meeting_no: &str, now: i64) -> HashMap<String, Presence> {
        self.presence
            .get(meeting_no)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|(_, presence)| now - presence.updated_at < PRESENCE_TTL_SECS as i64)
                    .map(|(user_id, presence)| (user_id.clone(), presence.value.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn room_state_at(&self, room_id: &str, now: i64) -> Option<RoomState> {
        let room = self.data.rooms.get(room_id)?.clone();
        let meeting = self
            .data
            .current
            .get(room_id)
            .and_then(|meeting_no| self.data.meetings.get(meeting_no))
            .cloned();
        let (streams, participants) = match &meeting {
            Some(meeting) => (
                self.presence_for(&meeting.meeting_no, now),
                self.data
                    .participants
                    .get(&meeting.meeting_no)
                    .cloned()
                    .unwrap_or_default(),
            ),
            None => (HashMap::new(), Vec::new()),
        };
        Some(RoomState {
            room,
            meeting,
            participants,
            streams,
        })
    }

    fn snapshot_at(&self, room_id: &str, revision: u64) -> Result<Snapshot, StoreError> {
        let state = self
            .room_state_at(room_id, now_secs())
            .ok_or(StoreError::NotFound)?;
        let messages = state
            .meeting
            .as_ref()
            .and_then(|meeting| self.data.messages.get(&meeting.meeting_no))
            .map(|messages| {
                messages
                    .iter()
                    .rev()
                    .take(SNAPSHOT_MESSAGE_LIMIT)
                    .rev()
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        Ok(Snapshot {
            kind: "snapshot",
            revision,
            meeting_no: state.meeting.map(|meeting| meeting.meeting_no),
            streams: state.streams,
            presenter: state.room.presenter,
            locked: state.room.locked,
            participants: state.participants,
            messages,
            mute_all_at: state.room.mute_all_at,
        })
    }

    fn end_meeting(&mut self, room_id: &str, meeting_no: &str, ended_at: i64) {
        let Some(meeting) = self.data.meetings.get_mut(meeting_no) else {
            return;
        };
        if meeting.ended_at.is_some() {
            return;
        }
        meeting.ended_at = Some(ended_at);
        if self.data.current.get(room_id) == Some(&meeting_no.to_string()) {
            self.data.current.remove(room_id);
        }
        if let Some(participants) = self.data.participants.get_mut(meeting_no) {
            for participant in participants {
                if participant.leave_at.is_none() {
                    participant.leave_at = Some(ended_at);
                }
                self.last_seen
                    .remove(&(meeting_no.to_string(), participant.user_id.clone()));
            }
        }
        self.presence.remove(meeting_no);
        if self
            .data
            .records
            .iter()
            .any(|record| record.meeting_no == meeting_no)
        {
            return;
        }
        let meeting = self
            .data
            .meetings
            .get(meeting_no)
            .cloned()
            .expect("meeting exists");
        let record = Record {
            meeting_no: meeting.meeting_no.clone(),
            room_id: room_id.to_string(),
            started_at: meeting.started_at,
            ended_at,
            max_concurrent: meeting.max_concurrent,
            participants: self
                .data
                .participants
                .get(meeting_no)
                .cloned()
                .unwrap_or_default(),
            messages: self
                .data
                .messages
                .get(meeting_no)
                .cloned()
                .unwrap_or_default(),
        };
        self.data.records.push(record);
    }
}

#[derive(Clone, Debug)]
pub struct RoomState {
    pub room: Room,
    pub meeting: Option<Meeting>,
    pub participants: Vec<Participant>,
    pub streams: HashMap<String, Presence>,
}

#[derive(Clone, Debug, Default)]
pub struct RoomPatch {
    pub topic: Option<String>,
    pub password: Option<String>,
    pub locked: Option<bool>,
    pub presenter: Option<String>,
}

#[derive(Clone, Debug)]
pub struct JoinResult {
    pub meeting_no: String,
    pub user_id: String,
    pub role: Role,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaGrant {
    pub room_id: String,
    pub meeting_no: String,
}

#[derive(Debug)]
pub struct Command<T> {
    pub value: T,
    pub event: Option<RoomEvent>,
}

enum Change {
    None,
    Persist,
    Snapshot(String),
    Message(String, Message),
}

pub struct Store {
    inner: RwLock<Inner>,
    data_file: Option<PathBuf>,
}

impl Store {
    pub fn memory() -> Self {
        Self {
            inner: RwLock::new(Inner::default()),
            data_file: None,
        }
    }

    pub async fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if path == Path::new(":memory:") {
            return Ok(Self::memory());
        }

        let data = match tokio::fs::read(path).await {
            Ok(bytes) => serde_json::from_slice::<Data>(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Data::default(),
            Err(error) => return Err(error.into()),
        };
        if data.version != DATA_VERSION {
            return Err(StoreError::InvalidData(format!(
                "unsupported version {}, expected {DATA_VERSION}",
                data.version
            )));
        }
        for (room_id, meeting_no) in &data.current {
            let meeting = data
                .meetings
                .get(meeting_no)
                .ok_or_else(|| StoreError::InvalidData(format!("missing meeting {meeting_no}")))?;
            if meeting.room_id != *room_id
                || meeting.ended_at.is_some()
                || !data.rooms.contains_key(room_id)
            {
                return Err(StoreError::InvalidData(format!(
                    "invalid current meeting {meeting_no} for room {room_id}"
                )));
            }
        }

        let now = now_secs();
        let mut inner = Inner {
            data,
            ..Inner::default()
        };
        for (meeting_no, participants) in &inner.data.participants {
            for participant in participants
                .iter()
                .filter(|participant| participant.leave_at.is_none())
            {
                inner
                    .last_seen
                    .insert((meeting_no.clone(), participant.user_id.clone()), now);
            }
        }
        Ok(Self {
            inner: RwLock::new(inner),
            data_file: Some(path.to_path_buf()),
        })
    }

    async fn persist(&self, data: Data) -> Result<(), StoreError> {
        let Some(path) = self.data_file.clone() else {
            return Ok(());
        };
        tokio::task::spawn_blocking(move || write_atomic(&path, &data)).await??;
        Ok(())
    }

    async fn persistent_command<T, F>(&self, command: F) -> Result<Command<T>, StoreError>
    where
        F: FnOnce(&mut Inner) -> Result<(T, Change), StoreError>,
    {
        let mut guard = self.inner.write().await;
        let mut next = guard.clone();
        let (value, change) = command(&mut next)?;
        if matches!(change, Change::None) {
            return Ok(Command { value, event: None });
        }

        let event = match change {
            Change::None => None,
            Change::Persist => None,
            Change::Snapshot(room_id) => {
                let revision = next.next_revision(&room_id);
                Some(RoomEvent::snapshot(
                    &room_id,
                    next.snapshot_at(&room_id, revision)?,
                ))
            }
            Change::Message(room_id, message) => {
                let revision = next.next_revision(&room_id);
                Some(RoomEvent::message(&room_id, revision, message))
            }
        };
        self.persist(next.data.clone()).await?;
        *guard = next;
        Ok(Command { value, event })
    }

    async fn insert_room(&self, room: Room) -> Result<bool, StoreError> {
        let command = self
            .persistent_command(move |inner| {
                if inner.data.rooms.contains_key(&room.room_id) {
                    return Ok((false, Change::None));
                }
                inner.data.rooms.insert(room.room_id.clone(), room.clone());
                Ok((true, Change::Persist))
            })
            .await?;
        Ok(command.value)
    }

    pub async fn create_room(&self, owner: &str) -> Result<Room, StoreError> {
        for _ in 0..ROOM_ID_ATTEMPTS {
            let room = Room {
                room_id: helper::add_split_symbol(&helper::gen_number_secret(9)),
                owner: owner.to_string(),
                created_at: now_secs(),
                ..Room::default()
            };
            let room_id = room.room_id.clone();
            if self.insert_room(room).await? {
                let state = self
                    .room_state(&room_id)
                    .await
                    .ok_or(StoreError::NotFound)?;
                return Ok(state.room);
            }
        }
        Err(StoreError::RoomIdExhausted)
    }

    pub async fn room_state(&self, room_id: &str) -> Option<RoomState> {
        self.inner.read().await.room_state_at(room_id, now_secs())
    }

    pub async fn snapshot(&self, room_id: &str) -> Result<Snapshot, StoreError> {
        let inner = self.inner.read().await;
        let revision = inner.revisions.get(room_id).copied().unwrap_or_default();
        inner.snapshot_at(room_id, revision)
    }

    pub async fn is_active(&self, room_id: &str, user_id: &str) -> bool {
        self.inner.read().await.active_in_room(room_id, user_id)
    }

    pub async fn require_active(&self, room_id: &str, user_id: &str) -> Result<(), StoreError> {
        let inner = self.inner.read().await;
        if !inner.data.rooms.contains_key(room_id) {
            return Err(StoreError::NotFound);
        }
        if !inner.active_in_room(room_id, user_id) {
            return Err(StoreError::NotParticipant);
        }
        Ok(())
    }

    pub async fn whip_authorization(&self, user_id: &str, stream_id: &str) -> Option<MediaGrant> {
        if user_id != stream_id {
            return None;
        }
        let inner = self.inner.read().await;
        inner.data.current.iter().find_map(|(room_id, meeting_no)| {
            inner
                .active_participant(meeting_no, user_id)
                .is_some()
                .then(|| MediaGrant {
                    room_id: room_id.clone(),
                    meeting_no: meeting_no.clone(),
                })
        })
    }

    pub async fn whep_authorization(&self, user_id: &str, target_id: &str) -> Option<MediaGrant> {
        let inner = self.inner.read().await;
        inner.data.current.iter().find_map(|(room_id, meeting_no)| {
            (inner.active_participant(meeting_no, user_id).is_some()
                && inner.active_participant(meeting_no, target_id).is_some())
            .then(|| MediaGrant {
                room_id: room_id.clone(),
                meeting_no: meeting_no.clone(),
            })
        })
    }

    pub async fn join(
        &self,
        room_id: &str,
        user_id: &str,
        name: Option<String>,
        password: Option<&str>,
    ) -> Result<Command<JoinResult>, StoreError> {
        self.persistent_command(|inner| {
            let room = inner
                .data
                .rooms
                .get(room_id)
                .cloned()
                .ok_or(StoreError::NotFound)?;
            let already_active = inner.active_in_room(room_id, user_id);
            let is_owner = room.owner == user_id;
            if !already_active
                && !is_owner
                && (room.locked
                    || (!room.password.is_empty() && password != Some(room.password.as_str())))
            {
                return Err(StoreError::Forbidden);
            }

            let now = now_secs();
            let meeting_no = match inner.data.current.get(room_id) {
                Some(meeting_no) => meeting_no.clone(),
                None => {
                    let meeting_no = uuid::Uuid::new_v4().to_string();
                    let meeting = Meeting {
                        meeting_no: meeting_no.clone(),
                        room_id: room_id.to_string(),
                        started_at: now,
                        ended_at: None,
                        max_concurrent: 0,
                    };
                    inner
                        .data
                        .current
                        .insert(room_id.to_string(), meeting_no.clone());
                    inner.data.meetings.insert(meeting_no.clone(), meeting);
                    meeting_no
                }
            };
            let role = if is_owner { Role::Owner } else { Role::Member };
            let name = name
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| user_id.to_string());
            let participants = inner
                .data
                .participants
                .entry(meeting_no.clone())
                .or_default();
            if let Some(participant) = participants
                .iter_mut()
                .find(|participant| participant.user_id == user_id)
            {
                participant.leave_at = None;
                participant.name = name.clone();
                participant.role = role.clone();
            } else {
                participants.push(Participant {
                    user_id: user_id.to_string(),
                    name: name.clone(),
                    role: role.clone(),
                    join_at: now,
                    leave_at: None,
                });
            }
            inner
                .last_seen
                .insert((meeting_no.clone(), user_id.to_string()), now);
            let active = participants
                .iter()
                .filter(|participant| participant.leave_at.is_none())
                .count();
            if let Some(meeting) = inner.data.meetings.get_mut(&meeting_no) {
                meeting.max_concurrent = meeting.max_concurrent.max(active);
            }
            let result = JoinResult {
                meeting_no,
                user_id: user_id.to_string(),
                role,
                name,
            };
            Ok((result, Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn leave(&self, room_id: &str, user_id: &str) -> Result<Command<()>, StoreError> {
        self.persistent_command(|inner| {
            if !inner.data.rooms.contains_key(room_id) {
                return Err(StoreError::NotFound);
            }
            let Some(meeting_no) = inner.data.current.get(room_id).cloned() else {
                return Ok(((), Change::None));
            };
            if inner.active_participant(&meeting_no, user_id).is_none() {
                return Ok(((), Change::None));
            }
            let now = now_secs();
            if let Some(participants) = inner.data.participants.get_mut(&meeting_no) {
                if let Some(participant) = participants
                    .iter_mut()
                    .find(|participant| participant.user_id == user_id)
                {
                    participant.leave_at = Some(now);
                }
            }
            inner
                .last_seen
                .remove(&(meeting_no.clone(), user_id.to_string()));
            if let Some(presence) = inner.presence.get_mut(&meeting_no) {
                presence.remove(user_id);
            }
            let has_active = inner
                .data
                .participants
                .get(&meeting_no)
                .is_some_and(|participants| {
                    participants
                        .iter()
                        .any(|participant| participant.leave_at.is_none())
                });
            if !has_active {
                inner.end_meeting(room_id, &meeting_no, now);
            }
            Ok(((), Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn end(&self, room_id: &str, user_id: &str) -> Result<Command<()>, StoreError> {
        self.persistent_command(|inner| {
            let room = inner.data.rooms.get(room_id).ok_or(StoreError::NotFound)?;
            if room.owner != user_id {
                return Err(StoreError::Forbidden);
            }
            let Some(meeting_no) = inner.data.current.get(room_id).cloned() else {
                return Ok(((), Change::None));
            };
            inner.end_meeting(room_id, &meeting_no, now_secs());
            Ok(((), Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn kick(
        &self,
        room_id: &str,
        owner_id: &str,
        target_id: &str,
    ) -> Result<Command<()>, StoreError> {
        self.persistent_command(|inner| {
            let room = inner.data.rooms.get(room_id).ok_or(StoreError::NotFound)?;
            if room.owner != owner_id {
                return Err(StoreError::Forbidden);
            }
            if target_id == owner_id {
                return Err(StoreError::Invalid("cannot remove yourself"));
            }
            let Some(meeting_no) = inner.data.current.get(room_id).cloned() else {
                return Ok(((), Change::None));
            };
            let Some(target) = inner.active_participant(&meeting_no, target_id) else {
                return Ok(((), Change::None));
            };
            if target.role == Role::Owner {
                return Err(StoreError::Forbidden);
            }
            let now = now_secs();
            if let Some(participants) = inner.data.participants.get_mut(&meeting_no) {
                if let Some(participant) = participants
                    .iter_mut()
                    .find(|participant| participant.user_id == target_id)
                {
                    participant.leave_at = Some(now);
                }
            }
            inner
                .last_seen
                .remove(&(meeting_no.clone(), target_id.to_string()));
            if let Some(presence) = inner.presence.get_mut(&meeting_no) {
                presence.remove(target_id);
            }
            let has_active = inner
                .data
                .participants
                .get(&meeting_no)
                .is_some_and(|participants| {
                    participants
                        .iter()
                        .any(|participant| participant.leave_at.is_none())
                });
            if !has_active {
                inner.end_meeting(room_id, &meeting_no, now);
            }
            Ok(((), Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn update_room(
        &self,
        room_id: &str,
        owner_id: &str,
        patch: RoomPatch,
    ) -> Result<Command<Room>, StoreError> {
        self.persistent_command(|inner| {
            let room = inner
                .data
                .rooms
                .get_mut(room_id)
                .ok_or(StoreError::NotFound)?;
            if room.owner != owner_id {
                return Err(StoreError::Forbidden);
            }
            if let Some(topic) = patch.topic {
                room.topic = topic;
            }
            if let Some(password) = patch.password {
                room.password = password;
            }
            if let Some(locked) = patch.locked {
                room.locked = locked;
            }
            if let Some(presenter) = patch.presenter {
                room.presenter = presenter;
            }
            Ok((room.clone(), Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn mute(&self, room_id: &str, owner_id: &str) -> Result<Command<()>, StoreError> {
        self.persistent_command(|inner| {
            let room = inner
                .data
                .rooms
                .get_mut(room_id)
                .ok_or(StoreError::NotFound)?;
            if room.owner != owner_id {
                return Err(StoreError::Forbidden);
            }
            room.mute_all_at = now_millis();
            Ok(((), Change::Snapshot(room_id.to_string())))
        })
        .await
    }

    pub async fn set_presence(
        &self,
        room_id: &str,
        user_id: &str,
        presence: Presence,
    ) -> Result<Command<()>, StoreError> {
        let mut inner = self.inner.write().await;
        let room = inner.data.rooms.get(room_id).ok_or(StoreError::NotFound)?;
        if presence.screen
            && !room.presenter.is_empty()
            && room.presenter != user_id
            && room.owner != user_id
        {
            return Err(StoreError::Forbidden);
        }
        let meeting_no = inner
            .data
            .current
            .get(room_id)
            .cloned()
            .ok_or(StoreError::NoMeeting)?;
        if inner.active_participant(&meeting_no, user_id).is_none() {
            return Err(StoreError::NotParticipant);
        }
        let now = now_secs();
        inner
            .presence
            .entry(meeting_no.clone())
            .or_default()
            .insert(
                user_id.to_string(),
                TimedPresence {
                    value: presence,
                    updated_at: now,
                },
            );
        inner
            .last_seen
            .insert((meeting_no, user_id.to_string()), now);
        let revision = inner.next_revision(room_id);
        let event = RoomEvent::snapshot(room_id, inner.snapshot_at(room_id, revision)?);
        Ok(Command {
            value: (),
            event: Some(event),
        })
    }

    pub async fn add_message(
        &self,
        room_id: &str,
        user_id: &str,
        content: String,
    ) -> Result<Command<Message>, StoreError> {
        self.persistent_command(|inner| {
            if !inner.data.rooms.contains_key(room_id) {
                return Err(StoreError::NotFound);
            }
            let meeting_no = inner
                .data
                .current
                .get(room_id)
                .cloned()
                .ok_or(StoreError::NoMeeting)?;
            let participant = inner
                .active_participant(&meeting_no, user_id)
                .ok_or(StoreError::NotParticipant)?
                .clone();
            let message = Message {
                id: uuid::Uuid::new_v4().to_string(),
                user_id: user_id.to_string(),
                name: participant.name,
                content,
                ts: now_secs(),
            };
            let messages = inner.data.messages.entry(meeting_no).or_default();
            messages.push(message.clone());
            if messages.len() > MAX_MESSAGES_PER_MEETING {
                let overflow = messages.len() - MAX_MESSAGES_PER_MEETING;
                messages.drain(..overflow);
            }
            Ok((
                message.clone(),
                Change::Message(room_id.to_string(), message),
            ))
        })
        .await
    }

    pub async fn records_for_user(&self, user_id: &str) -> Vec<Record> {
        self.inner
            .read()
            .await
            .data
            .records
            .iter()
            .filter(|record| {
                record
                    .participants
                    .iter()
                    .any(|participant| participant.user_id == user_id)
            })
            .cloned()
            .collect()
    }

    pub async fn records_for_room(
        &self,
        room_id: &str,
        owner_id: &str,
    ) -> Result<Vec<Record>, StoreError> {
        let inner = self.inner.read().await;
        let room = inner.data.rooms.get(room_id).ok_or(StoreError::NotFound)?;
        if room.owner != owner_id {
            return Err(StoreError::Forbidden);
        }
        Ok(inner
            .data
            .records
            .iter()
            .filter(|record| record.room_id == room_id)
            .cloned()
            .collect())
    }

    pub async fn sweep(
        &self,
        now: i64,
        presence_ttl_secs: u64,
        participant_ttl_secs: u64,
    ) -> Result<Vec<RoomEvent>, StoreError> {
        let mut guard = self.inner.write().await;
        let mut next = guard.clone();
        let current = next.data.current.clone();
        let mut changed_rooms = Vec::new();
        let mut persistent = false;

        for (room_id, meeting_no) in current {
            let mut changed = false;
            if let Some(entries) = next.presence.get_mut(&meeting_no) {
                let before = entries.len();
                entries.retain(|_, presence| now - presence.updated_at < presence_ttl_secs as i64);
                changed |= entries.len() != before;
            }

            let stale = next
                .data
                .participants
                .get(&meeting_no)
                .map(|participants| {
                    participants
                        .iter()
                        .filter(|participant| {
                            participant.leave_at.is_none()
                                && next
                                    .last_seen
                                    .get(&(meeting_no.clone(), participant.user_id.clone()))
                                    .is_some_and(|last_seen| {
                                        now - *last_seen >= participant_ttl_secs as i64
                                    })
                        })
                        .map(|participant| participant.user_id.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !stale.is_empty() {
                persistent = true;
                changed = true;
                if let Some(participants) = next.data.participants.get_mut(&meeting_no) {
                    for participant in participants
                        .iter_mut()
                        .filter(|participant| stale.contains(&participant.user_id))
                    {
                        participant.leave_at = Some(now);
                    }
                }
                for user_id in stale {
                    next.last_seen
                        .remove(&(meeting_no.clone(), user_id.clone()));
                    if let Some(entries) = next.presence.get_mut(&meeting_no) {
                        entries.remove(&user_id);
                    }
                }
            }

            let has_active = next
                .data
                .participants
                .get(&meeting_no)
                .is_some_and(|participants| {
                    participants
                        .iter()
                        .any(|participant| participant.leave_at.is_none())
                });
            if !has_active {
                next.end_meeting(&room_id, &meeting_no, now);
                persistent = true;
                changed = true;
            }
            if changed {
                changed_rooms.push(room_id);
            }
        }

        if changed_rooms.is_empty() {
            return Ok(Vec::new());
        }
        let mut events = Vec::with_capacity(changed_rooms.len());
        for room_id in changed_rooms {
            let revision = next.next_revision(&room_id);
            events.push(RoomEvent::snapshot(
                &room_id,
                next.snapshot_at(&room_id, revision)?,
            ));
        }
        if persistent {
            self.persist(next.data.clone()).await?;
        }
        *guard = next;
        Ok(events)
    }
}

fn sync_directory(directory: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(directory)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
        Ok(())
    }
}

fn write_atomic(path: &Path, data: &Data) -> Result<(), StoreError> {
    write_atomic_with_sync(path, data, sync_directory)
}

fn write_atomic_with_sync<F>(path: &Path, data: &Data, sync: F) -> Result<(), StoreError>
where
    F: FnOnce(&Path) -> std::io::Result<()>,
{
    let bytes = serde_json::to_vec_pretty(data)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        std::fs::create_dir_all(parent)?;
    }
    let directory = parent.unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("woom.json");
    let temporary = directory.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    let result = (|| -> Result<(), StoreError> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        std::io::Write::write_all(&mut file, &bytes)?;
        std::io::Write::flush(&mut file)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        if let Err(error) = sync(directory) {
            tracing::warn!(
                "data file rename committed but directory sync for {} failed: {error}",
                directory.display()
            );
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("woom-store-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn data_file(&self) -> PathBuf {
            self.0.join("woom.json")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            if self.0.is_dir() {
                let _ = std::fs::remove_dir_all(&self.0);
            } else {
                let _ = std::fs::remove_file(&self.0);
            }
        }
    }

    async fn room_with_owner(store: &Store) -> String {
        store.create_room("owner").await.unwrap().room_id
    }

    #[tokio::test]
    async fn concurrent_first_join_creates_one_meeting() {
        let store = Arc::new(Store::memory());
        let room_id = room_with_owner(&store).await;
        let mut tasks = Vec::new();
        for index in 0..24 {
            let store = store.clone();
            let room_id = room_id.clone();
            tasks.push(tokio::spawn(async move {
                store
                    .join(&room_id, &format!("user-{index}"), None, None)
                    .await
                    .unwrap()
                    .value
                    .meeting_no
            }));
        }
        let mut meeting_nos = Vec::new();
        for task in tasks {
            meeting_nos.push(task.await.unwrap());
        }
        meeting_nos.sort();
        meeting_nos.dedup();
        assert_eq!(meeting_nos.len(), 1);
        let inner = store.inner.read().await;
        assert_eq!(inner.data.meetings.len(), 1);
        assert_eq!(inner.data.meetings[&meeting_nos[0]].max_concurrent, 24);
    }

    #[tokio::test]
    async fn end_leave_and_kick_are_idempotent_and_archive_once() {
        let store = Store::memory();
        let room_id = room_with_owner(&store).await;
        store.join(&room_id, "owner", None, None).await.unwrap();
        store.join(&room_id, "guest", None, None).await.unwrap();
        store.kick(&room_id, "owner", "guest").await.unwrap();
        assert!(store
            .kick(&room_id, "owner", "guest")
            .await
            .unwrap()
            .event
            .is_none());
        store.leave(&room_id, "guest").await.unwrap();
        store.end(&room_id, "owner").await.unwrap();
        assert!(store.end(&room_id, "owner").await.unwrap().event.is_none());
        assert_eq!(
            store
                .records_for_room(&room_id, "owner")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(store.snapshot(&room_id).await.unwrap().meeting_no.is_none());
    }

    #[tokio::test]
    async fn field_updates_and_mute_do_not_overwrite_each_other() {
        let store = Arc::new(Store::memory());
        let room_id = room_with_owner(&store).await;
        let first = {
            let store = store.clone();
            let room_id = room_id.clone();
            tokio::spawn(async move {
                store
                    .update_room(
                        &room_id,
                        "owner",
                        RoomPatch {
                            topic: Some("topic".to_string()),
                            password: Some("password".to_string()),
                            ..RoomPatch::default()
                        },
                    )
                    .await
            })
        };
        let second = {
            let store = store.clone();
            let room_id = room_id.clone();
            tokio::spawn(async move {
                store
                    .update_room(
                        &room_id,
                        "owner",
                        RoomPatch {
                            locked: Some(true),
                            presenter: Some("presenter".to_string()),
                            ..RoomPatch::default()
                        },
                    )
                    .await
            })
        };
        let mute = {
            let store = store.clone();
            let room_id = room_id.clone();
            tokio::spawn(async move { store.mute(&room_id, "owner").await })
        };
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        mute.await.unwrap().unwrap();
        let room = store.room_state(&room_id).await.unwrap().room;
        assert_eq!(room.topic, "topic");
        assert_eq!(room.password, "password");
        assert!(room.locked);
        assert_eq!(room.presenter, "presenter");
        assert!(room.mute_all_at > 0);
    }

    #[tokio::test]
    async fn concurrent_join_and_end_never_reopen_an_ended_meeting() {
        for _ in 0..16 {
            let store = Arc::new(Store::memory());
            let room_id = room_with_owner(&store).await;
            store.join(&room_id, "owner", None, None).await.unwrap();
            let barrier = Arc::new(tokio::sync::Barrier::new(3));
            let joining = {
                let store = store.clone();
                let room_id = room_id.clone();
                let barrier = barrier.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    store.join(&room_id, "guest", None, None).await.unwrap();
                })
            };
            let ending = {
                let store = store.clone();
                let room_id = room_id.clone();
                let barrier = barrier.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    store.end(&room_id, "owner").await.unwrap();
                })
            };
            barrier.wait().await;
            joining.await.unwrap();
            ending.await.unwrap();

            let inner = store.inner.read().await;
            let mut ended = 0;
            for (meeting_no, meeting) in &inner.data.meetings {
                let is_current = inner.data.current.get(&room_id) == Some(meeting_no);
                assert_eq!(is_current, meeting.ended_at.is_none());
                if meeting.ended_at.is_some() {
                    ended += 1;
                    assert!(inner.data.participants[meeting_no]
                        .iter()
                        .all(|participant| participant.leave_at.is_some()));
                }
            }
            assert_eq!(inner.data.records.len(), ended);
        }
    }

    #[tokio::test]
    async fn presence_expiry_is_separate_from_participant_reaping() {
        let store = Store::memory();
        let room_id = room_with_owner(&store).await;
        store.join(&room_id, "owner", None, None).await.unwrap();
        store
            .set_presence(&room_id, "owner", Presence::default())
            .await
            .unwrap();
        let now = now_secs();
        let events = store.sweep(now + 46, 45, 3600).await.unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].snapshot_ref().unwrap().streams.is_empty());
        assert!(store.is_active(&room_id, "owner").await);
        let events = store.sweep(now + 3601, 45, 3600).await.unwrap();
        assert_eq!(events.len(), 1);
        assert!(!store.is_active(&room_id, "owner").await);
        assert_eq!(
            store
                .records_for_room(&room_id, "owner")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn persistence_survives_restart_but_presence_does_not() {
        let directory = TestDir::new();
        let path = directory.data_file();
        let store = Store::open(&path).await.unwrap();
        let room_id = room_with_owner(&store).await;
        store
            .update_room(
                &room_id,
                "owner",
                RoomPatch {
                    password: Some("secret".to_string()),
                    ..RoomPatch::default()
                },
            )
            .await
            .unwrap();
        store.join(&room_id, "owner", None, None).await.unwrap();
        store
            .set_presence(&room_id, "owner", Presence::default())
            .await
            .unwrap();
        let before_heartbeat = tokio::fs::read(&path).await.unwrap();
        store
            .set_presence(&room_id, "owner", Presence::default())
            .await
            .unwrap();
        assert_eq!(before_heartbeat, tokio::fs::read(&path).await.unwrap());
        store
            .add_message(&room_id, "owner", "hello".to_string())
            .await
            .unwrap();
        drop(store);

        let reopened = Store::open(&path).await.unwrap();
        let state = reopened.room_state(&room_id).await.unwrap();
        assert_eq!(state.room.password, "secret");
        assert!(state.meeting.is_some());
        assert!(state.streams.is_empty());
        assert!(reopened.is_active(&room_id, "owner").await);
        assert_eq!(
            reopened.snapshot(&room_id).await.unwrap().messages[0].content,
            "hello"
        );
        reopened.end(&room_id, "owner").await.unwrap();
        drop(reopened);

        let reopened = Store::open(&path).await.unwrap();
        let state = reopened.room_state(&room_id).await.unwrap();
        assert!(state.meeting.is_none());
        let records = reopened.records_for_room(&room_id, "owner").await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].messages[0].content, "hello");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[tokio::test]
    async fn corrupt_and_unknown_version_files_fail_fast() {
        let directory = TestDir::new();
        let path = directory.data_file();
        tokio::fs::write(&path, b"not json").await.unwrap();
        assert!(matches!(Store::open(&path).await, Err(StoreError::Json(_))));
        tokio::fs::write(&path, br#"{"version":99}"#).await.unwrap();
        assert!(matches!(
            Store::open(&path).await,
            Err(StoreError::InvalidData(_))
        ));
    }

    #[test]
    fn directory_sync_failure_after_rename_is_a_committed_write() {
        let directory = TestDir::new();
        let path = directory.data_file();
        let mut sync_called = false;
        write_atomic_with_sync(&path, &Data::default(), |_| {
            sync_called = true;
            Err(std::io::Error::other("injected directory sync failure"))
        })
        .unwrap();
        assert!(sync_called);
        let data = serde_json::from_slice::<Data>(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(data.version, DATA_VERSION);
    }

    #[tokio::test]
    async fn failed_persistence_does_not_commit_memory() {
        let directory = TestDir::new();
        let path = directory.data_file();
        let store = Store::open(&path).await.unwrap();
        let room_id = room_with_owner(&store).await;
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&directory.0).unwrap();
        std::fs::write(&directory.0, b"not a directory").unwrap();
        let result = store.join(&room_id, "owner", None, None).await;
        assert!(result.is_err());
        assert!(store.room_state(&room_id).await.unwrap().meeting.is_none());
    }

    #[tokio::test]
    async fn insert_if_absent_never_overwrites_a_room() {
        let store = Store::memory();
        let room_id = room_with_owner(&store).await;
        let replacement = Room {
            room_id: room_id.clone(),
            owner: "attacker".to_string(),
            ..Room::default()
        };
        assert!(!store.insert_room(replacement).await.unwrap());
        assert_eq!(
            store.room_state(&room_id).await.unwrap().room.owner,
            "owner"
        );
    }
}
