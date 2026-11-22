import { writeFile } from 'node:fs/promises'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  joinMeetingFromWelcome,
  joinRoom,
  mockDisplayMedia,
  openMobileActions,
} from './helper'

const desktop = { width: 1280, height: 800 }
const mobile = { width: 390, height: 844 }

type ViewportName = 'desktop' | 'mobile'
type LayoutMode = 'gallery' | 'presentation'

async function readLayout(page: Page) {
  return page.getByTestId('video-stage').evaluate(stage => {
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }
    }
    const grid = stage.querySelector('[data-testid="video-grid"]')
    const presentation = stage.querySelector(
      '[data-testid="presentation-player"]'
    )
    const presentationVideo = presentation?.querySelector('video')
    if (!grid) throw new Error('Video grid is missing')
    return {
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      stage: bounds(stage),
      grid: {
        ...bounds(grid),
        clientWidth: grid.clientWidth,
        clientHeight: grid.clientHeight,
        scrollWidth: grid.scrollWidth,
        scrollHeight: grid.scrollHeight,
      },
      presentation: presentation ? bounds(presentation) : null,
      presentationVideo: presentationVideo ? bounds(presentationVideo) : null,
      presentationCovered: presentationVideo
        ? document.elementFromPoint(
            presentationVideo.getBoundingClientRect().x +
              presentationVideo.getBoundingClientRect().width / 2,
            presentationVideo.getBoundingClientRect().y +
              presentationVideo.getBoundingClientRect().height / 2
          ) !== presentationVideo
        : false,
      cards: Array.from(grid.children).map(bounds),
    }
  })
}

type LayoutMetrics = Awaited<ReturnType<typeof readLayout>>

function layoutIssues(
  metrics: LayoutMetrics,
  viewport: ViewportName,
  mode: LayoutMode
) {
  const issues: string[] = []
  const { stage, grid, cards, presentation } = metrics
  if (metrics.horizontalOverflow) issues.push('page has horizontal overflow')
  if (
    grid.x < stage.x - 1 ||
    grid.y < stage.y - 1 ||
    grid.x + grid.width > stage.x + stage.width + 1 ||
    grid.y + grid.height > stage.y + stage.height + 1
  ) {
    issues.push('grid escapes the stage')
  }
  if (mode === 'gallery' && presentation) {
    issues.push('gallery still contains a presentation')
  }
  if (mode === 'presentation' && !presentation) {
    issues.push('presentation is missing')
  }
  if (presentation) {
    if (
      presentation.x < stage.x - 1 ||
      presentation.y < stage.y - 1 ||
      presentation.x + presentation.width > stage.x + stage.width + 1 ||
      presentation.y + presentation.height > stage.y + stage.height + 1
    ) {
      issues.push('presentation escapes the stage')
    }
    if (
      presentation.x < grid.x + grid.width - 1 &&
      presentation.x + presentation.width > grid.x + 1 &&
      presentation.y < grid.y + grid.height - 1 &&
      presentation.y + presentation.height > grid.y + 1
    ) {
      issues.push('presentation overlaps the filmstrip')
    }
    const video = metrics.presentationVideo
    if (!video) {
      issues.push('presentation video element is missing')
    } else if (
      Math.abs(video.x - presentation.x) > 1 ||
      Math.abs(video.y - presentation.y) > 1 ||
      Math.abs(video.width - presentation.width) > 1 ||
      Math.abs(video.height - presentation.height) > 1
    ) {
      issues.push('presentation video does not fill its container')
    }
    if (metrics.presentationCovered) {
      issues.push('presentation video is covered by another element')
    }
    if (
      viewport === 'mobile' &&
      Math.abs(presentation.width / presentation.height - 4 / 3) > 0.02
    ) {
      issues.push('mobile presentation is not 4:3')
    }
  }

  for (const card of cards) {
    if (Math.abs(card.width / card.height - 4 / 3) > 0.02) {
      issues.push('a card is not 4:3')
    }
  }
  for (let first = 0; first < cards.length; first++) {
    for (let second = first + 1; second < cards.length; second++) {
      const a = cards[first]
      const b = cards[second]
      if (
        a.x < b.x + b.width - 1 &&
        a.x + a.width > b.x + 1 &&
        a.y < b.y + b.height - 1 &&
        a.y + a.height > b.y + 1
      ) {
        issues.push(`cards ${first} and ${second} overlap`)
      }
    }
  }

  if (mode === 'gallery') {
    if (grid.scrollWidth > grid.clientWidth + 1) {
      issues.push('gallery has horizontal overflow')
    }
    if (viewport === 'desktop' && grid.scrollHeight > grid.clientHeight + 1) {
      issues.push('desktop gallery requires vertical scrolling')
    }
    const rows = new Map<number, typeof cards>()
    for (const card of cards) {
      const top = Math.round(card.y)
      rows.set(top, [...(rows.get(top) || []), card])
      if (
        card.x < grid.x - 1 ||
        card.x + card.width > grid.x + grid.clientWidth + 1
      ) {
        issues.push('a gallery card escapes the grid horizontally')
      }
    }
    for (const row of rows.values()) {
      const left = Math.min(...row.map(card => card.x))
      const right = Math.max(...row.map(card => card.x + card.width))
      const center = (left + right) / 2
      const gridCenter = grid.x + grid.clientWidth / 2
      if (Math.abs(center - gridCenter) > 1) {
        issues.push(`gallery row is off center by ${center - gridCenter}px`)
      }
    }
  }
  return issues
}

async function captureLayout(
  page: Page,
  count: number,
  viewport: ViewportName,
  mode: LayoutMode,
  outputPath: (name: string) => string
) {
  await page.bringToFront()
  await page.mouse.move(0, 0)
  await expect(page.getByTestId('video-stage')).toBeVisible()
  const videos =
    mode === 'gallery'
      ? page.getByTestId('video-grid').locator('video:visible')
      : page.getByTestId('presentation-player').locator('video')
  for (const video of await videos.all()) {
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => {
          if (!element.videoWidth || !element.videoHeight) return false
          const canvas = document.createElement('canvas')
          canvas.width = 16
          canvas.height = 12
          const context = canvas.getContext('2d')
          if (!context) return false
          context.drawImage(element, 0, 0, canvas.width, canvas.height)
          return context
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 !== 3 && value > 20)
        })
      )
      .toBe(true)
  }
  await expect
    .poll(async () => layoutIssues(await readLayout(page), viewport, mode))
    .toEqual([])
  if (mode === 'gallery') {
    const expectedColumns =
      viewport === 'desktop'
        ? [1, 2, 2, 2, 3, 3, 4, 4, 3, 4][count - 1]
        : count <= 3
          ? 1
          : 2
    await expect
      .poll(async () => {
        const { cards } = await readLayout(page)
        const firstRowTop = cards[0]?.y ?? 0
        return cards.filter(card => Math.abs(card.y - firstRowTop) < 1).length
      })
      .toBe(expectedColumns)
  }
  const metrics = await readLayout(page)
  expect(layoutIssues(metrics, viewport, mode)).toEqual([])
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  await page.screenshot({
    path: outputPath(
      `${String(count).padStart(2, '0')}-${viewport}-${mode}.png`
    ),
  })
  if (mode === 'presentation') {
    await expectVideoPlaying(
      page.getByTestId('presentation-player').getByTestId('video-remote')
    )
  }
  if (viewport === 'mobile') {
    const grid = page.getByTestId('video-grid')
    const last = grid.locator(':scope > *').last()
    await last.scrollIntoViewIfNeeded()
    const gridBounds = await grid.boundingBox()
    const lastBounds = await last.boundingBox()
    if (!gridBounds || !lastBounds) throw new Error('Last card is not visible')
    expect(lastBounds.x).toBeGreaterThanOrEqual(gridBounds.x - 1)
    expect(lastBounds.y).toBeGreaterThanOrEqual(gridBounds.y - 1)
    expect(lastBounds.x + lastBounds.width).toBeLessThanOrEqual(
      gridBounds.x + gridBounds.width + 1
    )
    expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(
      gridBounds.y + gridBounds.height + 1
    )
    await grid.evaluate(element => {
      element.scrollTop = 0
      element.scrollLeft = 0
    })
  }
  return { count, viewport, mode, ...metrics }
}

async function setPresentation(page: Page, active: boolean) {
  const desktopToggle = page.getByTestId('toggle-screen')
  const current = (await desktopToggle.getAttribute('data-active')) === 'true'
  if (current !== active) {
    let toggle = desktopToggle
    if (!(await toggle.isVisible())) {
      await openMobileActions(page)
      toggle = page.getByTestId('mobile-toggle-screen')
    }
    await toggle.click()
  }
  await expect(desktopToggle).toHaveAttribute('data-active', String(active))
  if (active) {
    await expectVideoPlaying(
      page.getByTestId('presentation-player').getByTestId('video-remote')
    )
  } else {
    await expect(page.getByTestId('presentation-player')).toHaveCount(0)
  }
}

test('keeps gallery and presentation layouts usable with one to ten participants', async ({
  browser,
}, testInfo) => {
  test.setTimeout(600_000)
  const contexts: BrowserContext[] = []
  const measurements: unknown[] = []
  try {
    let roomId = ''
    let host: Page | undefined
    for (let count = 1; count <= 10; count++) {
      const context = await browser.newContext({ viewport: desktop })
      contexts.push(context)
      const page = await context.newPage()
      await mockDisplayMedia(page)
      if (count === 1) {
        roomId = await createMeeting(page)
        host = page
      } else {
        await joinMeetingFromWelcome(page, roomId)
      }
      await joinRoom(page, `User ${count}`)
      if (!host) throw new Error('Host page is missing')

      await expect(host.getByTestId('members-count')).toHaveText(String(count))
      await expect(host.getByTestId('video-tile')).toHaveCount(
        Math.min(count, 9)
      )
      await expect(host.getByTestId('overflow-tile')).toHaveCount(
        count > 9 ? 1 : 0
      )
      await expectVideoPlaying(host.getByTestId('video-self'))
      const remote = host
        .getByTestId('video-grid')
        .locator('video[data-testid="video-remote"]:visible')
      const remoteVideoCount = Math.min(count - 1, 5)
      await expect(remote).toHaveCount(remoteVideoCount, {
        timeout: 30_000,
      })
      for (let index = 0; index < remoteVideoCount; index++) {
        await expectVideoPlaying(remote.nth(index))
      }
      const audioOnlyCount = Math.max(Math.min(count - 1, 8) - 5, 0)
      await expect(
        host.locator(
          '[data-testid="remote-video-toggle"][data-video-enabled="false"]'
        )
      ).toHaveCount(audioOnlyCount)

      await host.setViewportSize(desktop)
      await setPresentation(host, false)
      measurements.push(
        await captureLayout(host, count, 'desktop', 'gallery', name =>
          testInfo.outputPath(name)
        )
      )
      await host.setViewportSize(mobile)
      measurements.push(
        await captureLayout(host, count, 'mobile', 'gallery', name =>
          testInfo.outputPath(name)
        )
      )
      await setPresentation(host, true)
      measurements.push(
        await captureLayout(host, count, 'mobile', 'presentation', name =>
          testInfo.outputPath(name)
        )
      )
      await host.setViewportSize(desktop)
      measurements.push(
        await captureLayout(host, count, 'desktop', 'presentation', name =>
          testInfo.outputPath(name)
        )
      )
      await setPresentation(host, false)
      test.info().annotations.push({
        type: 'layout',
        description: `${count} participants captured`,
      })
    }
  } finally {
    const body = JSON.stringify(measurements, null, 2)
    await writeFile(testInfo.outputPath('layout-measurements.json'), body)
    await testInfo.attach('layout-measurements', {
      body,
      contentType: 'application/json',
    })
    await Promise.all(contexts.map(context => context.close()))
  }
})
