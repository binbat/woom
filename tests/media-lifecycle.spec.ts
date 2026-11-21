import { expect, type Page, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  getApiToken,
  joinMeetingFromWelcome,
  joinRoom,
} from './helper'

async function mockDisplayMedia(page: Page, delay = 0) {
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

test.describe('device and media lifecycle', () => {
  test('stops every temporary device probe track', async ({ page }) => {
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices
      )
      const probeTracks: MediaStreamTrack[] = []
      Object.assign(window, { __probeTracks: probeTracks })
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await getUserMedia(constraints)
        if (constraints?.audio === true && constraints?.video === true) {
          probeTracks.push(...stream.getTracks())
        }
        return stream
      }
    })

    await createMeeting(page)
    await expect(page.getByTestId('join-room')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tracks = (
            window as unknown as Window & { __probeTracks: MediaStreamTrack[] }
          ).__probeTracks
          return (
            tracks.length > 0 &&
            tracks.every(track => track.readyState === 'ended')
          )
        })
      )
      .toBe(true)
  })

  test('permission rejection restores device loading state', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      navigator.mediaDevices.enumerateDevices = async () =>
        [
          {
            deviceId: 'camera-under-test',
            kind: 'videoinput',
            label: 'Camera under test',
            groupId: 'test',
            toJSON() {
              return this
            },
          },
        ] as MediaDeviceInfo[]
    })

    await createMeeting(page)
    const selector = page.getByTestId('video-select')
    await expect(selector).toBeVisible()
    await selector.selectOption('camera-under-test')
    await expect(page.getByTestId('device-error')).toBeVisible()
    await expect(selector).toBeEnabled()
    await expect(page.getByTestId('toggle-video')).toBeEnabled()
  })

  test('hang up invalidates a delayed publish start', async ({ page }) => {
    const publishRequests: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/whip/'))
        publishRequests.push(request.url())
    })
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices
      )
      navigator.mediaDevices.getUserMedia = constraints =>
        new Promise((resolve, reject) => {
          setTimeout(
            () => getUserMedia(constraints).then(resolve, reject),
            4000
          )
        })
    })

    await createMeeting(page)
    await page.getByTestId('name-input').fill('Alice')
    await page.getByTestId('join-room').click()
    await expect(page.getByTestId('hang-up')).toBeVisible()
    await page.getByTestId('hang-up').click()
    await expect(page.getByTestId('join-room')).toBeVisible()
    await page.waitForTimeout(11_000)
    expect(publishRequests).toHaveLength(0)
  })

  test('native display track ending stops sharing', async ({ page }) => {
    await mockDisplayMedia(page)
    await createMeeting(page)
    await joinRoom(page, 'Alice')

    const toggle = page.getByTestId('toggle-screen')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'true')
    await expect(toggle).toBeEnabled()
    await page.evaluate(() => {
      const stream = (
        window as unknown as Window & { __displayStream: MediaStream }
      ).__displayStream
      const track = stream.getVideoTracks()[0]
      track.stop()
      track.dispatchEvent(new Event('ended'))
    })
    await expect(toggle).toHaveAttribute('data-active', 'false')
  })

  test('presenter revocation stops an active share', async ({ browser }) => {
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    try {
      await mockDisplayMedia(alice)
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      const toggle = alice.getByTestId('toggle-screen')
      await toggle.click()
      await expect(toggle).toHaveAttribute('data-active', 'true')
      const bobId = await bob.evaluate(() => localStorage.getItem('stream'))
      const response = await alice.request.patch(`/room/${roomId}`, {
        headers: { Authorization: `Bearer ${await getApiToken(alice)}` },
        data: { presenter: bobId },
      })
      expect(response.ok()).toBe(true)
      await expect(toggle).toHaveAttribute('data-active', 'false')
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })

  test('presenter revocation also cancels a pending share', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    try {
      await mockDisplayMedia(alice, 1000)
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      const presenceAfterRevoke: Array<{ screen: boolean }> = []
      let revoking = false
      alice.on('request', request => {
        if (
          revoking &&
          request.method() === 'PATCH' &&
          new URL(request.url()).pathname === `/room/${roomId}/presence`
        ) {
          presenceAfterRevoke.push(
            request.postDataJSON() as { screen: boolean }
          )
        }
      })
      const toggle = alice.getByTestId('toggle-screen')
      await toggle.click()
      const bobId = await bob.evaluate(() => localStorage.getItem('stream'))
      revoking = true
      const response = await alice.request.patch(`/room/${roomId}`, {
        headers: { Authorization: `Bearer ${await getApiToken(alice)}` },
        data: { presenter: bobId },
      })
      expect(response.ok()).toBe(true)
      await expect
        .poll(() =>
          alice.evaluate(() => {
            const stream = (
              window as unknown as Window & { __displayStream?: MediaStream }
            ).__displayStream
            return stream?.getVideoTracks()[0]?.readyState
          })
        )
        .toBe('ended')
      await expect(toggle).toHaveAttribute('data-active', 'false')
      await expectVideoPlaying(alice.getByTestId('video-self'))
      expect(presenceAfterRevoke.every(status => !status.screen)).toBe(true)
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })

  test('changing screen resolution keeps sharing active', async ({ page }) => {
    await mockDisplayMedia(page)
    await createMeeting(page)
    await joinRoom(page, 'Alice')

    const toggle = page.getByTestId('toggle-screen')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'true')
    await page.getByTestId('screen-resolution').selectOption('1080')
    await expect(toggle).toHaveAttribute('data-active', 'true')
    await expect(toggle).toBeEnabled()
  })
})
