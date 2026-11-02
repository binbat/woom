import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createMeeting, getApiToken, joinRoom } from './helper'

const LOG_READ_TOKEN = 'e2e-log-reader-9f6c2a84d17b43e0a5c98f21e6d04b7a'

interface ExportedLog {
  src: string
  ts: number
  receivedAt: unknown
  sessionId: string
  meetingId: string
  level: string
  event: string
  msg?: string
  data?: unknown
  url: string
  userAgent: string
}

async function readLogs(request: APIRequestContext, meetingId: string) {
  const query = new URLSearchParams({ meetingId, limit: '200' })
  const response = await request.get(`/log?${query}`, {
    headers: { Authorization: `Bearer ${LOG_READ_TOKEN}` },
  })
  if (!response.ok())
    throw new Error(`Log export returned ${response.status()}`)
  const body = await response.text()
  const entries = body
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as ExportedLog)
  return { body, entries }
}

test('client logs export batch metadata as NDJSON with secrets redacted', async ({
  page,
  request,
}) => {
  const roomId = await createMeeting(page)
  await joinRoom(page, 'Logger')
  const marker = `logging-marker-${randomUUID()}`
  const fakeToken = `fake-token-${randomUUID()}`
  const fakeTicket = `fake-ticket-${randomUUID()}`
  const fakeBearer = `fake-bearer-${randomUUID()}`
  const actualJwt = await getApiToken(page)
  const userAgent = await page.evaluate(() => navigator.userAgent)
  const pageUrl = page.url()

  await page.evaluate(
    ({ marker, fakeToken, fakeTicket, fakeBearer }) => {
      const jwt = localStorage.getItem('token') || ''
      console.error(
        `${marker} token=${fakeToken} ticket=${fakeTicket} Bearer ${fakeBearer} Bearer ${jwt}`
      )
    },
    { marker, fakeToken, fakeTicket, fakeBearer }
  )

  let exported = ''
  let matched: ExportedLog | undefined
  await expect
    .poll(
      async () => {
        const result = await readLogs(request, roomId)
        exported = result.body
        matched = result.entries.find(entry => entry.msg?.includes(marker))
        return !!matched
      },
      { timeout: 20_000 }
    )
    .toBe(true)

  if (!matched) throw new Error('Marker log entry was not exported')
  expect(matched.src).toEqual(expect.any(String))
  expect(matched.ts).toEqual(expect.any(Number))
  expect(matched.receivedAt).not.toBeNull()
  expect(matched.receivedAt).not.toBeUndefined()
  expect(matched.sessionId).toEqual(expect.any(String))
  expect(matched.sessionId.length).toBeGreaterThan(0)
  expect(matched.meetingId).toBe(roomId)
  expect(matched.level).toBe('error')
  expect(matched.event).toBe('console')
  expect(matched.msg).toContain(marker)
  expect(matched.url).toBe(pageUrl)
  expect(matched.userAgent).toBe(userAgent)

  expect(exported).toContain(marker)
  for (const secret of [fakeToken, fakeTicket, fakeBearer, actualJwt]) {
    expect(exported.includes(secret)).toBe(false)
  }
})
