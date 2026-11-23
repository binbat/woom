//! Per-speaker caption pipeline: WHEP audio in -> Opus decode/resample ->
//! STT websocket -> caption posts back to WOOM.
//!
//! Partial transcripts of one utterance share a segment id and are throttled
//! to at most one post per `CAPTION_MIN_INTERVAL_MS` (latest wins); a final
//! transcript commits the segment immediately and a fresh id is generated for
//! the next utterance. STT disconnects are retried with exponential backoff
//! while the WHEP side keeps running; a WHEP failure terminates the pipeline
//! so the supervisor can respawn it.

use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::time::{sleep, Sleep};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, info_span, warn, Instrument};
use uuid::Uuid;

use crate::audio::{Chunker, OpusToPcm};
use crate::stt::{ServerMessage, SttConnector, SttReceiver, SttSender};
use crate::whep::WhepSubscriber;
use crate::woom::{CaptionSegment, WoomClient};
use crate::{Config, SpeakerKey};

/// PCM frame sent to the STT server: 100 ms of 16 kHz mono s16le.
const PCM_CHUNK_BYTES: usize = 1600 * 2;

const STT_RECONNECT_INITIAL: Duration = Duration::from_millis(500);
const STT_RECONNECT_MAX: Duration = Duration::from_secs(10);
const WHEP_CONNECT_INITIAL: Duration = Duration::from_secs(1);
const WHEP_CONNECT_MAX: Duration = Duration::from_secs(15);

type SleepOpt = Option<Pin<Box<Sleep>>>;

pub async fn run(
    cfg: Arc<Config>,
    key: SpeakerKey,
    speaker_name: String,
    woom: WoomClient,
    stt: Arc<dyn SttConnector>,
    cancel: CancellationToken,
) {
    let span = info_span!(
        "speaker",
        room_id = %key.room_id,
        user_id = %key.user_id,
        name = %speaker_name,
    );
    run_inner(cfg, key, woom, stt, cancel)
        .instrument(span)
        .await;
}

async fn run_inner(
    cfg: Arc<Config>,
    key: SpeakerKey,
    woom: WoomClient,
    stt: Arc<dyn SttConnector>,
    cancel: CancellationToken,
) {
    let Some(mut subscriber) = connect_whep_loop(&cfg, &key.user_id, &cancel).await else {
        return;
    };
    let mut decoder = match OpusToPcm::new() {
        Ok(decoder) => decoder,
        Err(error) => {
            warn!("audio pipeline init failed, giving up: {error:#}");
            subscriber.shutdown().await;
            return;
        }
    };
    info!("caption pipeline started");

    let mut chunker = Chunker::new(PCM_CHUNK_BYTES);
    let mut throttle = PartialThrottle::new(cfg.caption_min_interval);
    let mut segment_id = new_segment_id();

    let mut stt_tx: Option<Box<dyn SttSender>> = None;
    let mut stt_rx: Option<Box<dyn SttReceiver>> = None;
    let mut stt_backoff = Backoff::new(STT_RECONNECT_INITIAL, STT_RECONNECT_MAX);
    // Arm an immediate first connect attempt.
    let mut reconnect_at: SleepOpt = Some(Box::pin(sleep(Duration::ZERO)));
    let mut flush_at: SleepOpt = None;
    let mut decode_errors = 0u64;

    let whep_cancel = subscriber.cancel_token();

    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                debug!("pipeline cancelled");
                break;
            }
            _ = whep_cancel.cancelled() => {
                info!("WHEP session ended, terminating pipeline");
                break;
            }
            packet = subscriber.audio_rx.recv() => {
                let Some(payload) = packet else {
                    info!("WHEP audio channel closed");
                    break;
                };
                match decoder.process(&payload) {
                    Ok(pcm) => {
                        decode_errors = 0;
                        for chunk in chunker.push(&pcm) {
                            if let Some(tx) = stt_tx.as_mut() {
                                if let Err(error) = tx.send_pcm(&chunk).await {
                                    warn!("STT send failed, reconnecting: {error:#}");
                                    schedule_reconnect(
                                        &mut stt_tx,
                                        &mut stt_rx,
                                        &mut stt_backoff,
                                        &mut reconnect_at,
                                    );
                                }
                            }
                        }
                    }
                    Err(error) => {
                        decode_errors += 1;
                        if decode_errors <= 3 || decode_errors.is_multiple_of(100) {
                            warn!("Opus decode failed ({decode_errors} packets so far): {error:#}");
                        } else {
                            debug!("Opus decode failed: {error:#}");
                        }
                    }
                }
            }
            message = next_stt_message(&mut stt_rx), if stt_rx.is_some() => {
                match message {
                    Ok(Some(ServerMessage::Ready)) => debug!("STT session ready"),
                    Ok(Some(ServerMessage::Partial { text })) => {
                        if !text.trim().is_empty() {
                            match throttle.on_partial(text, Instant::now()) {
                                Some(text) => {
                                    flush_at = None;
                                    post_caption(&woom, &key, &segment_id, &text, false).await;
                                }
                                None => {
                                    if flush_at.is_none() {
                                        if let Some(delay) = throttle.flush_after(Instant::now()) {
                                            flush_at = Some(Box::pin(sleep(delay)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(Some(ServerMessage::Final { text })) => {
                        throttle.on_final();
                        flush_at = None;
                        if text.trim().is_empty() {
                            debug!("ignoring empty final transcript");
                        } else {
                            post_caption(&woom, &key, &segment_id, &text, true).await;
                        }
                        segment_id = new_segment_id();
                    }
                    Ok(Some(ServerMessage::Error { message })) => {
                        warn!("STT server error: {message}");
                    }
                    Ok(Some(ServerMessage::Unknown)) => {
                        debug!("ignoring unknown STT server message");
                    }
                    Ok(None) => {
                        warn!("STT connection closed, reconnecting");
                        schedule_reconnect(&mut stt_tx, &mut stt_rx, &mut stt_backoff, &mut reconnect_at);
                    }
                    Err(error) => {
                        warn!("STT receive failed, reconnecting: {error:#}");
                        schedule_reconnect(&mut stt_tx, &mut stt_rx, &mut stt_backoff, &mut reconnect_at);
                    }
                }
            }
            _ = poll_sleep(&mut reconnect_at), if reconnect_at.is_some() => {
                reconnect_at = None;
                match stt.connect().await {
                    Ok((mut tx, rx)) => match tx.start().await {
                        Ok(()) => {
                            info!("STT session connected");
                            stt_tx = Some(tx);
                            stt_rx = Some(rx);
                            stt_backoff.reset();
                        }
                        Err(error) => {
                            warn!("STT start failed, reconnecting: {error:#}");
                            schedule_reconnect(&mut stt_tx, &mut stt_rx, &mut stt_backoff, &mut reconnect_at);
                        }
                    },
                    Err(error) => {
                        warn!("STT connect failed, retrying: {error:#}");
                        schedule_reconnect(&mut stt_tx, &mut stt_rx, &mut stt_backoff, &mut reconnect_at);
                    }
                }
            }
            _ = poll_sleep(&mut flush_at), if flush_at.is_some() => {
                flush_at = None;
                if let Some(text) = throttle.flush(Instant::now()) {
                    post_caption(&woom, &key, &segment_id, &text, false).await;
                }
            }
        }
    }

    // Graceful shutdown: flush the tail of buffered audio, say goodbye to the
    // STT server, hang up the WHEP session.
    if let Some(tx) = stt_tx.as_mut() {
        if let Some(remaining) = chunker.flush() {
            let _ = tx.send_pcm(&remaining).await;
        }
        let _ = tx.stop().await;
        let _ = tx.close().await;
    }
    subscriber.shutdown().await;
    info!("caption pipeline stopped");
}

async fn next_stt_message(
    stt_rx: &mut Option<Box<dyn SttReceiver>>,
) -> anyhow::Result<Option<ServerMessage>> {
    match stt_rx.as_mut() {
        Some(rx) => rx.next().await,
        None => std::future::pending().await,
    }
}

async fn poll_sleep(sleep_opt: &mut SleepOpt) {
    match sleep_opt.as_mut() {
        Some(sleep) => sleep.await,
        None => std::future::pending().await,
    }
}

fn schedule_reconnect(
    stt_tx: &mut Option<Box<dyn SttSender>>,
    stt_rx: &mut Option<Box<dyn SttReceiver>>,
    backoff: &mut Backoff,
    reconnect_at: &mut SleepOpt,
) {
    *stt_tx = None;
    *stt_rx = None;
    let delay = backoff.next_delay();
    debug!("next STT reconnect attempt in {delay:?}");
    *reconnect_at = Some(Box::pin(sleep(delay)));
}

/// WHEP subscribe with exponential backoff until success or cancellation.
async fn connect_whep_loop(
    cfg: &Config,
    stream_id: &str,
    cancel: &CancellationToken,
) -> Option<WhepSubscriber> {
    let mut backoff = Backoff::new(WHEP_CONNECT_INITIAL, WHEP_CONNECT_MAX);
    loop {
        if cancel.is_cancelled() {
            return None;
        }
        match WhepSubscriber::connect(&cfg.live777_url, stream_id, cfg.live777_token.as_deref())
            .await
        {
            Ok(subscriber) => {
                info!(stream_id, "WHEP subscribed");
                return Some(subscriber);
            }
            Err(error) => {
                let delay = backoff.next_delay();
                warn!("WHEP subscribe failed, retrying in {delay:?}: {error:#}");
                tokio::select! {
                    _ = cancel.cancelled() => return None,
                    _ = sleep(delay) => {}
                }
            }
        }
    }
}

async fn post_caption(
    woom: &WoomClient,
    key: &SpeakerKey,
    segment_id: &str,
    text: &str,
    is_final: bool,
) {
    let segment = CaptionSegment {
        id: segment_id.to_string(),
        user_id: key.user_id.clone(),
        text: text.to_string(),
        is_final,
    };
    if let Err(error) = woom.post_caption(&key.room_id, &segment).await {
        warn!(is_final, "posting caption failed (dropped): {error:#}");
    }
}

fn new_segment_id() -> String {
    Uuid::new_v4().to_string()
}

/// Rate-limits partial transcripts: at most one post per `min_interval`,
/// and when several partials arrive inside the window only the latest is
/// kept for the throttled flush. Finals bypass the throttle entirely
/// (`on_final` also resets it, so the next utterance starts unthrottled).
pub struct PartialThrottle {
    min_interval: Duration,
    last_sent: Option<Instant>,
    pending: Option<String>,
}

impl PartialThrottle {
    pub fn new(min_interval: Duration) -> Self {
        Self {
            min_interval,
            last_sent: None,
            pending: None,
        }
    }

    /// A partial transcript arrived. `Some(text)` means post it immediately;
    /// `None` means it was throttled and stored as pending (latest wins).
    pub fn on_partial(&mut self, text: String, now: Instant) -> Option<String> {
        match self.last_sent {
            Some(last) if now.duration_since(last) < self.min_interval => {
                self.pending = Some(text);
                None
            }
            _ => {
                self.last_sent = Some(now);
                self.pending = None;
                Some(text)
            }
        }
    }

    /// Delay after which the pending partial may be flushed, if any.
    pub fn flush_after(&self, now: Instant) -> Option<Duration> {
        self.pending.as_ref()?;
        let elapsed = self
            .last_sent
            .map(|last| now.duration_since(last))
            .unwrap_or(self.min_interval);
        Some(self.min_interval.saturating_sub(elapsed))
    }

    /// Take the pending partial once the flush timer fired.
    pub fn flush(&mut self, now: Instant) -> Option<String> {
        let text = self.pending.take()?;
        self.last_sent = Some(now);
        Some(text)
    }

    /// A final transcript commits the segment: drop any pending partial and
    /// reset the rate limiter for the next utterance.
    pub fn on_final(&mut self) {
        self.pending = None;
        self.last_sent = None;
    }
}

/// Exponential backoff with a cap; `reset` after a success.
pub struct Backoff {
    initial: Duration,
    current: Duration,
    max: Duration,
}

impl Backoff {
    pub fn new(initial: Duration, max: Duration) -> Self {
        Self {
            initial,
            current: initial,
            max,
        }
    }

    pub fn next_delay(&mut self) -> Duration {
        let delay = self.current;
        self.current = (self.current * 2).min(self.max);
        delay
    }

    pub fn reset(&mut self) {
        self.current = self.initial;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Duration = Duration::from_millis(300);

    #[test]
    fn first_partial_posts_immediately() {
        let mut throttle = PartialThrottle::new(MIN);
        let now = Instant::now();
        assert_eq!(throttle.on_partial("a".into(), now), Some("a".to_string()));
    }

    #[test]
    fn partial_within_window_is_throttled_and_pending() {
        let mut throttle = PartialThrottle::new(MIN);
        let t0 = Instant::now();
        assert!(throttle.on_partial("a".into(), t0).is_some());
        assert_eq!(
            throttle.on_partial("ab".into(), t0 + Duration::from_millis(100)),
            None
        );
        let remaining = throttle
            .flush_after(t0 + Duration::from_millis(100))
            .unwrap();
        assert_eq!(remaining, Duration::from_millis(200));
        assert_eq!(
            throttle.flush(t0 + Duration::from_millis(300)),
            Some("ab".to_string())
        );
        assert_eq!(throttle.flush(t0 + Duration::from_millis(400)), None);
    }

    #[test]
    fn latest_partial_wins_within_window() {
        let mut throttle = PartialThrottle::new(MIN);
        let t0 = Instant::now();
        throttle.on_partial("a".into(), t0);
        throttle.on_partial("ab".into(), t0 + Duration::from_millis(50));
        throttle.on_partial("abc".into(), t0 + Duration::from_millis(150));
        assert_eq!(
            throttle.flush(t0 + Duration::from_millis(300)),
            Some("abc".to_string())
        );
    }

    #[test]
    fn partial_after_window_posts_immediately_and_discards_pending() {
        let mut throttle = PartialThrottle::new(MIN);
        let t0 = Instant::now();
        throttle.on_partial("a".into(), t0);
        throttle.on_partial("ab".into(), t0 + Duration::from_millis(50));
        assert_eq!(
            throttle.on_partial("abc".into(), t0 + Duration::from_millis(400)),
            Some("abc".to_string())
        );
        assert_eq!(throttle.flush_after(t0 + Duration::from_millis(400)), None);
    }

    #[test]
    fn flush_without_pending_is_none() {
        let mut throttle = PartialThrottle::new(MIN);
        assert_eq!(throttle.flush(Instant::now()), None);
        assert_eq!(throttle.flush_after(Instant::now()), None);
    }

    #[test]
    fn final_clears_pending_and_resets_window() {
        let mut throttle = PartialThrottle::new(MIN);
        let t0 = Instant::now();
        throttle.on_partial("a".into(), t0);
        throttle.on_partial("ab".into(), t0 + Duration::from_millis(50));
        throttle.on_final();
        assert_eq!(throttle.flush(t0 + Duration::from_millis(400)), None);
        // The next utterance's first partial posts immediately.
        assert_eq!(
            throttle.on_partial("next".into(), t0 + Duration::from_millis(100)),
            Some("next".to_string())
        );
    }

    #[test]
    fn zero_interval_never_throttles() {
        let mut throttle = PartialThrottle::new(Duration::ZERO);
        let now = Instant::now();
        assert!(throttle.on_partial("a".into(), now).is_some());
        assert!(throttle.on_partial("b".into(), now).is_some());
    }

    #[test]
    fn backoff_doubles_until_cap_and_resets() {
        let mut backoff = Backoff::new(Duration::from_secs(1), Duration::from_secs(4));
        assert_eq!(backoff.next_delay(), Duration::from_secs(1));
        assert_eq!(backoff.next_delay(), Duration::from_secs(2));
        assert_eq!(backoff.next_delay(), Duration::from_secs(4));
        assert_eq!(backoff.next_delay(), Duration::from_secs(4));
        backoff.reset();
        assert_eq!(backoff.next_delay(), Duration::from_secs(1));
    }
}
