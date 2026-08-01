import { test, expect } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom } from './helper'

// In-meeting chat: messages are delivered over SSE and visible to all
// participants; late joiners see recent history from the snapshot.
test.describe('meeting chat', () => {
  test('two users exchange messages', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')

      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      // Alice opens chat and sends a message
      await alice.getByTestId('chat-toggle').click()
      await alice.getByTestId('chat-input').fill('hello from alice')
      await alice.getByTestId('chat-send').click()
      await expect(alice.getByTestId('chat-message').filter({ hasText: 'hello from alice' })).toHaveCount(1)

      // Bob receives it: unread badge appears, message visible after opening
      await expect(bob.getByTestId('chat-unread')).toHaveText('1', { timeout: 15_000 })
      await bob.getByTestId('chat-toggle').click()
      await expect(bob.getByTestId('chat-message').filter({ hasText: 'hello from alice' })).toHaveCount(1)

      // Bob replies, Alice sees it live
      await bob.getByTestId('chat-input').fill('hi alice, bob here')
      await bob.getByTestId('chat-input').press('Enter')
      await expect(alice.getByTestId('chat-message').filter({ hasText: 'hi alice, bob here' })).toHaveCount(1, { timeout: 15_000 })
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })

  test('late joiner sees recent messages', async ({ browser }) => {
    const contextAlice = await browser.newContext()
    const contextBob = await browser.newContext()
    const alice = await contextAlice.newPage()
    const bob = await contextBob.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')

      await alice.getByTestId('chat-toggle').click()
      await alice.getByTestId('chat-input').fill('early bird message')
      await alice.getByTestId('chat-send').click()
      await expect(alice.getByTestId('chat-message')).toHaveCount(1)

      // Bob joins after the message was sent; history comes from the snapshot
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')
      await bob.getByTestId('chat-toggle').click()
      await expect(bob.getByTestId('chat-message').filter({ hasText: 'early bird message' })).toHaveCount(1, { timeout: 15_000 })
    } finally {
      await contextAlice.close()
      await contextBob.close()
    }
  })
})
