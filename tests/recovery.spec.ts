import { expect, type Page, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  getApiToken,
  joinMeetingFromWelcome,
  joinRoom,
} from './helper'

async function patchRoom(
  page: Page,
  roomId: string,
  data: Record<string, unknown>
) {
  const response = await page.request.patch(`/room/${roomId}`, {
    headers: { Authorization: `Bearer ${await getApiToken(page)}` },
    data,
  })
  expect(response.ok()).toBe(true)
}

test.describe('meeting recovery', () => {
  test('password and locked room restores presence after the TTL', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    try {
      const password = 'memory-only-password'
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await patchRoom(alice, roomId, { password })

      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob', password)
      await patchRoom(alice, roomId, { locked: true })
      await expectVideoPlaying(bob.getByTestId('video-remote'))
      let joinRequests = 0
      bob.on('request', request => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === `/room/${roomId}/join`
        ) {
          joinRequests++
        }
      })

      await bobContext.setOffline(true)
      const presenceResponse = bob.waitForResponse(
        response => {
          const request = response.request()
          return (
            request.method() === 'PATCH' &&
            response.ok() &&
            new URL(response.url()).pathname === `/room/${roomId}/presence`
          )
        },
        { timeout: 75_000 }
      )
      await bob.waitForTimeout(50_000)
      await bobContext.setOffline(false)

      await presenceResponse
      expect(joinRequests).toBe(0)
      await expect(bob.getByTestId('hang-up')).toBeVisible()
      await expectVideoPlaying(bob.getByTestId('video-remote'))
      await expectVideoPlaying(alice.getByTestId('video-remote'))
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })

  test('a closed ticket connection obtains a fresh ticket', async ({
    page,
  }) => {
    let ticketRequests = 0
    let rejectEvents = true
    await page.route('**/room/*/events/ticket', async route => {
      ticketRequests++
      await route.continue()
    })
    await page.route('**/room/*/events?ticket=*', async route => {
      if (rejectEvents) {
        rejectEvents = false
        await route.fulfill({ status: 401, body: 'expired ticket' })
      } else {
        await route.continue()
      }
    })

    await createMeeting(page)
    await joinRoom(page, 'Alice')
    await expect.poll(() => ticketRequests).toBeGreaterThanOrEqual(2)
    await page.getByTestId('members-toggle').click()
    await expect(page.getByTestId('member-row')).toHaveCount(1)
  })

  for (const snapshotMeetingNo of [null, 'replacement-meeting']) {
    test(`exits when the first snapshot meeting is ${String(snapshotMeetingNo)}`, async ({
      page,
    }) => {
      let releaseEvents = () => {}
      const eventsGate = new Promise<void>(resolve => {
        releaseEvents = resolve
      })
      await page.route('**/room/*/events?ticket=*', async route => {
        await eventsGate
        const snapshot = {
          type: 'snapshot',
          revision: 0,
          meetingNo: snapshotMeetingNo,
          streams: {},
          presenter: '',
          locked: false,
          participants: [],
          messages: [],
          muteAllAt: 0,
        }
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: `data: ${JSON.stringify(snapshot)}\n\n`,
        })
      })

      await createMeeting(page)
      await joinRoom(page, 'Alice')
      releaseEvents()
      await expect(page.getByTestId('join-room')).toBeVisible()
    })
  }

  test('owner ending while offline returns to the lobby without a new meeting', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')
      let joinRequests = 0
      bob.on('request', request => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === `/room/${roomId}/join`
        ) {
          joinRequests++
        }
      })

      await bobContext.setOffline(true)
      const ended = await alice.request.post(`/room/${roomId}/end`, {
        headers: { Authorization: `Bearer ${await getApiToken(alice)}` },
      })
      expect(ended.ok()).toBe(true)
      await bobContext.setOffline(false)

      await expect(bob.getByTestId('join-room')).toBeVisible()
      expect(joinRequests).toBe(0)
      const response = await bob.request.get('/user/records', {
        headers: { Authorization: `Bearer ${await getApiToken(bob)}` },
      })
      expect(response.ok()).toBe(true)
      const records = (await response.json()) as Array<{ roomId: string }>
      expect(records.filter(record => record.roomId === roomId)).toHaveLength(1)
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })
})

test.describe('SSE connection ownership', () => {
  for (const status of [401, 403, 404]) {
    test(`ticket ${status} stops retries and returns to the lobby`, async ({
      page,
    }) => {
      let ticketRequests = 0
      let releaseTicket = () => {}
      const ticketGate = new Promise<void>(resolve => {
        releaseTicket = resolve
      })
      await page.route('**/room/*/events/ticket', async route => {
        ticketRequests++
        await ticketGate
        await route.fulfill({ status, body: 'authorization failed' })
      })

      await createMeeting(page)
      await joinRoom(page, 'Alice')
      releaseTicket()
      await expect(page.getByTestId('join-room')).toBeVisible()
      await page.waitForTimeout(1200)
      expect(ticketRequests).toBe(1)
    })
  }

  test('concurrent connects leave only one active event source', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource
      const connections = {
        active: new Set<EventSource>(),
        created: [] as EventSource[],
      }
      Object.assign(window, { __eventConnections: connections })
      window.EventSource = class extends NativeEventSource {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init)
          connections.active.add(this)
          connections.created.push(this)
        }

        close() {
          connections.active.delete(this)
          super.close()
        }
      }
    })
    let releaseRoom = () => {}
    const roomGate = new Promise<void>(resolve => {
      releaseRoom = resolve
    })
    let delayRoom = true
    await page.route('**/room/*', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (
        delayRoom &&
        request.method() === 'GET' &&
        /^\/room\/[^/]+$/.test(pathname)
      ) {
        delayRoom = false
        await roomGate
      }
      await route.continue()
    })

    await createMeeting(page)
    await joinRoom(page, 'Alice')
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const connections = () =>
      page.evaluate(() => {
        const tracked = (
          window as unknown as Window & {
            __eventConnections: {
              active: Set<EventSource>
              created: EventSource[]
            }
          }
        ).__eventConnections
        return { active: tracked.active.size, created: tracked.created.length }
      })
    await expect.poll(connections).toMatchObject({ active: 1, created: 1 })
    releaseRoom()
    await expect.poll(connections).toMatchObject({ active: 1, created: 2 })
  })
})
