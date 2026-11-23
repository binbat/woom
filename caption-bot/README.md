# woom-caption

A standalone caption bot for [WOOM](https://github.com/binbat/woom) meetings.
For every participant currently publishing audio in any WOOM room, it:

1. subscribes to their WebRTC audio stream directly from
   [Live777](https://github.com/binbat/live777) via WHEP,
2. decodes Opus to 16 kHz mono PCM,
3. streams the PCM over a WebSocket to an external streaming-STT server,
4. receives partial/final transcripts,
5. posts caption segments back to WOOM, which broadcasts them to browsers
   over SSE.

The whole pipeline is CPU-only; the reference STT model is bilingual
Chinese/English.

```
                        publish (WHIP)
   browser Alice ─────────────────────────┐
                                          ▼
   browser Bob ──────────────►  Live777 ──WHEP──► woom-caption ──WS──► STT server
        ▲                          (media :7777)      │               (sherpa-onnx)
        │                                             │ POST /room/{id}/caption
        └──────────── SSE captions ◄── WOOM ◄─────────┘
                                     (http :4000)
```

The bot learns whom to subscribe to by polling WOOM: `GET /caption/streams`
returns the rooms with ongoing meetings and their audio-publishing
participants, whose `userId` is the Live777 stream id. Both caption endpoints
are guarded by the WOOM server's `CAPTION_TOKEN` bearer token.

## Configuration

| Environment variable       | Default                 | Description |
|----------------------------|-------------------------|-------------|
| `CAPTION_TOKEN`            | *(required)*            | Bearer token for WOOM's caption endpoints; must match the server's `CAPTION_TOKEN`. Must be at least 16 bytes. |
| `WOOM_URL`                 | `http://localhost:4000` | WOOM base URL. |
| `LIVE777_URL`              | `http://localhost:7777` | Live777 base URL (WHEP). |
| `LIVE777_TOKEN`            | *(none)*                | Optional static bearer token for Live777. |
| `STT_WS_URL`               | `ws://127.0.0.1:6006`   | Streaming-STT WebSocket URL (see protocol below). |
| `POLL_INTERVAL_SECS`       | `3`                     | How often to poll `GET /caption/streams`. |
| `CAPTION_MIN_INTERVAL_MS`  | `300`                   | Minimum interval between partial-caption posts per speaker (finals are posted immediately). |

Logs go to stderr via `tracing`; set `RUST_LOG` (e.g. `RUST_LOG=woom_caption=debug`)
for more detail. Tokens are never logged.

## Quickstart

Prerequisites: a running WOOM server with `CAPTION_TOKEN` set, a running
Live777, and a C toolchain with `cmake` (the Opus dependency is vendored
and built from source — no system libopus needed).

```bash
# 1. Reference STT server (sherpa-onnx, streaming Zipformer, bilingual zh/en, int8 ~190 MB)
pip install -r scripts/requirements.txt
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
tar xf sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
python3 scripts/sherpa_ws_server.py    # listens on ws://127.0.0.1:6006

# 2. The bot
export CAPTION_TOKEN="<same value as the WOOM server's CAPTION_TOKEN>"
cargo run --release

# 3. Start a WOOM meeting in a browser, unmute, and speak — captions appear
#    for all participants in the room.
```

Any STT server implementing the protocol below can be used instead of the
reference server; point `STT_WS_URL` at it.

## Docker

Both components have their own images. The bot image is a small alpine
multi-stage build (`caption-bot/Dockerfile`); the STT image
(`caption-bot/scripts/Dockerfile`) is `python:3.13-slim` with sherpa-onnx
and the bilingual model baked in (~800 MB).

From the repository root, the `captions` compose profile builds and runs
both, expecting the WOOM server on the host (development) and Live777 from
the same compose project:

```bash
export CAPTION_TOKEN="<same value as the WOOM server's CAPTION_TOKEN>"
docker compose --profile captions up -d --build
```

For a split deployment point `WOOM_URL` / `LIVE777_URL` / `STT_WS_URL` at
the right hosts instead.

## STT WebSocket protocol

One WebSocket connection per speaker.

Client (this bot) → server:

- text `{"type":"start","sampleRate":16000,"channels":1,"format":"s16le","language":"auto"}`
- binary frames of PCM s16le, 16 kHz, mono, ~100 ms each (3200 bytes)
- text `{"type":"stop"}` on shutdown

Server → client (JSON text frames):

- `{"type":"ready"}` — session set up, audio may be sent
- `{"type":"partial","text":"..."}` — in-progress transcript of the current
  utterance; later partials replace earlier ones
- `{"type":"final","text":"..."}` — committed transcript of a finished
  utterance (endpoint detected, or the stream stopped)
- `{"type":"error","message":"..."}` — recoverable server-side error

Partial transcripts of one utterance are posted to WOOM under a shared segment
id (throttled to at most one post per `CAPTION_MIN_INTERVAL_MS`, latest wins),
so browsers revise the caption line in place; a final is posted immediately
and commits the segment, and the next utterance gets a fresh segment id.

`scripts/sherpa_ws_server.py` is the reference implementation of the server
side; its model, listen address, and thread count are configurable via
environment variables (see the header comment in the script).

## Swapping models / engines

The reference server auto-detects the sherpa-onnx engine from the model
directory contents — the bot and the WS protocol stay untouched either way:

- `encoder` + `decoder` + `joiner` ONNX files → transducer, e.g. the default
  bilingual (zh/en) streaming Zipformer
- `encoder` + `decoder` ONNX files, no joiner → streaming Paraformer, e.g.
  `sherpa-onnx-streaming-paraformer-bilingual-zh-en`
- anything else (including offline Paraformer packages with a single
  `model.onnx`, which are not streaming models) → startup fails with a clear
  message

Point `SHERPA_MODEL_DIR` at the model you want; int8 files are preferred when
both precisions are present (`SHERPA_INT8=0` to prefer fp32):

```bash
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
tar xf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
SHERPA_MODEL_DIR=./sherpa-onnx-streaming-paraformer-bilingual-zh-en \
  python3 scripts/sherpa_ws_server.py
```

The STT Docker image bakes the model in at build time; swap it with the
`MODEL_URL` / `MODEL_DIR` build ARGs:

```bash
docker build -t woom-stt:paraformer \
  --build-arg MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2 \
  --build-arg MODEL_DIR=sherpa-onnx-streaming-paraformer-bilingual-zh-en \
  scripts/
```

Which engine when? Keep the default **bilingual Zipformer** for mixed
Chinese/English rooms — on code-switched speech ("加了 ES 是一般现在时") it is
measurably better. Pick a **Paraformer** build for Mandarin-heavy rooms: the
paraformer-zh family is trained Mandarin-first (and handles dialects such as
Sichuanese/Henanese), trading some English accuracy for it. The strictly
Chinese-only `sherpa-onnx-paraformer-zh-*` packages are *offline* models and
cannot be used here — only `sherpa-onnx-streaming-*` packages work.

## Development

```bash
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Layout: `src/main.rs` (config + supervisor that diffs polled state against
running pipelines), `src/woom.rs` (WOOM caption API client), `src/whep.rs`
(WHEP subscriber on the `webrtc` crate), `src/audio.rs` (Opus decode, mono
downmix, 48→16 kHz resample, 100 ms chunking), `src/stt.rs` (protocol types +
mockable WebSocket client traits), `src/speaker.rs` (per-speaker pipeline:
reconnecting STT, partial throttling, segment ids), `scripts/` (reference STT
server).
