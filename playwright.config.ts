import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4000'

// WebRTC flags learned from https://github.com/binbat/live777 browser tests:
// fake media devices + auto-accept permission + autoplay without gesture.
// Full Chromium ("new headless", channel: 'chromium') is used instead of the
// headless shell for complete WebRTC support.
const chromiumArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
]

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // WebRTC tests are timing sensitive; run serially for stability.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html']] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: { args: chromiumArgs },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: {
    // Release binary serves webapp + API + WHIP/WHEP proxy on one origin.
    // Build it first: `npm run build && go build -tags release -o woom`
    // (or just use `npm run test:e2e`). Redis and Live777 must be running,
    // see tests/global-setup.ts.
    command: './woom',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
