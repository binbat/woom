use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const ADMIN_UNIQUE_KEY: &str = "admin";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RoomAdmin {
    pub owner: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub presenter: String,
    pub locked: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub room_id: String,
    #[serde(flatten)]
    pub admin: RoomAdmin,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub stream_id: String,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub streams: HashMap<String, Stream>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Stream {
    pub name: String,
    #[serde(skip)]
    pub token: String,
    pub state: String,
    pub audio: bool,
    pub video: bool,
    pub screen: bool,
}
