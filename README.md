<h1 align="center">
  <img src="./webapp/public/logo.svg" alt="WOOM" width="200">
  <br>WOOM<br>
</h1>

<div align="center">
    <a href="https://discord.gg/mtSpDNwCAz"><img src="https://img.shields.io/badge/-Discord-424549?style=social&logo=discord" height=25></a>
    &nbsp;
    <a href="https://t.me/binbatlib"><img src="https://img.shields.io/badge/-Telegram-red?style=social&logo=telegram" height=25></a>
    &nbsp;
    <a href="https://twitter.com/binbatlab"><img src="https://img.shields.io/badge/-Twitter-red?style=social&logo=x" height=25></a>
</div>

---

A self-hosted meeting service built on the [Live777](https://github.com/binbat/live777) WebRTC engine (WHIP/WHEP).

## Requirements

- Node.js 26 and npm
- Stable Rust with rustfmt and Clippy
- Live777/Liveion on port 7777
- Docker for the default Liveion service and container builds

Start Liveion:

```bash
docker compose up -d
```

## Development

Generate a secret once and keep it stable across restarts. Existing user tokens and room ownership depend on it.

```bash
export SECRET="$(openssl rand -hex 32)"
npm ci
npm run build
cargo run
```

`cargo run` serves the production WebApp and API on `http://localhost:4000`. The initial `npm run build` creates `static/dist`, which is required when compiling the backend.

For frontend development, run Vite in another terminal:

```bash
npm run dev
```

Vite listens on `http://localhost:5173` and proxies the API, browser logs, WHIP/WHEP and session signaling through the Rust server on port 4000.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET` | required | HS512 signing secret; at least 32 bytes, not a known default |
| `PORT` | `4000` | WOOM HTTP port |
| `LIVE777_URL` | `http://localhost:7777` | Upstream Live777/Liveion URL |
| `LIVE777_TOKEN` | empty | Optional upstream bearer token |
| `DATA_FILE` | `./data/woom.json` | Durable state file; `:memory:` disables persistence for tests |
| `LOG_READ_TOKEN` | empty | Optional admin token for reading browser diagnostics; at least 32 bytes when set |
| `CAPTION_TOKEN` | empty | Optional static token enabling the live-captions API used by `caption-bot/`; at least 32 bytes when set |
| `EVENTS_CABLE` | empty (disabled) | Optional opt-in (any value except empty/`0`/`false`) dual-push of room events over a Live777 cable datachannel alongside SSE; requires the Live777 cable messages API (merged, no release yet — dev compose and CI build a pinned live777 commit) and a single-node Live777 (cables do not bridge liveman cascade nodes) |
| `MINUTES_URL` | empty | Optional OpenAI-compatible chat-completions base URL (e.g. Ollama `http://localhost:11434/v1`) enabling `POST /room/{id}/records/{meetingNo}/minutes` |
| `MINUTES_MODEL` | empty | Model name for the minutes endpoint; required when `MINUTES_URL` is set |
| `MINUTES_API_KEY` | empty | Optional bearer token for the minutes upstream |
| `ADMIN_USER` | empty | Optional admin console username; both `ADMIN_USER` and `ADMIN_PASSWORD` must be set to enable the console |
| `ADMIN_PASSWORD` | empty | Admin console password; at least 16 bytes when set |

WOOM requires membership authorization for room events, chat, presence and media signaling. Room passwords and secrets are never included in API responses or startup logs.

### Browser diagnostics for AI analysis

The browser reports errors, warnings and WebRTC lifecycle events to WOOM. Set a separate admin token to enable the diagnostic export endpoint:

```bash
export LOG_READ_TOKEN="$(openssl rand -hex 32)"
curl -H "Authorization: Bearer $LOG_READ_TOKEN" \
  "http://localhost:4000/log?meetingId=123-456-789&limit=500" \
  -o woom-browser-log.ndjson
```

Filters include `meetingId`, `sessionId`, `level`, `since` (epoch milliseconds) and `limit`. The NDJSON output contains session and meeting identifiers, timestamps, event data, page URL and user agent, so it can be supplied directly to an AI assistant for troubleshooting.

`GET /log` is disabled when `LOG_READ_TOKEN` is unset and never accepts an ordinary user JWT. The in-memory buffer retains the most recent 5000 entries and is cleared on restart; long-term history remains available through the existing `client_log` service-log output. Exported data is redacted, but should still be treated as sensitive diagnostic material.

### Live captions

WOOM supports live meeting subtitles through an optional sidecar process, [`caption-bot/`](./caption-bot/README.md) (binary `woom-caption`). For every participant publishing audio, the bot subscribes to their Live777 stream over WHEP, decodes Opus, streams PCM to an external streaming speech-to-text server (a sherpa-onnx reference implementation is included; bilingual Chinese/English, CPU-only), and posts caption segments back to WOOM. Browsers receive them as `caption` SSE events and render an overlay. Partial segments are ephemeral; final segments are archived into the meeting record and exposed through the records APIs as the meeting transcript.

Enable the caption API on the server, then run the STT server and the bot — either directly (see [caption-bot/README.md](./caption-bot/README.md)) or with the `captions` compose profile, which builds both images:

```bash
export CAPTION_TOKEN="$(openssl rand -hex 32)"
# WOOM server runs with CAPTION_TOKEN set
docker compose --profile captions up -d --build
```

The caption endpoints are disabled when `CAPTION_TOKEN` is unset and never accept an ordinary user JWT.

With `MINUTES_URL`/`MINUTES_MODEL` configured, any meeting participant can generate two LLM artifacts from an archived transcript: Markdown minutes via `POST /room/{roomId}/records/{meetingNo}/minutes`, and a polished transcript (ASR errors fixed, punctuation restored, topic-segmented) via `POST /room/{roomId}/records/{meetingNo}/cleanup`. Each artifact is generated once and cached in the meeting record (`?force=true` regenerates). Any OpenAI-compatible endpoint works — for example DeepSeek (`MINUTES_URL=https://api.deepseek.com/v1`, `MINUTES_MODEL=deepseek-flash`) or a self-hosted Ollama — so transcripts never have to leave your infrastructure.

### Admin console

Setting `ADMIN_USER` and `ADMIN_PASSWORD` together enables a built-in admin console at `/admin` (API under `/api/admin/*`). Signing in issues a 12-hour admin token that is held in session storage only; admin tokens are distinct from meeting user JWTs and neither is accepted by the other's API.

The console manages meeting records across all rooms:

- list every archived meeting with its room, duration and content counters
- inspect a full record: transcript, chat messages and cached LLM artifacts
- replay a meeting as a merged chat + transcript timeline (play/pause, 1x/2x/4x)
- generate or regenerate minutes and polished transcripts (requires `MINUTES_URL`/`MINUTES_MODEL`)
- permanently delete records (records otherwise accumulate forever)

The admin API answers 404 while the variables are unset, and the credentials are read at startup — changing them requires a restart. Serve WOOM over HTTPS before exposing the console to a network.

### Data and deployment model

Rooms, meetings, participants, chat and meeting records are stored in an atomically replaced JSON file. Presence is ephemeral and is restored by client heartbeats after a restart.

The JSON store supports **one WOOM process only**. Do not share one file between replicas. Back up `DATA_FILE` and the configured `SECRET` together. A damaged or unknown-version data file prevents startup rather than being overwritten.

For Docker, `/data/woom.json` is the default and `/data` should be a persistent volume:

```bash
docker build -t woom .
docker volume create woom-data
docker run --rm --network woom -p 4000:4000 \
  -e SECRET \
  -e LIVE777_URL=http://live777:7777 \
  -e LOG_READ_TOKEN \
  -v woom-data:/data \
  woom
```

Only HTTP signaling is proxied through WOOM. WebRTC media still requires reachable ICE candidates. On NAT, Docker Desktop or public deployments, configure Live777's external candidates and UDP/TURN networking as appropriate; publishing only TCP port 7777 is not a general NAT solution.

For Fly.io, create the volume once in the configured region, set the secrets, then deploy:

```bash
fly volumes create woom_data --region nrt --size 1
fly secrets set SECRET="$(openssl rand -hex 32)"
fly secrets set LOG_READ_TOKEN="$(openssl rand -hex 32)"
fly secrets set LIVE777_TOKEN="your-upstream-token" # if required
fly deploy
```

## Release build

```bash
make
export SECRET="your-stable-production-secret"
./target/release/woom
```

`make` builds the WebApp before compiling the release binary. Cargo and npm both use their lockfiles in release and container builds.

## Tests

Format and lint the WebApp and E2E sources with Biome 2.6.4, ESLint and vue-tsc:

```bash
npm run format
npm run lint
```

Rust format, lint and unit/API/store tests:

```bash
npm run test:rust
```

Browser E2E tests use Chromium with fake media devices:

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
```

The E2E server uses a test-only secret and in-memory storage. By default, Playwright starts the newly built binary rather than reusing whatever is already listening on port 4000. For an explicitly verified running server, opt in with:

```bash
E2E_REUSE_SERVER=true npx playwright test
```

The suite covers meeting and chat flows, authorization boundaries, media lifecycle, reconnect/recovery, video frame progress and PWA offline behavior.
