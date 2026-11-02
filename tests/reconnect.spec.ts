import { devices, expect, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  joinMeetingFromWelcome,
  joinRoom,
} from './helper'

// Recovery restores the persisted participant's presence without joining
// again; WHIP/WHEP recover via their watchdogs.
test.describe('presence recovery after network drop', () => {
  test('remote video recovers after offline/online', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      const bobRemote = bob.getByTestId('video-remote')
      await expect(bobRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(bobRemote)
      let joinRequests = 0
      bob.on('request', request => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === `/room/${roomId}/join`
        ) {
          joinRequests++
        }
      })

      // Drop Bob's network without reaching the 45s presence TTL.
      await contextBob.setOffline(true)
      const presenceResponse = bob.waitForResponse(response => {
        const request = response.request()
        return (
          request.method() === 'PATCH' &&
          response.ok() &&
          new URL(response.url()).pathname === `/room/${roomId}/presence`
        )
      })
      await bob.waitForTimeout(3000)
      await contextBob.setOffline(false)

      await presenceResponse
      expect(joinRequests).toBe(0)
      await expect(bobRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(bobRemote)

      // and Alice still sees Bob (no duplicate participants)
      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(2, {
        timeout: 30_000,
      })
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})

// Mobile adaptation: the front/back camera switch shows up on mobile UAs
test.describe('mobile adaptation', () => {
  test('switch camera button is visible on mobile', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
    })
    const page = await context.newPage()

    try {
      await createMeeting(page)
      await expect(page.getByTestId('switch-camera')).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await context.close()
    }
  })

  test('switch camera button is hidden on desktop', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await createMeeting(page)
      await expect(page.getByTestId('join-room')).toBeVisible()
      await expect(page.getByTestId('switch-camera')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
