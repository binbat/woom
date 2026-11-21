# AGENTS.md

Guidance for AI agents working on this repository.

## Project overview

WOOM is a self-hosted meeting service built on the
[Live777](https://github.com/binbat/live777) WebRTC engine (WHIP/WHEP).

- `src/` — Rust backend (axum). Serves the REST API (`/user/`, `/room/*`),
  reverse-proxies `/whip/*`, `/whep/*` and their `/session/*` resources to
  Live777, pushes room state over SSE (`/room/{id}/events`), and serves the
  WebApp. Media and room APIs require current active-participant
  authorization. SSE uses short-lived tickets from
  `POST /room/{id}/events/ticket`; `snapshot` and `message` events carry a
  per-room monotonically increasing `revision`.
- `src/store.rs` — Atomic domain commands and a single-process durable JSON
  store. Rooms, meeting instances, participants, chat and archived records
  are persisted with clone-on-write and atomic file replacement. Presence is
  ephemeral with a 45s TTL; participant offline reclamation uses a separate
  24h TTL. `DATA_FILE=:memory:` is available for tests. Do not run multiple
  processes against one JSON file.
- `src/config.rs` — Environment configuration. `SECRET` is required and must
  contain at least 32 bytes. Other variables: `PORT` 4000, `LIVE777_URL`,
  `LIVE777_TOKEN`, `DATA_FILE` (default `./data/woom.json`), and optional
  `LOG_READ_TOKEN` for admin-only diagnostic export. Never log secrets, JWTs,
  SSE ticket query strings or room passwords.
- `src/events.rs` — Per-room broadcast channels. Subscribe before taking the
  initial snapshot, deduplicate by revision, and recover from lag with a full
  snapshot. All state-changing API operations publish in commit order.
- Browser failures go to `POST /log` and are written as NDJSON on the
  `client_log` tracing target. Intake is intentionally anonymous but bounded
  and redacts sensitive fields. `GET /log` requires `LOG_READ_TOKEN` and exports
  the most recent 5000 in-memory entries as NDJSON with meeting/session filters
  for AI-assisted diagnosis. The buffer is cleared on restart.
- `webapp/` — Vue 3 + TypeScript + Vite + UnoCSS frontend (`<script setup>`
  SFCs). State uses module-level `ref`/`shallowRef` (`webapp/store/atoms.ts`),
  persisted settings (`webapp/store/setting.ts`), and localStorage for
  user/token (`webapp/lib/storage.ts`). Join passwords remain in memory only.
  Welcome/Meeting views are switched by `meetingId` in `webapp/app.vue`.
- WHIP/WHEP clients are framework-agnostic classes exposed through
  composables. Asynchronous start/stop/restart operations use generations so
  stale sessions cannot update current state. Both publishing and subscribing
  send the user bearer token; `/session/*` remains on the WOOM proxy.
- PWA: `webapp/public/sw.js` is a build-time template. Vite generates a
  content-versioned precache containing the app shell. Navigations are
  network-first; API/SSE/media signaling bypass the cache. Missing static
  assets return 404 rather than the SPA HTML fallback.
- `static/` — WebApp build output embedded into the Rust binary via rust-embed
  (`src/spa.rs`). `static/dist` is produced by `npm run build` and must exist
  before compiling.
- `tests/` — Playwright E2E tests, see below.

## Build and run

External dependency: Live777/Liveion on port 7777.

```bash
docker compose up -d
npm ci
export SECRET="$(openssl rand -hex 32)"
npm run build          # required before the first backend compile
cargo run              # backend + production WebApp on :4000
npm run dev            # optional Vite development server on :5173

make                   # WebApp -> static/dist, then cargo build --release --locked
./target/release/woom
```

Keep `SECRET` stable across restarts. Docker uses `/data/woom.json` and expects
a persistent `/data` volume. See README for Live777 networking and upgrades.

## Testing

- Rust format, Clippy and tests: `npm run test:rust`
- E2E (Playwright, Chromium only):

```bash
docker compose up -d
npx playwright install chromium
npm run test:e2e
E2E_REUSE_SERVER=true npx playwright test  # explicit opt-in to an existing server
```

E2E conventions:

- Tests cover core flows and regression paths and must stay green across
  refactors; update specs when behavior intentionally changes.
- Locate elements by `data-testid` only (never text/CSS classes). Add
  `data-testid` to new interactive elements.
- Browsers use fake media devices. Assert playback with
  `expectVideoPlaying()` in `tests/helper.ts`, which checks dimensions and
  advancing playback/decoded frames rather than element presence.
- Remote stream state and WebRTC recovery are asynchronous; use generous
  timeouts without replacing assertions with fixed sleeps.
- `tests/global-setup.ts` fails fast if Live777 is unreachable.
- Playwright uses an explicit test-only `SECRET` and `DATA_FILE=:memory:`.
  It does not reuse an existing server unless `E2E_REUSE_SERVER=true`.

## Code style

- Biome 2.6.4 handles formatting, general TS/JS checks and import organization
  (`biome.json`, same major tool version as Live777). ESLint 10 retains Vue
  essential and TypeScript semantic rules; `vue-tsc --noEmit` checks WebApp,
  Playwright and config types. Style: no semicolons, single quotes, 2-space
  indent, trailing commas only when multiline. Use `npm run format` for safe
  fixes and `npm run lint` for all checks; lint is part of `npm run build`.
- Rust must pass `cargo fmt --check` and
  `cargo clippy --all-targets -- -D warnings`.
- Commits: Conventional Commits with scope, for example `feat(webapp): ...`,
  `fix(server): ...`, `test(e2e): ...`.
- CI: `.github/workflows/build.yml` (three-OS build),
  `.github/workflows/test.yml` (Rust quality, E2E, Docker smoke), and
  `.github/workflows/flyio.yml` (deploy only after reusable Build and Test
  workflows succeed).
