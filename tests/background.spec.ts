import { devices, expect, type Locator, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  openMobileActions,
  openSettings,
} from './helper'

const backgroundIds = [
  'studio',
  'office',
  'library',
  'mountains',
  'forest',
  'blue-waves',
]

async function captureFrame(video: Locator): Promise<number[]> {
  return video.evaluate((element: HTMLVideoElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return Array.from(context.getImageData(0, 0, 64, 48).data)
  })
}

function frameDistance(before: number[], after: number[]): number {
  return before.reduce(
    (total, value, index) => total + Math.abs(value - after[index]),
    0
  )
}

test('loads all original backgrounds and persists the selection', async ({
  page,
}) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByTestId('settings-tab-media').click()
  const options = page.getByTestId('virtual-background-options')
  await expect(options.getByRole('button')).toHaveCount(backgroundIds.length)

  for (const id of backgroundIds) {
    const image = page.getByTestId(`virtual-background-${id}`).locator('img')
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1280)
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalHeight))
      .toBe(720)
  }

  await page.getByTestId('virtual-background-mountains').click()
  await expect(
    page.getByTestId('virtual-background-mountains')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('setting-storage') || '{}')
            .virtualBackground
      )
    )
    .toBe('mountains')

  await page.reload()
  await openSettings(page)
  await page.getByTestId('settings-tab-media').click()
  await expect(
    page.getByTestId('virtual-background-mountains')
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('virtual-background-studio')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
})

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small mobile', width: 320, height: 700 },
]) {
  test(`fits the background picker on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await openSettings(page)
    await page.getByTestId('settings-tab-media').click()
    const content = page.getByTestId('settings-content')
    await expect
      .poll(() => content.evaluate(el => el.scrollWidth <= el.clientWidth))
      .toBe(true)

    const last = page.getByTestId('virtual-background-blue-waves')
    await last.scrollIntoViewIfNeeded()
    const contentBounds = await content.boundingBox()
    const lastBounds = await last.boundingBox()
    if (!contentBounds || !lastBounds) throw new Error('Picker is missing')
    expect(lastBounds.x).toBeGreaterThanOrEqual(contentBounds.x)
    expect(lastBounds.x + lastBounds.width).toBeLessThanOrEqual(
      contentBounds.x + contentBounds.width
    )
    await page.screenshot({
      path: testInfo.outputPath(`background-picker-${viewport.width}.png`),
      fullPage: true,
    })
  })
}

test('changes the processed camera image without restarting it', async ({
  page,
}, testInfo) => {
  // Two background swaps with 30s-bound waits each — overruns the default
  // 60s test budget on a loaded CI runner.
  test.setTimeout(120_000)
  await createMeeting(page)
  const video = page.getByTestId('video-self')
  const toggle = page.getByTestId('toggle-background')
  await expect(toggle).toBeEnabled({ timeout: 30_000 })
  await expectVideoPlaying(video)

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-active', 'true', {
    timeout: 30_000,
  })
  await expectVideoPlaying(video)
  const originalTrack = await video.evaluate(
    (element: HTMLVideoElement) =>
      (element.srcObject as MediaStream).getVideoTracks()[0]?.id
  )

  for (const id of ['forest', 'blue-waves']) {
    const before = await captureFrame(video)
    await openSettings(page)
    await page.getByTestId('settings-tab-media').click()
    const option = page.getByTestId(`virtual-background-${id}`)
    await option.click()
    await expect(option).toBeEnabled({ timeout: 30_000 })
    await expect(option).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('settings-close').click()
    await expect
      .poll(async () => frameDistance(before, await captureFrame(video)), {
        timeout: 30_000,
      })
      .toBeGreaterThan(5000)
    await expect(page.getByTestId('device-error')).toHaveCount(0)
    expect(
      await video.evaluate(
        (element: HTMLVideoElement) =>
          (element.srcObject as MediaStream).getVideoTracks()[0]?.id
      )
    ).toBe(originalTrack)
  }

  await page.screenshot({
    path: testInfo.outputPath('processed-background.png'),
    fullPage: true,
  })
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-active', 'false')
  await expect(page.getByTestId('virtual-background-error')).toHaveCount(0)

  await page.getByTestId('toggle-video').click()
  await expect(page.getByTestId('video-off-avatar')).toBeVisible()
  await openSettings(page)
  await page.getByTestId('settings-tab-media').click()
  await page.getByTestId('virtual-background-mountains').click()
  await expect(
    page.getByTestId('virtual-background-mountains')
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('video-off-avatar')).toBeVisible()
  await expect(toggle).toBeDisabled()
})

test.describe('mobile backgrounds', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    userAgent: devices['iPhone 13'].userAgent,
  })
  test.setTimeout(90_000)

  test('reuses the camera and toggles from the more menu', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices
      )
      const state = Object.assign(window, { __videoRequestCount: 0 })
      navigator.mediaDevices.getUserMedia = constraints => {
        if (constraints?.video) state.__videoRequestCount++
        return getUserMedia(constraints)
      }
    })
    const readVideoRequests = () =>
      page.evaluate(() => Number(Reflect.get(window, '__videoRequestCount')))
    await createMeeting(page)
    const video = page.getByTestId('video-self')
    await expectVideoPlaying(video)
    await openMobileActions(page)
    const toggle = page.getByTestId('mobile-toggle-background')
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    const requestsBefore = await readVideoRequests()

    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'true', {
      timeout: 30_000,
    })
    await expectVideoPlaying(video)
    expect(await readVideoRequests()).toBe(requestsBefore)
    await expect(page.getByTestId('device-error')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'false', {
      timeout: 30_000,
    })
    await expectVideoPlaying(video)
    expect(await readVideoRequests()).toBe(requestsBefore)
    await page.getByTestId('more-close').click()
    await page.screenshot({
      path: testInfo.outputPath('mobile-background-controls.png'),
    })
  })

  test('falls back to CPU when GPU initialization fails', async ({ page }) => {
    const events: { event: string; data?: { delegate?: string } }[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname !== '/log') return
      const body = request.postDataJSON() as { logs?: typeof events }
      events.push(...(body.logs || []))
    })
    await page.addInitScript(() => {
      const state = { webglRequests: 0 }
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (
          ['webgl', 'webgl2', 'experimental-webgl'].includes(type) &&
          state.webglRequests++ < 6
        ) {
          return null
        }
        return Reflect.apply(getContext, this, [type, ...args])
      } as typeof getContext
      const getOffscreenContext = OffscreenCanvas.prototype.getContext
      OffscreenCanvas.prototype.getContext = function (
        this: OffscreenCanvas,
        type: string,
        ...args: unknown[]
      ) {
        if (
          ['webgl', 'webgl2', 'experimental-webgl'].includes(type) &&
          state.webglRequests++ < 6
        ) {
          return null
        }
        return Reflect.apply(getOffscreenContext, this, [type, ...args])
      } as typeof getOffscreenContext
    })
    await createMeeting(page)
    const video = page.getByTestId('video-self')
    await expectVideoPlaying(video)
    await openMobileActions(page)
    const toggle = page.getByTestId('mobile-toggle-background')
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'true', {
      timeout: 30_000,
    })
    await expectVideoPlaying(video)
    await expect
      .poll(() =>
        events.some(
          event =>
            event.event === 'virtual_background_initialized' &&
            event.data?.delegate === 'CPU'
        )
      )
      .toBe(true)
  })

  test('times out without stopping the original camera', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (
          this instanceof HTMLVideoElement &&
          !this.isConnected &&
          this.muted &&
          this.playsInline
        ) {
          return new Promise<void>(() => {})
        }
        return play.call(this)
      }
    })
    await createMeeting(page)
    const video = page.getByTestId('video-self')
    await expectVideoPlaying(video)
    const originalTrack = await video.evaluate(
      (element: HTMLVideoElement) =>
        (element.srcObject as MediaStream).getVideoTracks()[0]?.id
    )
    await openMobileActions(page)
    const toggle = page.getByTestId('mobile-toggle-background')
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await toggle.click()
    await expect(toggle).toBeDisabled()
    await expect(page.getByTestId('device-error')).toContainText('timed out', {
      timeout: 30_000,
    })
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('data-active', 'false')
    await expectVideoPlaying(video)
    expect(
      await video.evaluate(
        (element: HTMLVideoElement) =>
          (element.srcObject as MediaStream).getVideoTracks()[0]?.id
      )
    ).toBe(originalTrack)
    await page.screenshot({
      path: testInfo.outputPath('background-timeout.png'),
    })
  })
})
