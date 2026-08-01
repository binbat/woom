import { test, expect } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom } from './helper'

// Member list panel and host management: the panel shows all participants
// with their media state; the owner can mute everyone and remove someone.
test.describe('members panel and host controls', () => {
  test('panel lists participants with roles and media state', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(2)
      await expect(alice.getByTestId('members-list')).toContainText('Alice')
      await expect(alice.getByTestId('members-list')).toContainText('Bob')
      await expect(alice.getByTestId('member-owner-badge')).toHaveCount(1)
      await expect(alice.getByTestId('members-count')).toHaveText('2')

      // both published media by default: mic-on icons appear (may take a
      // moment until presence snapshots arrive)
      await expect(alice.getByTestId('member-mic-on').first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })

  test('owner can mute all and remove a participant', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(2)

      // mute all: Bob mutes himself on the next snapshot, visible as mic-off
      await alice.getByTestId('mute-all').click()
      await expect(alice.getByTestId('member-mic-off').first()).toBeVisible({ timeout: 15_000 })

      // remove Bob: he is hung up back to the prepare page automatically,
      // and disappears from the list
      await bob.getByTestId('chat-toggle').waitFor()
      await alice.getByTestId('member-kick').first().click()
      await expect(bob.getByTestId('join-room')).toBeVisible({ timeout: 15_000 })
      await expect(alice.getByTestId('member-row')).toHaveCount(1, { timeout: 15_000 })
      await expect(alice.getByTestId('members-count')).toHaveText('1')
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})
