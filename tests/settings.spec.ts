import { expect, type Page, test } from '@playwright/test'
import { createMeeting, joinRoom } from './helper'

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
      await page.getByTestId('settings-toggle').click()
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
    await page.getByTestId('settings-toggle').click()
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
})
