import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  getApiToken,
  joinMeetingFromWelcome,
  joinRoom,
  mockDisplayMedia,
} from './helper'

type Participant = { name: string; id: string; page: Page }

test('defaults excess remote video to audio and allows opt-in and presentation', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const contexts: BrowserContext[] = []
  const participants: Participant[] = []
  const offers = new Map<string, string[]>()
  try {
    let roomId = ''
    let host: Page | undefined
    for (let index = 0; index < 7; index++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      })
      contexts.push(context)
      const page = await context.newPage()
      await mockDisplayMedia(page)
      if (!host) {
        host = page
        roomId = await createMeeting(page)
        host.on('request', request => {
          const url = new URL(request.url())
          if (request.method() !== 'POST' || !url.pathname.startsWith('/whep/'))
            return
          const id = url.pathname.slice('/whep/'.length)
          offers.set(id, [...(offers.get(id) || []), request.postData() || ''])
        })
      } else {
        await joinMeetingFromWelcome(page, roomId)
      }
      const name = `User ${index + 1}`
      await joinRoom(page, name)
      const id = await page.evaluate(() => localStorage.getItem('stream'))
      if (!id) throw new Error(`Stream ID is missing for ${name}`)
      participants.push({ name, id, page })
    }
    if (!host) throw new Error('Host page is missing')

    const expectOffer = async (id: string, video: boolean) => {
      await expect
        .poll(() => {
          const sdp = offers.get(id)?.at(-1)
          return sdp
            ? {
                audio: sdp.includes('m=audio'),
                video: sdp.includes('m=video'),
              }
            : null
        })
        .toMatchObject({ audio: true, video })
    }

    await expect(host.getByTestId('members-count')).toHaveText('7')
    const remoteVideos = host
      .getByTestId('video-grid')
      .locator('video[data-testid="video-remote"]:visible')
    await expect(remoteVideos).toHaveCount(5, { timeout: 30_000 })
    for (let index = 0; index < 5; index++) {
      await expectVideoPlaying(remoteVideos.nth(index))
    }

    const audioToggle = host
      .getByTestId('remote-video-toggle')
      .filter({ hasText: 'Enable' })
    await expect(audioToggle).toHaveCount(1)
    const audioOnlyId = await audioToggle.getAttribute('data-stream-id')
    if (!audioOnlyId) throw new Error('Audio-only stream ID is missing')
    expect(audioOnlyId).toBe(participants[6].id)
    const audioParticipant = participants.find(
      participant => participant.id === audioOnlyId
    )
    if (!audioParticipant) throw new Error('Audio-only participant is missing')
    const audioTile = audioParticipant.page
    const hostAudioTile = host
      .getByTestId('video-tile')
      .filter({ has: host.locator(`[data-stream-id="${audioOnlyId}"]`) })
    await expectOffer(audioOnlyId, false)
    await expect(hostAudioTile.getByTestId('circle-wave')).toBeVisible()
    await host.screenshot({
      path: testInfo.outputPath('audio-only-default.png'),
    })

    await audioToggle.click()
    await expect(
      host.locator(
        `[data-testid="remote-video-toggle"][data-stream-id="${audioOnlyId}"]`
      )
    ).toHaveAttribute('data-video-enabled', 'true')
    await expectOffer(audioOnlyId, true)
    await expect(remoteVideos).toHaveCount(6)
    await expectVideoPlaying(hostAudioTile.getByTestId('video-remote'))

    await host
      .locator(
        `[data-testid="remote-video-toggle"][data-stream-id="${audioOnlyId}"]`
      )
      .click()
    await expectOffer(audioOnlyId, false)
    await expect(hostAudioTile.getByTestId('video-off-avatar')).toBeVisible()
    await expect(remoteVideos).toHaveCount(5)

    const response = await host.request.patch(`/room/${roomId}`, {
      headers: { Authorization: `Bearer ${await getApiToken(host)}` },
      data: { presenter: audioOnlyId },
    })
    expect(response.ok()).toBe(true)
    const share = audioTile.getByTestId('toggle-screen')
    await share.click()
    await expect(share).toHaveAttribute('data-active', 'true')
    await expectVideoPlaying(
      host.getByTestId('presentation-player').getByTestId('video-remote')
    )
    await expectOffer(audioOnlyId, true)

    await share.click()
    await expect(share).toHaveAttribute('data-active', 'false')
    await expect(host.getByTestId('presentation-player')).toHaveCount(0)
    await expectOffer(audioOnlyId, false)
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
})
