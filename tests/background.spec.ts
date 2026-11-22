import { expect, type Locator, test } from '@playwright/test'
import { createMeeting, expectVideoPlaying } from './helper'

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
  await page.getByTestId('settings-toggle').click()
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
  await page.getByTestId('settings-toggle').click()
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
    await page.getByTestId('settings-toggle').click()
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
    await page.getByTestId('settings-toggle').click()
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
  await page.getByTestId('settings-toggle').click()
  await page.getByTestId('settings-tab-media').click()
  await page.getByTestId('virtual-background-mountains').click()
  await expect(
    page.getByTestId('virtual-background-mountains')
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('video-off-avatar')).toBeVisible()
  await expect(toggle).toBeDisabled()
})
