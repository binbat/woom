//! woom-caption: a caption bot for WOOM meetings.
//!
//! Polls WOOM's `GET /caption/streams` for participants currently publishing
//! audio, keeps one caption pipeline per speaker (see [`speaker`]), and
//! reconciles the running set with the polled state on every tick. WOOM
//! outages degrade to a warning and a retry on the next poll; pipelines of
//! vanished speakers are stopped gracefully.

mod audio;
mod speaker;
mod stt;
mod whep;
mod woom;

use std::collections::{HashMap, HashSet};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::stt::{SttConnector, WsSttConnector};
use crate::woom::{RoomSpeakers, SpeakerInfo, WoomClient};

/// Grace period for a stopped pipeline before its task is aborted.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
/// Minimum accepted length for the shared caption bearer token.
const MIN_CAPTION_TOKEN_LEN: usize = 16;

/// Bot configuration from environment variables. Secrets are never logged.
pub struct Config {
    /// WOOM base URL, e.g. `http://localhost:4000`.
    pub woom_url: String,
    /// Bearer token for WOOM's caption endpoints (required).
    pub caption_token: String,
    /// Live777 base URL, e.g. `http://localhost:7777`.
    pub live777_url: String,
    /// Optional static bearer token for Live777's WHIP/WHEP endpoints.
    pub live777_token: Option<String>,
    /// Streaming-STT WebSocket URL, e.g. `ws://127.0.0.1:6006`.
    pub stt_ws_url: String,
    /// How often to poll `GET /caption/streams`.
    pub poll_interval: Duration,
    /// Minimum interval between partial-caption posts per speaker.
    pub caption_min_interval: Duration,
}

impl Config {
    fn from_env() -> Result<Self> {
        let caption_token = std::env::var("CAPTION_TOKEN")
            .context("CAPTION_TOKEN is required: it must match the WOOM server's CAPTION_TOKEN")?;
        anyhow::ensure!(
            caption_token.len() >= MIN_CAPTION_TOKEN_LEN,
            "CAPTION_TOKEN is too short ({} bytes; need at least {MIN_CAPTION_TOKEN_LEN})",
            caption_token.len()
        );
        let stt_ws_url = env_or("STT_WS_URL", "ws://127.0.0.1:6006");
        anyhow::ensure!(
            stt_ws_url.starts_with("ws://") || stt_ws_url.starts_with("wss://"),
            "STT_WS_URL must be a ws:// or wss:// URL, got {stt_ws_url:?}"
        );
        Ok(Self {
            woom_url: env_or("WOOM_URL", "http://localhost:4000"),
            caption_token,
            live777_url: env_or("LIVE777_URL", "http://localhost:7777"),
            live777_token: std::env::var("LIVE777_TOKEN")
                .ok()
                .filter(|token| !token.is_empty()),
            stt_ws_url,
            poll_interval: Duration::from_secs(parse_env_u64("POLL_INTERVAL_SECS", 3)?),
            caption_min_interval: Duration::from_millis(parse_env_u64(
                "CAPTION_MIN_INTERVAL_MS",
                300,
            )?),
        })
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn parse_env_u64(key: &str, default: u64) -> Result<u64> {
    match std::env::var(key) {
        Ok(value) => value
            .parse::<u64>()
            .with_context(|| format!("{key} must be a non-negative integer, got {value:?}")),
        Err(_) => Ok(default),
    }
}

/// Identifies one speaker pipeline: one publishing participant in one room.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SpeakerKey {
    pub room_id: String,
    pub user_id: String,
}

struct SpeakerTask {
    cancel: CancellationToken,
    join: JoinHandle<()>,
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("woom_caption=info")),
        )
        .init();

    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(error) => {
            error!("invalid configuration: {error:#}");
            return ExitCode::from(2);
        }
    };
    info!(
        woom_url = %cfg.woom_url,
        live777_url = %cfg.live777_url,
        stt_ws_url = %cfg.stt_ws_url,
        poll_interval = ?cfg.poll_interval,
        caption_min_interval = ?cfg.caption_min_interval,
        "woom-caption starting"
    );
    match supervise(Arc::new(cfg)).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            error!("fatal error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

async fn supervise(cfg: Arc<Config>) -> Result<()> {
    let woom = WoomClient::new(&cfg.woom_url, &cfg.caption_token)?;
    let stt: Arc<dyn SttConnector> = Arc::new(WsSttConnector::new(&cfg.stt_ws_url));
    let mut running: HashMap<SpeakerKey, SpeakerTask> = HashMap::new();
    let mut poll = tokio::time::interval(cfg.poll_interval);
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = poll.tick() => {}
            _ = &mut shutdown => {
                info!("shutdown signal received");
                break;
            }
        }

        // Reap pipelines that exited on their own (e.g. WHEP session ended);
        // the diff below respawns them if the speaker is still listed.
        let finished: Vec<SpeakerKey> = running
            .iter()
            .filter(|(_, task)| task.join.is_finished())
            .map(|(key, _)| key.clone())
            .collect();
        for key in finished {
            if let Some(task) = running.remove(&key) {
                if !task.cancel.is_cancelled() {
                    warn!(
                        room_id = %key.room_id,
                        user_id = %key.user_id,
                        "speaker pipeline exited unexpectedly; will respawn if still listed"
                    );
                }
            }
        }

        let rooms = match woom.caption_streams().await {
            Ok(rooms) => rooms,
            Err(error) => {
                warn!("polling WOOM caption streams failed; retrying next tick: {error:#}");
                continue;
            }
        };
        let desired = desired_speakers(rooms);
        let running_keys: HashSet<SpeakerKey> = running.keys().cloned().collect();
        let diff = diff_speakers(&running_keys, &desired);

        for key in &diff.stop {
            if let Some(task) = running.remove(key) {
                info!(room_id = %key.room_id, user_id = %key.user_id, "stopping caption pipeline");
                task.cancel.cancel();
                spawn_reaper(key.clone(), task.join);
            }
        }
        for (key, info) in diff.spawn {
            info!(room_id = %key.room_id, user_id = %key.user_id, name = %info.name, "starting caption pipeline");
            let cancel = CancellationToken::new();
            let join = tokio::spawn(speaker::run(
                cfg.clone(),
                key.clone(),
                info.name,
                woom.clone(),
                stt.clone(),
                cancel.clone(),
            ));
            running.insert(key, SpeakerTask { cancel, join });
        }
    }

    // Graceful shutdown: cancel everything, then wait briefly per task.
    let tasks: Vec<SpeakerTask> = running.drain().map(|(_, task)| task).collect();
    for task in &tasks {
        task.cancel.cancel();
    }
    for task in tasks {
        let mut join = task.join;
        if tokio::time::timeout(SHUTDOWN_GRACE, &mut join)
            .await
            .is_err()
        {
            join.abort();
        }
    }
    Ok(())
}

/// Await a stopped pipeline's task; abort it if it misses the grace period.
fn spawn_reaper(key: SpeakerKey, mut join: JoinHandle<()>) {
    tokio::spawn(async move {
        if tokio::time::timeout(SHUTDOWN_GRACE, &mut join)
            .await
            .is_err()
        {
            warn!(
                room_id = %key.room_id,
                user_id = %key.user_id,
                "pipeline did not stop in time; aborting"
            );
            join.abort();
        }
    });
}

/// Flatten the polled room list into the desired speaker set.
fn desired_speakers(rooms: Vec<RoomSpeakers>) -> HashMap<SpeakerKey, SpeakerInfo> {
    let mut desired = HashMap::new();
    for room in rooms {
        for speaker in room.speakers {
            desired.insert(
                SpeakerKey {
                    room_id: room.room_id.clone(),
                    user_id: speaker.user_id.clone(),
                },
                speaker,
            );
        }
    }
    desired
}

/// The reconciliation plan between running pipelines and the polled state:
/// speakers to start (desired but not running) and to stop (running but no
/// longer desired). Output is sorted for deterministic behavior.
pub struct Diff {
    pub spawn: Vec<(SpeakerKey, SpeakerInfo)>,
    pub stop: Vec<SpeakerKey>,
}

pub fn diff_speakers(
    running: &HashSet<SpeakerKey>,
    desired: &HashMap<SpeakerKey, SpeakerInfo>,
) -> Diff {
    let mut spawn: Vec<(SpeakerKey, SpeakerInfo)> = desired
        .iter()
        .filter(|(key, _)| !running.contains(*key))
        .map(|(key, info)| (key.clone(), info.clone()))
        .collect();
    spawn.sort_by(|a, b| a.0.cmp(&b.0));
    let mut stop: Vec<SpeakerKey> = running
        .iter()
        .filter(|key| !desired.contains_key(*key))
        .cloned()
        .collect();
    stop.sort();
    Diff { spawn, stop }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    result = tokio::signal::ctrl_c() => {
                        if let Err(error) = result {
                            warn!("failed to listen for SIGINT: {error}");
                        }
                    }
                    _ = term.recv() => {}
                }
            }
            Err(error) => {
                warn!("failed to listen for SIGTERM, falling back to SIGINT only: {error}");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(room: &str, user: &str) -> SpeakerKey {
        SpeakerKey {
            room_id: room.to_string(),
            user_id: user.to_string(),
        }
    }

    fn info(user: &str) -> SpeakerInfo {
        SpeakerInfo {
            user_id: user.to_string(),
            name: format!("user-{user}"),
        }
    }

    #[test]
    fn diff_spawns_all_when_nothing_runs() {
        let running = HashSet::new();
        let desired = HashMap::from([(key("r1", "u1"), info("u1")), (key("r1", "u2"), info("u2"))]);
        let diff = diff_speakers(&running, &desired);
        assert_eq!(
            diff.spawn,
            vec![(key("r1", "u1"), info("u1")), (key("r1", "u2"), info("u2"))]
        );
        assert!(diff.stop.is_empty());
    }

    #[test]
    fn diff_stops_vanished_and_keeps_running() {
        let running = HashSet::from([key("r1", "u1"), key("r1", "u2")]);
        let desired = HashMap::from([(key("r1", "u1"), info("u1"))]);
        let diff = diff_speakers(&running, &desired);
        assert!(diff.spawn.is_empty());
        assert_eq!(diff.stop, vec![key("r1", "u2")]);
    }

    #[test]
    fn diff_handles_simultaneous_churn() {
        let running = HashSet::from([key("r1", "u1"), key("r2", "u2")]);
        let desired = HashMap::from([(key("r2", "u2"), info("u2")), (key("r2", "u3"), info("u3"))]);
        let diff = diff_speakers(&running, &desired);
        assert_eq!(diff.spawn, vec![(key("r2", "u3"), info("u3"))]);
        assert_eq!(diff.stop, vec![key("r1", "u1")]);
    }

    #[test]
    fn diff_is_empty_when_state_matches() {
        let running = HashSet::from([key("r1", "u1")]);
        let desired = HashMap::from([(key("r1", "u1"), info("u1"))]);
        let diff = diff_speakers(&running, &desired);
        assert!(diff.spawn.is_empty());
        assert!(diff.stop.is_empty());
    }

    #[test]
    fn diff_treats_same_user_in_different_rooms_as_distinct() {
        let running = HashSet::from([key("r1", "u1")]);
        let desired = HashMap::from([(key("r2", "u1"), info("u1"))]);
        let diff = diff_speakers(&running, &desired);
        assert_eq!(diff.spawn, vec![(key("r2", "u1"), info("u1"))]);
        assert_eq!(diff.stop, vec![key("r1", "u1")]);
    }

    #[test]
    fn diff_is_sorted_for_determinism() {
        let running = HashSet::new();
        let desired = HashMap::from([
            (key("r9", "u9"), info("u9")),
            (key("r1", "u1"), info("u1")),
            (key("r1", "u0"), info("u0")),
        ]);
        let diff = diff_speakers(&running, &desired);
        let spawned: Vec<&SpeakerKey> = diff.spawn.iter().map(|(key, _)| key).collect();
        let mut sorted = spawned.clone();
        sorted.sort();
        assert_eq!(spawned, sorted);
    }

    #[test]
    fn desired_speakers_flattens_rooms() {
        let rooms = vec![
            RoomSpeakers {
                room_id: "r1".to_string(),
                speakers: vec![info("u1"), info("u2")],
            },
            RoomSpeakers {
                room_id: "r2".to_string(),
                speakers: vec![],
            },
        ];
        let desired = desired_speakers(rooms);
        assert_eq!(desired.len(), 2);
        assert!(desired.contains_key(&key("r1", "u1")));
        assert!(desired.contains_key(&key("r1", "u2")));
    }
}
