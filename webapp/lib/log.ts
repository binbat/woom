/**
 * Browser log reporter: buffers key events and ships them to the server,
 * so operators can diagnose user-side failures from server logs.
 *
 * Coverage:
 * - window errors and unhandled promise rejections
 * - console.warn / console.error (mirrored)
 * - explicit instrumentation: WHIP/WHEP lifecycle, join, device errors
 */

import { token as apiToken } from './api'

type Level = 'info' | 'warn' | 'error'

interface Entry {
  ts: number
  level: Level
  event: string
  msg?: string
  data?: unknown
}

const sessionId = crypto.randomUUID()
let meetingId = ''
let queue: Entry[] = []
let flushing = false

export function setLogMeeting(id: string) {
  meetingId = id
}

export function log(level: Level, event: string, msg?: string, data?: unknown) {
  queue.push({ ts: Date.now(), level, event, msg, data })
  // errors flush immediately; the rest ride the next interval tick
  if (level === 'error') flush()
}

function flush() {
  if (!queue.length || flushing) return
  flushing = true
  const logs = queue
  queue = []
  fetch('/log', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId, meetingId, logs }),
    // keepalive lets entries survive page unload
    keepalive: true,
  })
    .catch(() => { /* never log the logger's own failure (loop risk) */ })
    .finally(() => {
      flushing = false
    })
}

const FLUSH_INTERVAL = 5000
setInterval(flush, FLUSH_INTERVAL)
window.addEventListener('beforeunload', flush)

window.addEventListener('error', (e) => {
  log('error', 'window_error', e.message, { source: e.filename, line: e.lineno })
})
window.addEventListener('unhandledrejection', (e) => {
  log('error', 'unhandled_rejection', String(e.reason))
})

for (const level of ['warn', 'error'] as const) {
  const original = console[level]
  console[level] = (...args: unknown[]) => {
    log(level, 'console', args.map(String).join(' '))
    original.apply(console, args)
  }
}
