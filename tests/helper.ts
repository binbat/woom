import { expect, Page, Locator } from '@playwright/test'

// Room ids are 9 digits dash-grouped, e.g. 123-456-789 (server/helper)
export const ROOM_ID_PATTERN = /\/\d{3}-\d{3}-\d{3}$/

export async function createMeeting(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByTestId('new-meeting').click()
  await expect(page).toHaveURL(ROOM_ID_PATTERN)
  return page.url().split('/').pop()!
}

// Join from the welcome page with the meeting id pre-filled from the URL
export async function joinMeetingFromWelcome(page: Page, roomId: string) {
  await page.goto(`/${roomId}`)
  await expect(page.getByTestId('meeting-id-input')).toHaveValue(roomId)
  await page.getByTestId('join-meeting').click()
  await expect(page.getByTestId('join-room')).toBeVisible()
}

// Prepare lobby: enter name, click Join, land in-call
export async function joinRoom(page: Page, name: string) {
  await expect(page.getByTestId('join-room')).toBeVisible()
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('join-room').click()
  await expect(page.getByTestId('hang-up')).toBeVisible()
}

// "Is video actually playing" assertion, same technique as the live777
// browser tests: wait until the element renders real frames.
export async function expectVideoPlaying(video: Locator) {
  await expect(video).toBeVisible()
  await expect.poll(
    () => video.evaluate((el: HTMLVideoElement) => el.videoWidth),
    { timeout: 30_000 },
  ).toBeGreaterThan(0)
}
