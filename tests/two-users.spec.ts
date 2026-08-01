import { test, expect } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom, expectVideoPlaying } from './helper'

// Full-stack WebRTC scenario: Alice publishes (WHIP), Bob subscribes (WHEP)
// through Live777, and vice versa. Remote stream list is polled every 3s,
// so remote videos take a few seconds to appear.
test.describe('two users in one room', () => {
  test('both see each other video', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')

      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      // each side renders exactly one remote player, and it plays
      const bobRemote = bob.getByTestId('video-remote')
      await expect(bobRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(bobRemote)

      const aliceRemote = alice.getByTestId('video-remote')
      await expect(aliceRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(aliceRemote)

      // Bob hangs up: his remote player disappears from Alice's view
      await bob.getByTestId('hang-up').click()
      await expect(alice.getByTestId('video-remote')).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})
