import { expect, type Locator, type Page } from '@playwright/test'

// Room ids are 9 digits dash-grouped, e.g. 123-456-789 (server/helper)
export const ROOM_ID_PATTERN = /\/\d{3}-\d{3}-\d{3}$/

// True when the suite runs with EVENTS_CABLE enabled (room events over a
// live777 datachannel instead of SSE). SSE-transport-specific tests (ticket
// stubs, EventSource counting) are meaningless in that mode and skip.
export const EVENTS_CABLE = !!(
  process.env.EVENTS_CABLE &&
  !['0', 'false'].includes(process.env.EVENTS_CABLE.toLowerCase())
)

export async function createMeeting(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByTestId('new-meeting').click()
  await expect(page).toHaveURL(ROOM_ID_PATTERN)
  const roomId = page.url().split('/').pop()
  if (!roomId) throw new Error('Meeting id is missing from the URL')
  return roomId
}

// Join from the welcome page with the meeting id pre-filled from the URL
export async function joinMeetingFromWelcome(page: Page, roomId: string) {
  await page.goto(`/${roomId}`)
  await expect(page.getByTestId('meeting-id-input')).toHaveValue(roomId)
  await page.getByTestId('join-meeting').click()
  await expect(page.getByTestId('join-room')).toBeVisible()
}

// Prepare lobby: enter name, click Join, land in-call
export async function joinRoom(page: Page, name: string, password?: string) {
  await expect(page.getByTestId('join-room')).toBeVisible()
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('join-room').click()
  if (password) {
    await expect(page.getByTestId('password-input')).toBeVisible()
    await page.getByTestId('password-input').fill(password)
    await page.getByTestId('join-room').click()
  }
  await expect(page.getByTestId('hang-up')).toBeVisible()
}

export async function openMobileActions(page: Page) {
  await page.getByTestId('more-toggle').click()
  await expect(page.getByTestId('more-menu')).toBeVisible()
}

export async function openSettings(page: Page) {
  const toggle = page.getByTestId('settings-toggle')
  if (await toggle.isVisible()) {
    await toggle.click()
  } else {
    await openMobileActions(page)
    await page.getByTestId('mobile-settings-toggle').click()
  }
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
}

export async function mockDisplayMedia(page: Page, delay = 0) {
  await page.addInitScript(delayMs => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    )
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      const stream = await getUserMedia({ audio: false, video: true })
      Object.assign(window, { __displayStream: stream })
      return stream
    }
  }, delay)
}

export async function expectVideoPlaying(video: Locator) {
  await expect(video).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(
      () =>
        video.evaluate(
          (el: HTMLVideoElement) => el.videoWidth > 0 && el.videoHeight > 0
        ),
      { timeout: 30_000 }
    )
    .toBe(true)
  const initial = await video.evaluate((el: HTMLVideoElement) => ({
    time: el.currentTime,
    frames: el.getVideoPlaybackQuality().totalVideoFrames,
  }))
  await expect
    .poll(
      () =>
        video.evaluate((el: HTMLVideoElement, start) => {
          const quality = el.getVideoPlaybackQuality()
          return (
            el.currentTime > start.time &&
            quality.totalVideoFrames > start.frames
          )
        }, initial),
      { timeout: 30_000 }
    )
    .toBe(true)
}

export async function getApiToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  if (!token) throw new Error('API token is missing')
  return token
}

export async function getStreamId(page: Page): Promise<string> {
  const stream = await page.evaluate(() => localStorage.getItem('stream'))
  if (!stream) throw new Error('Stream id is missing')
  return stream
}

export const ADMIN_USER = 'admin'
export const ADMIN_PASSWORD = 'e2e-admin-9f6c2a84d17b43e0a5c98f21e6d04b7a'

export async function adminSignIn(page: Page) {
  await page.goto('/admin')
  await page.getByTestId('admin-username').fill(ADMIN_USER)
  await page.getByTestId('admin-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('admin-sign-in').click()
  await expect(page.getByTestId('admin-sign-out')).toBeVisible()
}
