import { test, expect } from '@playwright/test'
import { createMeeting, joinMeetingFromWelcome, joinRoom, expectVideoPlaying } from './helper'

test.describe('single user meeting', () => {
  test('create, join with media, hang up', async ({ page }) => {
    const roomId = await createMeeting(page)

    // prepare lobby: name input and local preview with fake media
    await expect(page.getByTestId('name-input')).toBeVisible()
    await expectVideoPlaying(page.getByTestId('video-self'))

    await joinRoom(page, 'Alice')

    // in-call: meeting id shown, self video publishing
    await expect(page.getByTestId('meeting-id')).toHaveText(roomId)
    await expectVideoPlaying(page.getByTestId('video-self'))

    // hang up returns to the prepare lobby
    await page.getByTestId('hang-up').click()
    await expect(page.getByTestId('join-room')).toBeVisible()
  })

  test('join existing meeting by id', async ({ page }) => {
    const roomId = await createMeeting(page)

    // re-join the same room from a fresh page load via URL
    await joinMeetingFromWelcome(page, roomId)

    await joinRoom(page, 'Bob')
    await expect(page.getByTestId('meeting-id')).toHaveText(roomId)
    await expectVideoPlaying(page.getByTestId('video-self'))
  })
})
