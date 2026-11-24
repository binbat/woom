import { expect, type Page, test } from '@playwright/test'
import { createMeeting, getStreamId, joinRoom } from './helper'

// The DASH segmenter targets 10s segments; crossing one boundary guarantees
// at least one complete segment in the finalized manifest.
const SEGMENT_WAIT_MS = 12_000

// Poll live777 directly (dev deployment has open auth) until the recording's
// manifest exists in storage — finalization is asynchronous after the stop.
async function waitForManifest(page: Page, streamId: string) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `http://localhost:7777/api/playback/${streamId}`
        )
        if (!res.ok()) return 0
        return ((await res.json()) as unknown[]).length
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
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
  await waitForManifest(page, streamId)

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
})
