import { expect, type Page, test } from '@playwright/test'
import { adminSignIn, createMeeting, getStreamId, joinRoom } from './helper'

// The DASH segmenter targets 10s segments; crossing one boundary guarantees
// at least one complete segment in the finalized manifest.
const SEGMENT_WAIT_MS = 12_000

// Poll live777 directly (dev deployment has open auth) until the recording's
// manifest exists in storage — finalization is asynchronous after the stop.
async function waitForManifest(page: Page, streamId: string): Promise<string> {
  let mpdPath = ''
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `http://localhost:7777/api/playback/${streamId}`
        )
        if (!res.ok()) return 0
        const entries = (await res.json()) as { mpd_path: string }[]
        mpdPath = entries[0]?.mpd_path ?? ''
        return entries.length
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
  return mpdPath
}

test('owner records a meeting and plays the recording back', async ({
  page,
}) => {
  const roomId = await createMeeting(page)
  await joinRoom(page, 'Recorder')
  const streamId = await getStreamId(page)

  // owner-only toggle; REC indicator visible while recording
  await page.getByTestId('toggle-record').click()
  await expect(page.getByTestId('recording-indicator')).toBeVisible()
  await page.waitForTimeout(SEGMENT_WAIT_MS)
  await page.getByTestId('toggle-record').click()
  await expect(page.getByTestId('recording-indicator')).toBeHidden()

  // leaving (last participant) archives the meeting with its recordings
  await page.getByTestId('hang-up').click()
  const mpdPath = await waitForManifest(page, streamId)

  await page.goto(`/${roomId}`)
  await expect(page.getByTestId('record-item')).toHaveCount(1)
  await page.getByTestId('record-expand').click()
  const recordings = page.getByTestId('record-recordings')
  await expect(recordings).toBeVisible()
  await expect(recordings).toContainText('Recorder')

  await page.getByTestId('record-play').click()
  const player = page.getByTestId('dash-player')
  await expect(player).toBeVisible()
  const video = player.locator('video')
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.duration ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)

  // playback errors (e.g. missing manifest) surface in the player
  await expect(page.getByTestId('dash-player-error')).toHaveCount(0)

  // Admin deletion removes the recording everywhere: the WOOM store entry,
  // the live777 index row, and the media files in storage.
  await adminSignIn(page)
  const adminItem = page
    .getByTestId('admin-record-item')
    .filter({ hasText: roomId })
  await adminItem.getByTestId('admin-record-expand').click()
  await adminItem.getByTestId('admin-tab-recordings').click()
  await adminItem.getByTestId('admin-recording-delete').click()
  await adminItem.getByTestId('admin-recording-delete').click()
  await expect(adminItem.getByTestId('admin-recording-item')).toHaveCount(0)

  await expect
    .poll(async () => {
      const res = await page.request.get(
        `http://localhost:7777/api/playback/${streamId}`
      )
      return res.ok() ? ((await res.json()) as unknown[]).length : -1
    })
    .toBe(0)
  // The object is no longer served (live777 answers 500 for missing objects
  // rather than 404).
  const object = await page.request.get(
    `http://localhost:7777/api/record/object/${mpdPath}`
  )
  expect(object.ok()).toBe(false)
})
