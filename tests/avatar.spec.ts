import { test, expect } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom, expectVideoPlaying } from './helper'

// Joining before device init completes must not lose the publish: start()
// waits for the first track instead of returning silently.
test.describe('slow device join (start race)', () => {
  test('publishes even when getUserMedia is slow', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      // make every getUserMedia call take 2s on Alice's side
      await alice.addInitScript(() => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = (constraints) =>
          new Promise((resolve) => setTimeout(() => resolve(original(constraints)), 2000))
      })

      const roomId = await createMeeting(alice)
      // join immediately, without waiting for the local preview
      await alice.getByTestId('name-input').fill('Alice')
      await alice.getByTestId('join-room').click()
      await alice.getByTestId('hang-up').waitFor()

      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      // Bob still ends up seeing Alice's video
      const bobRemote = bob.getByTestId('video-remote')
      await expect(bobRemote).toHaveCount(1, { timeout: 30_000 })
      await expectVideoPlaying(bobRemote)
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})

// Avatar placeholder: turning the camera off shows an avatar with the
// user's initial instead of a black box.
test.describe('video-off avatar', () => {
  test('remote side sees avatar when camera is off', async ({ browser }) => {
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

      // Alice turns her camera off (bar buttons: copy, speaker, audio, video):
      // her tile on Bob's side shows the avatar
      await alice.locator('.flex.justify-center .panel button').nth(3).click()
      const avatar = bob.getByTestId('video-off-avatar')
      await expect(avatar).toBeVisible({ timeout: 15_000 })
      await expect(avatar).toContainText('A')
      await expect(avatar).toContainText('Alice')
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})
