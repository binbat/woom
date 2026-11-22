import { expect, type Page, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  joinRoom,
  mockDisplayMedia,
  openSettings,
} from './helper'

const expectViewportOverlay = async (page: Page) => {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Viewport is missing')
  const overlay = page.getByTestId('settings-overlay')
  await expect(overlay).toBeVisible()
  await expect
    .poll(async () => overlay.boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    })
  expect(
    await overlay.evaluate(el => el.contains(document.elementFromPoint(1, 1)))
  ).toBe(true)
}

test.describe('settings', () => {
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`covers the viewport and fits controls on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await openSettings(page)
      await expectViewportOverlay(page)

      const dialog = await page.getByTestId('settings-dialog').boundingBox()
      if (!dialog) throw new Error('Settings dialog is missing')
      expect(dialog.x).toBeGreaterThanOrEqual(0)
      expect(dialog.y).toBeGreaterThanOrEqual(0)
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(viewport.width)
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(viewport.height)

      for (const tab of ['media', 'advanced']) {
        await page.getByTestId(`settings-tab-${tab}`).click()
        await expect
          .poll(() =>
            page
              .getByTestId('settings-content')
              .evaluate(el => el.scrollWidth <= el.clientWidth)
          )
          .toBe(true)
      }

      await page.getByTestId('settings-close').click()
      await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
    })
  }

  test('stays above the meeting controls', async ({ page }) => {
    await createMeeting(page)
    await joinRoom(page, 'Alice')
    await openSettings(page)
    await expectViewportOverlay(page)

    expect(
      await page.getByTestId('hang-up').evaluate(el => {
        const rect = el.getBoundingClientRect()
        const top = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        )
        return !el.contains(top)
      })
    ).toBe(true)

    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  })

  test('stays above a fullscreen presentation', async ({ page }) => {
    await mockDisplayMedia(page)
    await createMeeting(page)
    await joinRoom(page, 'Alice')
    const toggle = page.getByTestId('toggle-screen')
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-active', 'true')

    const presentation = page.getByTestId('presentation-player')
    await expectVideoPlaying(presentation.getByTestId('video-remote'))
    await presentation.getByTestId('video-remote').hover()
    await presentation.getByTestId('fullscreen-toggle').click()
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true)

    // The fullscreen element hides the toolbar, so activate its button directly.
    await page
      .getByTestId('settings-toggle')
      .evaluate((el: HTMLButtonElement) => el.click())
    await expectViewportOverlay(page)
    await expect(page.getByTestId('settings-overlay')).toHaveJSProperty(
      'open',
      true
    )
    expect(
      await page.getByTestId('settings-dialog').evaluate(el => {
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
        return el.contains(top)
      })
    ).toBe(true)
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)

    await page.getByTestId('settings-close').click()
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  })

  test('switches and persists light and dark themes', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)
    await expect(page.getByTestId('theme-select')).toHaveValue('dark')

    for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId('theme-select').selectOption(theme)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe(theme)
      await expect(page.getByTestId('settings-dialog')).toHaveCSS(
        'background-color',
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(15, 23, 42)'
      )
      await expect
        .poll(() =>
          page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        )
        .toBe(theme === 'light' ? 'rgb(241, 245, 249)' : 'rgb(10, 15, 30)')

      await page.reload()
      await openSettings(page)
      await expect(page.getByTestId('theme-select')).toHaveValue(theme)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe(theme)
    }
  })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'small mobile', width: 320, height: 700 },
  ]) {
    test(`themes meeting surfaces without overflow on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await createMeeting(page)
      await joinRoom(page, 'Alice')

      await expect(page.getByTestId('meeting-controls')).toHaveCSS(
        'background-color',
        'rgba(15, 23, 42, 0.92)'
      )
      if (viewport.name === 'desktop') {
        await expect(page.getByTestId('meeting-id-copy')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        )
        await expect(page.getByTestId('meeting-id')).toHaveCSS(
          'color',
          'rgb(165, 180, 252)'
        )
      } else {
        const controlIds = [
          'toggle-audio',
          'toggle-video',
          'members-toggle',
          'chat-toggle',
          'more-toggle',
          'hang-up',
        ]
        const panelBounds = await page
          .getByTestId('meeting-controls')
          .boundingBox()
        if (!panelBounds) throw new Error('Meeting controls are missing')
        const controlBounds = await Promise.all(
          controlIds.map(async id => {
            const bounds = await page.getByTestId(id).boundingBox()
            if (!bounds) throw new Error(`${id} is missing`)
            return bounds
          })
        )
        const rowCenters = controlBounds
          .map(bounds => bounds.y + bounds.height / 2)
          .sort((a, b) => a - b)
        const rows = rowCenters.filter(
          (center, index) => index === 0 || center - rowCenters[index - 1] > 10
        )
        expect(rows).toHaveLength(1)
        for (const bounds of controlBounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(panelBounds.x)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(
            panelBounds.x + panelBounds.width
          )
        }
      }

      await openSettings(page)
      await page.getByTestId('theme-select').selectOption('light')
      await page.getByTestId('settings-close').click()
      await expect(page.getByTestId('meeting-controls')).toHaveCSS(
        'background-color',
        'rgba(255, 255, 255, 0.94)'
      )
      if (viewport.name === 'desktop') {
        await expect(page.getByTestId('meeting-id')).toHaveCSS(
          'color',
          'rgb(79, 70, 229)'
        )
      }

      await page.getByTestId('chat-toggle').click()
      await expect(page.getByTestId('chat-dialog')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      )
      const chatBounds = await page.getByTestId('chat-dialog').boundingBox()
      const sendBounds = await page.getByTestId('chat-send').boundingBox()
      if (!chatBounds || !sendBounds)
        throw new Error('Chat controls are missing')
      expect(sendBounds.x).toBeGreaterThanOrEqual(chatBounds.x)
      expect(sendBounds.x + sendBounds.width).toBeLessThanOrEqual(
        chatBounds.x + chatBounds.width
      )
      await page.getByTestId('chat-input').fill('Light theme message')
      await page.getByTestId('chat-send').click()
      await expect(page.getByTestId('chat-message')).toHaveText(
        'Light theme message'
      )
      await page.getByTestId('chat-close').click()

      await page.getByTestId('members-toggle').click()
      await expect(page.getByTestId('members-dialog')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      )
      await expect(page.getByTestId('member-row')).toHaveCSS(
        'color',
        'rgb(30, 41, 59)'
      )
      await page.getByTestId('members-close').click()

      await page.getByTestId('stream-details-toggle').click()
      await expect(page.getByTestId('stream-details-dialog')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      )
      await expect(page.getByTestId('stream-details-dialog')).toHaveCSS(
        'color',
        'rgb(30, 41, 59)'
      )
      await page.getByTestId('stream-details-close').click()
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        .toBe(true)
    })
  }
})
