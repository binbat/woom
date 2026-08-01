# AGENTS.md

Guidance for AI agents working on this repository.

## Project overview

WOOM is a self-hosted meeting service built on the
[Live777](https://github.com/binbat/live777) WebRTC engine (WHIP/WHEP).

- `server/` — Go backend (chi router). Serves the REST API (`/user/`, `/room/*`),
  reverse-proxies `/whip/*` and `/whep/*` to Live777, and serves the webapp as an
  SPA (unknown paths fall back to `index.html`). Room state lives in Redis.
  Config is via env vars, see `server/config.go` (`PORT` 4000, `REDIS_URL`,
  `LIVE777_URL`, `LIVE777_TOKEN`, `SECRET`).
- `webapp/` — React 18 + TypeScript + Vite + UnoCSS frontend. State: jotai
  (`webapp/store/atom.ts`), zustand for persisted settings, localStorage for
  user/token (`webapp/lib/storage.ts`). There is no router library; the
  Welcome/Meeting views are switched by `meetingIdAtom` in `webapp/app.tsx`.
- `static/` — webapp build output embedded into the Go binary. Default build
  serves a placeholder; the real app requires the `release` build tag.
- `tests/` — Playwright e2e tests, see below.

## Build and run

External dependencies: Redis (:6379) and Live777 (:7777) — `docker compose up -d`.

```bash
npm install          # install webapp deps
npm run dev          # Vite dev server on :5173 (proxies API/WHIP/WHEP)
go run .             # backend on :4000 (dev, no embedded webapp)

make                 # release build: webapp -> static/dist, then
                     # CGO_ENABLED=0 go build -tags release -trimpath -o woom
./woom               # serves webapp + API + WHIP/WHEP proxy on :4000
```

## Testing

- Go unit tests: `go test ./...` (currently only `server/helper/`).
- E2E (Playwright, Chromium only):

```bash
docker compose up -d          # Redis + Live777 must be running
npx playwright install chromium
npm run test:e2e              # builds webapp + release server, runs tests
npx playwright test           # iterate; reuses a server already on :4000
```

E2e conventions:

- Tests cover core user flows and must stay green across refactors; when you
  change a flow, update the specs in `tests/` accordingly.
- Locate elements by `data-testid` only (never text/CSS classes). Add
  `data-testid` to new interactive elements you introduce.
- Browsers run with fake media devices; assert "video plays" via
  `expectVideoPlaying()` in `tests/helper.ts` (polls `videoWidth > 0`), not by
  element presence.
- Remote stream list polls every 3s — allow generous timeouts around remote
  video assertions.
- `tests/global-setup.ts` fails fast if Redis/Live777 are unreachable.

## Code style

- ESLint flat config (`eslint.config.js`): no semicolons, single quotes,
  2-space indent, trailing commas only when multiline. Run `npm run lint`
  (also type-checks via `tsc --noEmit`) before committing — it is part of
  `npm run build`.
- Commits: Conventional Commits with scope, e.g. `feat(webapp): ...`,
  `refactor(webapp): ...`, `test(e2e): ...` (see `git log`).
- CI: `.github/workflows/build.yml` (build matrix), `.github/workflows/test.yml`
  (e2e with Redis/Live777 service containers).
