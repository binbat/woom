//! WHEP subscriber: pulls one participant's audio stream from Live777 and
//! forwards Opus RTP payloads to an mpsc channel.
//!
//! Signaling follows the Live777 API (`POST /whep/{streamId}` with a
//! non-trickle SDP offer -> `201 Created` with the SDP answer and a `Location`
//! header for the session resource; `DELETE` the session URL to hang up).
//! ICE servers advertised in `Link: ...; rel="ice-server"` response headers
//! are applied before the answer, mirroring Live777's own clients.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::header::{self, HeaderMap};
use reqwest::StatusCode;
use reqwest::Url;
use rtc::rtp_transceiver::rtp_sender::RtpCodecKind;
use tokio::sync::{mpsc, Notify};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};
use webrtc::media_stream::track_remote::{TrackRemote, TrackRemoteEvent};
use webrtc::peer_connection::{
    MediaEngine, PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler,
    RTCConfigurationBuilder, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionState,
    RTCSessionDescription, Registry,
};
use webrtc::rtp_transceiver::{RTCRtpTransceiverDirection, RTCRtpTransceiverInit};

/// ICE gathering is bounded; partial candidates beat none when gathering stalls.
const ICE_GATHER_TIMEOUT: Duration = Duration::from_secs(3);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// In-flight audio buffer: 250 packets of 20 ms = 5 s of audio.
const AUDIO_CHANNEL_CAPACITY: usize = 250;
/// ICE UDP sockets to bind: loopback (same-host Live777) plus a wildcard that
/// the driver expands into one host candidate per usable LAN interface.
const ICE_UDP_ADDRS: [&str; 2] = ["127.0.0.1:0", "0.0.0.0:0"];

/// One established WHEP subscription. `audio_rx` yields Opus RTP payloads.
/// Call [`WhepSubscriber::shutdown`] to hang up; it is idempotent.
pub struct WhepSubscriber {
    peer: Arc<dyn PeerConnection>,
    cancel: CancellationToken,
    http: reqwest::Client,
    token: Option<String>,
    session_url: Option<String>,
    pub audio_rx: mpsc::Receiver<Vec<u8>>,
}

impl WhepSubscriber {
    /// Subscribe to `stream_id` on the Live777 at `live777_url`.
    ///
    /// Returns once the SDP exchange has completed; ICE connectivity and the
    /// first RTP packets arrive asynchronously afterwards.
    pub async fn connect(
        live777_url: &str,
        stream_id: &str,
        token: Option<&str>,
    ) -> Result<WhepSubscriber> {
        let http = reqwest::Client::builder()
            .connect_timeout(HTTP_CONNECT_TIMEOUT)
            .timeout(HTTP_REQUEST_TIMEOUT)
            .build()
            .context("build WHEP HTTP client")?;

        let cancel = CancellationToken::new();
        let gather_complete = Arc::new(Notify::new());
        let (audio_tx, audio_rx) = mpsc::channel(AUDIO_CHANNEL_CAPACITY);
        let handler = Arc::new(AudioTrackHandler {
            stream_id: stream_id.to_string(),
            cancel: cancel.clone(),
            gather_complete: gather_complete.clone(),
            audio_tx,
            track_seen: AtomicBool::new(false),
        });

        let mut media_engine = MediaEngine::default();
        media_engine
            .register_default_codecs()
            .context("register default codecs")?;

        let peer: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::<&'static str>::new()
                .with_media_engine(media_engine)
                .with_interceptor_registry(Registry::new())
                .with_handler(handler)
                .with_udp_addrs(ICE_UDP_ADDRS.to_vec())
                .with_configuration(RTCConfigurationBuilder::new().build())
                .build()
                .await
                .context("build PeerConnection")?,
        );

        peer.add_transceiver_from_kind(
            RtpCodecKind::Audio,
            Some(RTCRtpTransceiverInit {
                direction: RTCRtpTransceiverDirection::Recvonly,
                streams: vec![],
                send_encodings: vec![],
            }),
        )
        .await
        .context("add recvonly audio transceiver")?;

        let negotiate_result = negotiate(
            &peer,
            &http,
            live777_url,
            stream_id,
            token,
            &gather_complete,
        )
        .await;
        let session_url = match negotiate_result {
            Ok(session_url) => session_url,
            Err(error) => {
                cancel.cancel();
                let _ = peer.close().await;
                return Err(error);
            }
        };

        Ok(WhepSubscriber {
            peer,
            cancel,
            http,
            token: token.map(str::to_string),
            session_url: Some(session_url),
            audio_rx,
        })
    }

    /// Cancelled when the underlying connection fails or closes; pipelines
    /// should terminate (and let the supervisor respawn them) when it fires.
    pub fn cancel_token(&self) -> CancellationToken {
        self.cancel.clone()
    }

    /// Graceful hang-up: stop the peer connection, then `DELETE` the WHEP
    /// session resource. Errors are logged, not propagated.
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        if let Err(error) = self.peer.close().await {
            warn!("failed to close WHEP peer connection: {error}");
        }
        if let Some(session_url) = &self.session_url {
            let mut request = self.http.delete(session_url);
            if let Some(token) = &self.token {
                request = request.bearer_auth(token);
            }
            match request.send().await {
                Ok(response) if response.status() == StatusCode::NO_CONTENT => {
                    debug!("WHEP session deleted");
                }
                Ok(response) => {
                    warn!("DELETE WHEP session -> {}", response.status());
                }
                Err(error) => {
                    warn!("DELETE WHEP session failed: {error}");
                }
            }
        }
    }
}

/// SDP offer -> POST -> SDP answer; returns the session resource URL.
async fn negotiate(
    peer: &Arc<dyn PeerConnection>,
    http: &reqwest::Client,
    live777_url: &str,
    stream_id: &str,
    token: Option<&str>,
    gather_complete: &Notify,
) -> Result<String> {
    let offer_sdp = gather_offer_sdp(peer, gather_complete).await?;

    let whep_url = format!("{}/whep/{}", live777_url.trim_end_matches('/'), stream_id);
    let mut request = http
        .post(&whep_url)
        .header(header::CONTENT_TYPE, "application/sdp")
        .body(offer_sdp);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .with_context(|| format!("POST {whep_url}"))?;
    if response.status() != StatusCode::CREATED {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(256).collect();
        bail!("POST {whep_url} -> {status}: {snippet}");
    }

    let location = response
        .headers()
        .get(header::LOCATION)
        .context("WHEP response missing Location header")?
        .to_str()
        .context("WHEP Location header is not valid ASCII")?
        .to_string();
    let session_url = resolve_location(&whep_url, &location)?;
    let ice_servers = parse_ice_server_links(response.headers());
    let answer_sdp = response.text().await.context("read WHEP answer body")?;

    if !ice_servers.is_empty() {
        peer.set_configuration(
            RTCConfigurationBuilder::new()
                .with_ice_servers(ice_servers)
                .build(),
        )
        .await
        .context("apply ICE servers from WHEP Link headers")?;
    }

    let answer = RTCSessionDescription::answer(answer_sdp).context("parse WHEP SDP answer")?;
    peer.set_remote_description(answer)
        .await
        .context("set remote description")?;
    Ok(session_url)
}

/// Create an offer, gather candidates non-trickle, and return the local SDP.
async fn gather_offer_sdp(
    peer: &Arc<dyn PeerConnection>,
    gather_complete: &Notify,
) -> Result<String> {
    let offer = peer.create_offer(None).await.context("create offer")?;
    peer.set_local_description(offer)
        .await
        .context("set local description")?;

    let deadline = tokio::time::sleep(ICE_GATHER_TIMEOUT);
    tokio::pin!(deadline);
    let description = tokio::select! {
        _ = gather_complete.notified() => peer.local_description().await,
        _ = &mut deadline => {
            warn!(
                "ICE candidate gathering timed out after {:?}, using partial offer",
                ICE_GATHER_TIMEOUT
            );
            peer.local_description().await
        }
    };
    let description = description.context("no local description after ICE gathering")?;
    if !sdp_has_ice_candidate(&description.sdp) {
        bail!("ICE gathering produced no candidates");
    }
    Ok(description.sdp)
}

fn sdp_has_ice_candidate(sdp: &str) -> bool {
    sdp.lines().any(|line| line.starts_with("a=candidate:"))
}

/// Resolve the `Location` header against the WHEP endpoint URL. Live777 sends
/// an absolute path (`/session/{streamId}/{sessionId}`); absolute URLs pass
/// through unchanged.
fn resolve_location(base: &str, location: &str) -> Result<String> {
    let base = Url::parse(base).with_context(|| format!("parse WHEP URL {base}"))?;
    base.join(location)
        .map(|url| url.to_string())
        .with_context(|| format!("resolve WHEP Location {location}"))
}

/// ICE servers advertised via `Link: <uri>; rel="ice-server"` headers (WHEP).
fn parse_ice_server_links(headers: &HeaderMap) -> Vec<RTCIceServer> {
    let mut servers = Vec::new();
    for value in headers.get_all(header::LINK) {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for link in split_link_header(value) {
            if let Some(server) = parse_ice_server_link(&link) {
                servers.push(server);
            }
        }
    }
    servers
}

/// Split a Link header value on top-level commas (not inside `<...>` or
/// quotes).
fn split_link_header(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_angle = false;
    let mut in_quotes = false;
    for c in value.chars() {
        match c {
            '<' if !in_quotes => in_angle = true,
            '>' if !in_quotes => in_angle = false,
            '"' if !in_angle => in_quotes = !in_quotes,
            ',' if !in_angle && !in_quotes => {
                parts.push(std::mem::take(&mut current));
                continue;
            }
            _ => {}
        }
        current.push(c);
    }
    parts.push(current);
    parts
}

fn parse_ice_server_link(link: &str) -> Option<RTCIceServer> {
    let start = link.find('<')?;
    let end = link.find('>')?;
    if end < start {
        return None;
    }
    let uri = link[start + 1..end].to_string();
    let mut username = String::new();
    let mut credential = String::new();
    let mut is_ice_server = false;
    for param in link[end + 1..].split(';') {
        let Some((name, value)) = param.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"');
        match name.trim() {
            "rel" => is_ice_server = value == "ice-server",
            "username" => username = value.to_string(),
            "credential" => credential = value.to_string(),
            _ => {}
        }
    }
    is_ice_server.then_some(RTCIceServer {
        urls: vec![uri],
        username,
        credential,
    })
}

struct AudioTrackHandler {
    stream_id: String,
    cancel: CancellationToken,
    gather_complete: Arc<Notify>,
    audio_tx: mpsc::Sender<Vec<u8>>,
    track_seen: AtomicBool,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for AudioTrackHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            self.gather_complete.notify_one();
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        match state {
            RTCPeerConnectionState::Failed => {
                warn!(stream_id = %self.stream_id, "WHEP connection failed");
                self.cancel.cancel();
            }
            RTCPeerConnectionState::Closed => {
                info!(stream_id = %self.stream_id, "WHEP connection closed");
                self.cancel.cancel();
            }
            _ => debug!(stream_id = %self.stream_id, "WHEP connection state: {state}"),
        }
    }

    async fn on_track(&self, track: Arc<dyn TrackRemote>) {
        if track.kind().await != RtpCodecKind::Audio {
            debug!(stream_id = %self.stream_id, "ignoring non-audio WHEP track");
            return;
        }
        if self.track_seen.swap(true, Ordering::SeqCst) {
            warn!(stream_id = %self.stream_id, "ignoring duplicate audio track");
            return;
        }
        if let Some(ssrc) = track.ssrcs().await.first().copied() {
            if let Some(codec) = track.codec(ssrc).await {
                if !codec.mime_type.eq_ignore_ascii_case("audio/opus") {
                    warn!(
                        stream_id = %self.stream_id,
                        codec = %codec.mime_type,
                        "WHEP track codec is not Opus; decoding will fail"
                    );
                }
            }
        }

        let cancel = self.cancel.clone();
        let audio_tx = self.audio_tx.clone();
        let stream_id = self.stream_id.clone();
        tokio::spawn(async move {
            let mut dropped = 0u64;
            loop {
                tokio::select! {
                    event = track.poll() => match event {
                        Some(TrackRemoteEvent::OnRtpPacket(packet)) => {
                            let payload = packet.payload.to_vec();
                            match audio_tx.try_send(payload) {
                                Ok(()) => {}
                                Err(mpsc::error::TrySendError::Full(_)) => {
                                    dropped += 1;
                                    if dropped == 1 || dropped.is_multiple_of(100) {
                                        warn!(
                                            stream_id = %stream_id,
                                            "audio channel full, dropping RTP packets (total {dropped})"
                                        );
                                    }
                                }
                                Err(mpsc::error::TrySendError::Closed(_)) => break,
                            }
                        }
                        Some(TrackRemoteEvent::OnEnded) | None => break,
                        _ => {}
                    },
                    _ = cancel.cancelled() => break,
                }
            }
            debug!(stream_id = %stream_id, "WHEP audio RTP reader stopped");
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_absolute_and_relative_location() {
        assert_eq!(
            resolve_location("http://localhost:7777/whep/abc", "/session/abc/s1").unwrap(),
            "http://localhost:7777/session/abc/s1"
        );
        assert_eq!(
            resolve_location(
                "http://localhost:7777/whep/abc",
                "http://other.example.com:8888/session/abc/s1"
            )
            .unwrap(),
            "http://other.example.com:8888/session/abc/s1"
        );
    }

    #[test]
    fn detects_candidate_lines_in_sdp() {
        assert!(sdp_has_ice_candidate(
            "v=0\r\na=candidate:1 1 udp 1 127.0.0.1 9 typ host\r\n"
        ));
        assert!(!sdp_has_ice_candidate(
            "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        ));
    }

    #[test]
    fn splits_link_header_on_top_level_commas() {
        let value = r#"<stun:a.example.com>; rel="ice-server", <turn:b.example.com>; rel="ice-server"; username="u,1"; credential="p""#;
        let parts = split_link_header(value);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].contains("stun:a.example.com"));
        assert!(parts[1].contains("turn:b.example.com"));
    }

    #[test]
    fn parses_ice_server_links_like_live777_sends() {
        let mut headers = HeaderMap::new();
        headers.append(
            header::LINK,
            r#"<stun:stun.l.google.com:19302>; rel="ice-server""#
                .parse()
                .unwrap(),
        );
        headers.append(
            header::LINK,
            r#"<turn:turn.example.com>; rel="ice-server"; username="live777_username"; credential="live777_password""#
                .parse()
                .unwrap(),
        );
        headers.append(
            header::LINK,
            r#"<https://example.com/status>; rel="status""#.parse().unwrap(),
        );

        let servers = parse_ice_server_links(&headers);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].urls, vec!["stun:stun.l.google.com:19302"]);
        assert_eq!(servers[0].username, "");
        assert_eq!(servers[1].urls, vec!["turn:turn.example.com"]);
        assert_eq!(servers[1].username, "live777_username");
        assert_eq!(servers[1].credential, "live777_password");
    }

    #[test]
    fn garbage_link_headers_yield_no_ice_servers() {
        let mut headers = HeaderMap::new();
        headers.append(header::LINK, "not a link header".parse().unwrap());
        assert!(parse_ice_server_links(&headers).is_empty());
    }
}
