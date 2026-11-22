import { expect, type Locator, test } from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  joinMeetingFromWelcome,
  joinRoom,
  mockDisplayMedia,
} from './helper'

async function expectWithinViewport(locator: Locator) {
  const page = locator.page()
  const viewport = page.viewportSize()
  const box = await locator.boundingBox()
  if (!viewport || !box) throw new Error('Cannot measure the details dialog')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

async function expectHitTarget(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const top = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        )
        return element === top || element.contains(top)
      })
    )
    .toBe(true)
}

test('shows local and remote details and reconnects the local stream', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const alice = await aliceContext.newPage()
  const bob = await bobContext.newPage()
  try {
    const roomId = await createMeeting(alice)
    await joinRoom(alice, 'Alice')
    await joinMeetingFromWelcome(bob, roomId)
    await joinRoom(bob, 'Bob')
    await expectVideoPlaying(alice.getByTestId('video-remote'))
    await expectVideoPlaying(bob.getByTestId('video-remote'))

    const localToggle = alice.getByTestId('stream-details-toggle').first()
    await localToggle.click()
    const dialog = alice.getByTestId('stream-details-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Alice')
    await expect(alice.getByTestId('stream-connection')).toContainText(
      'Connected'
    )
    const media = alice.getByTestId('stream-media-status')
    await expect(media).toContainText('Microphone')
    await expect(media).toContainText('Camera')
    await expect(media).toContainText('Screen sharing')
    await expect(alice.getByTestId('stream-id')).toBeHidden()
    await alice.getByTestId('stream-technical-toggle').click()
    await expect(alice.getByTestId('stream-id')).toBeVisible()
    await expect(alice.getByTestId('stream-id')).not.toBeEmpty()
    await alice.getByTestId('stream-id-copy').click()
    await expect(alice.getByTestId('stream-id-copy')).toHaveText('Copied')
    await alice.keyboard.press('Escape')
    await expect(alice.getByTestId('stream-details-overlay')).toHaveCount(0)
    await expect(localToggle).toBeFocused()

    await localToggle.click()
    await alice.getByTestId('stream-details-backdrop').click({
      position: { x: 5, y: 5 },
    })
    await expect(alice.getByTestId('stream-details-overlay')).toHaveCount(0)

    await bob.getByTestId('stream-details-toggle').nth(1).click()
    await expect(bob.getByTestId('stream-details-dialog')).toContainText(
      'Alice'
    )
    await expect(bob.getByTestId('stream-connection')).toContainText(
      'Connected'
    )
    await bob.getByTestId('stream-details-close').click()
    await expect(bob.getByTestId('stream-details-overlay')).toHaveCount(0)

    await localToggle.click()
    const reconnectRequest = alice.waitForRequest(request => {
      const path = new URL(request.url()).pathname
      return request.method() === 'POST' && path.startsWith('/whip/')
    })
    await alice.getByTestId('stream-reconnect').click()
    await reconnectRequest
    await alice.getByTestId('stream-details-close').click()
    await expectVideoPlaying(alice.getByTestId('video-self'))
  } finally {
    await aliceContext.close()
    await bobContext.close()
  }
})

test('keeps a long name and details usable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createMeeting(page)
  await joinRoom(page, 'Alice with a very long display name')
  const tile = page.getByTestId('video-tile').first()
  const toggle = tile.getByTestId('stream-details-toggle')
  const tileBox = await tile.boundingBox()
  const toggleBox = await toggle.boundingBox()
  if (!tileBox || !toggleBox) throw new Error('Cannot measure the name trigger')
  expect(toggleBox.x).toBeGreaterThanOrEqual(tileBox.x)
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(
    tileBox.x + tileBox.width
  )

  await toggle.click()
  await expectWithinViewport(page.getByTestId('stream-details-dialog'))
  await expectHitTarget(page.getByTestId('stream-details-close'))
  await expectHitTarget(page.getByTestId('stream-reconnect'))
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByTestId('stream-details-close').click()
})

test('opens details above the shared screen layout', async ({ page }) => {
  await mockDisplayMedia(page)
  await createMeeting(page)
  await joinRoom(page, 'Alice')
  const share = page.getByTestId('toggle-screen')
  await share.click()
  await expect(share).toHaveAttribute('data-active', 'true')
  await expectVideoPlaying(
    page.getByTestId('presentation-player').getByTestId('video-remote')
  )

  await page.getByTestId('stream-details-toggle').first().click()
  await expectWithinViewport(page.getByTestId('stream-details-dialog'))
  await expectHitTarget(page.getByTestId('stream-details-close'))
  await expectHitTarget(page.getByTestId('stream-reconnect'))
  await page.getByTestId('stream-details-close').click()
})
