//! Streaming-STT WebSocket protocol and client.
//!
//! One WebSocket connection per speaker. The client (this bot) sends:
//!
//! - text `{"type":"start","sampleRate":16000,"channels":1,"format":"s16le","language":"auto"}`
//! - binary frames of PCM s16le 16 kHz mono (~100 ms = 3200 bytes each)
//! - text `{"type":"stop"}` on shutdown
//!
//! The server answers with JSON text frames:
//!
//! - `{"type":"ready"}` — the session is set up, audio may be sent
//! - `{"type":"partial","text":"..."}` — in-progress transcript of the current utterance
//! - `{"type":"final","text":"..."}` — committed transcript of a finished utterance
//! - `{"type":"error","message":"..."}` — recoverable server-side error
//!
//! Unknown message types are tolerated as [`ServerMessage::Unknown`] so the
//! protocol can grow without breaking this client.

use anyhow::{Context, Result};
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

/// Sample rate the STT server expects after [`crate::audio`] resampling.
pub const STT_SAMPLE_RATE: u32 = 16_000;
pub const STT_CHANNELS: u8 = 1;
pub const STT_FORMAT: &str = "s16le";
pub const STT_LANGUAGE: &str = "auto";

/// Messages sent from the bot to the STT server as JSON text frames.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMessage {
    Start {
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
        channels: u8,
        format: String,
        language: String,
    },
    Stop,
}

impl ClientMessage {
    /// The fixed `start` message for this bot's audio pipeline.
    pub fn start() -> Self {
        ClientMessage::Start {
            sample_rate: STT_SAMPLE_RATE,
            channels: STT_CHANNELS,
            format: STT_FORMAT.to_string(),
            language: STT_LANGUAGE.to_string(),
        }
    }
}

/// Messages received from the STT server as JSON text frames.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ServerMessage {
    Ready,
    Partial {
        text: String,
    },
    Final {
        text: String,
    },
    Error {
        message: String,
    },
    #[serde(other)]
    Unknown,
}

/// Factory for STT sessions; one session per speaker, reconnectable.
#[async_trait]
pub trait SttConnector: Send + Sync {
    async fn connect(&self) -> Result<(Box<dyn SttSender>, Box<dyn SttReceiver>)>;
}

/// Outbound half of an STT session.
#[async_trait]
pub trait SttSender: Send {
    /// Negotiate the audio format; must be sent before any PCM.
    async fn start(&mut self) -> Result<()>;
    /// Send one chunk of PCM s16le audio.
    async fn send_pcm(&mut self, pcm: &[u8]) -> Result<()>;
    /// Signal a graceful end of stream.
    async fn stop(&mut self) -> Result<()>;
    /// Close the transport after `stop`. Default: no-op.
    async fn close(&mut self) -> Result<()> {
        Ok(())
    }
}

/// Inbound half of an STT session.
#[async_trait]
pub trait SttReceiver: Send {
    /// Next server message; `Ok(None)` means the connection closed cleanly.
    async fn next(&mut self) -> Result<Option<ServerMessage>>;
}
/// [`SttConnector`] over a real WebSocket.
pub struct WsSttConnector {
    url: String,
}

impl WsSttConnector {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_string(),
        }
    }
}

#[async_trait]
impl SttConnector for WsSttConnector {
    async fn connect(&self) -> Result<(Box<dyn SttSender>, Box<dyn SttReceiver>)> {
        let (ws, _response) = connect_async(&self.url)
            .await
            .with_context(|| format!("connect STT websocket {}", self.url))?;
        let (sink, stream) = ws.split();
        Ok((
            Box::new(WsSttSender { sink }),
            Box::new(WsSttReceiver { stream }),
        ))
    }
}

type WsSink = futures_util::stream::SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
type WsStream = futures_util::stream::SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

struct WsSttSender {
    sink: WsSink,
}

impl WsSttSender {
    async fn send_message(&mut self, message: ClientMessage) -> Result<()> {
        let json = serde_json::to_string(&message).context("serialize STT client message")?;
        self.sink
            .send(Message::text(json))
            .await
            .context("send STT text frame")
    }
}

#[async_trait]
impl SttSender for WsSttSender {
    async fn start(&mut self) -> Result<()> {
        self.send_message(ClientMessage::start()).await
    }

    async fn send_pcm(&mut self, pcm: &[u8]) -> Result<()> {
        self.sink
            .send(Message::binary(pcm.to_vec()))
            .await
            .context("send STT binary frame")
    }

    async fn stop(&mut self) -> Result<()> {
        self.send_message(ClientMessage::Stop).await
    }

    async fn close(&mut self) -> Result<()> {
        self.sink.close().await.context("close STT websocket")
    }
}

struct WsSttReceiver {
    stream: WsStream,
}

#[async_trait]
impl SttReceiver for WsSttReceiver {
    async fn next(&mut self) -> Result<Option<ServerMessage>> {
        loop {
            match self.stream.next().await {
                Some(Ok(Message::Text(text))) => {
                    let message = serde_json::from_str(&text)
                        .with_context(|| format!("parse STT server message: {text}"))?;
                    return Ok(Some(message));
                }
                // Ping/Pong are answered automatically by tungstenite; binary
                // frames are not part of the protocol. Skip both.
                Some(Ok(_)) => continue,
                Some(Err(error)) => return Err(error).context("receive STT frame"),
                None => return Ok(None),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_message_serializes_to_protocol_json() {
        let json = serde_json::to_value(ClientMessage::start()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "type": "start",
                "sampleRate": 16000,
                "channels": 1,
                "format": "s16le",
                "language": "auto",
            })
        );
    }

    #[test]
    fn stop_message_serializes_to_protocol_json() {
        let json = serde_json::to_string(&ClientMessage::Stop).unwrap();
        assert_eq!(json, r#"{"type":"stop"}"#);
    }

    #[test]
    fn parses_ready_message() {
        let msg: ServerMessage = serde_json::from_str(r#"{"type":"ready"}"#).unwrap();
        assert_eq!(msg, ServerMessage::Ready);
    }

    #[test]
    fn parses_partial_message() {
        let msg: ServerMessage =
            serde_json::from_str(r#"{"type":"partial","text":"hello wor"}"#).unwrap();
        assert_eq!(
            msg,
            ServerMessage::Partial {
                text: "hello wor".to_string()
            }
        );
    }

    #[test]
    fn parses_final_message() {
        let msg: ServerMessage =
            serde_json::from_str(r#"{"type":"final","text":"hello world"}"#).unwrap();
        assert_eq!(
            msg,
            ServerMessage::Final {
                text: "hello world".to_string()
            }
        );
    }

    #[test]
    fn parses_error_message() {
        let msg: ServerMessage =
            serde_json::from_str(r#"{"type":"error","message":"decoder exploded"}"#).unwrap();
        assert_eq!(
            msg,
            ServerMessage::Error {
                message: "decoder exploded".to_string()
            }
        );
    }

    #[test]
    fn tolerates_unknown_fields() {
        let msg: ServerMessage =
            serde_json::from_str(r#"{"type":"partial","text":"hi","confidence":0.9}"#).unwrap();
        assert_eq!(
            msg,
            ServerMessage::Partial {
                text: "hi".to_string()
            }
        );
    }

    #[test]
    fn unknown_message_type_maps_to_unknown() {
        let msg: ServerMessage = serde_json::from_str(r#"{"type":"vad","level":0.5}"#).unwrap();
        assert_eq!(msg, ServerMessage::Unknown);
    }

    #[test]
    fn malformed_json_is_an_error() {
        assert!(serde_json::from_str::<ServerMessage>("not json").is_err());
    }
}
