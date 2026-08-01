import { test, expect, devices } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom, expectVideoPlaying } from './helper'

// Auto-rejoin: when the network drops and recovers, the client reconnects
// the SSE stream, re-joins the meeting idempotently and re-publishes
// presence; WHIP/WHEP recover via their watchdogs.
test.describe('auto rejoin after network drop', () => {
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

      // drop Bob's network: his presence will expire on the server (45s TTL
      // is not hit here because we come back sooner), SSE errors out
      await contextBob.setOffline(true)
      await bob.waitForTimeout(3000)
      await contextBob.setOffline(false)

      // Bob re-joins and Alice is visible again
      await expect(bobRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(bobRemote)

      // and Alice still sees Bob (no duplicate participants)
      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(2, { timeout: 30_000 })
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
      await expect(page.getByTestId('switch-camera')).toBeVisible({ timeout: 15_000 })
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
