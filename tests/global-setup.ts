// The woom server depends on Live777 (WebRTC SFU).
// Fail fast with a clear message instead of obscure test failures.
// Start it with: docker compose up -d

const LIVE777_URL = 'http://localhost:7777'
const WAIT_TIMEOUT = 30_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function checkHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

async function waitFor(name: string, hint: string, check: () => Promise<boolean>) {
  const start = Date.now()
  while (Date.now() - start < WAIT_TIMEOUT) {
    if (await check()) {
      console.log(`[e2e] ${name}: OK`)
      return
    }
    await sleep(1000)
  }
  throw new Error(`[e2e] ${name} is not reachable. ${hint}`)
}

export default async function globalSetup() {
  await waitFor(
    `Live777 (${LIVE777_URL})`,
    'Start it with: docker compose up -d',
    () => checkHttp(LIVE777_URL),
  )
}
