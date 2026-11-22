import {
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test'
import {
  createMeeting,
  expectVideoPlaying,
  joinMeetingFromWelcome,
  joinRoom,
  mockDisplayMedia,
  openMobileActions,
  openSettings,
} from './helper'

type Participant = { name: string; page: Page }

const test = base.extend<{ participants: Participant[] }>({
  participants: async ({ browser, viewport }, use) => {
    const contexts: BrowserContext[] = []
    const participants: Participant[] = []
    try {
      let roomId = ''
      for (const name of ['Alice', 'Bob', 'Carol']) {
        const context = await browser.newContext({ viewport })
        contexts.push(context)
        const page = await context.newPage()
        await mockDisplayMedia(page)
        if (!roomId) {
          roomId = await createMeeting(page)
        } else {
          await joinMeetingFromWelcome(page, roomId)
        }
        await joinRoom(page, name)
        participants.push({ name, page })
      }
      await use(participants)
    } finally {
      await Promise.all(contexts.map(context => context.close()))
    }
  },
})

async function expectAllVideosPlaying(participants: Participant[]) {
  await Promise.all(
    participants.map(async ({ page }) => {
      await expect(page.getByTestId('video-self')).toHaveCount(1)
      await expect(page.getByTestId('video-remote')).toHaveCount(2, {
        timeout: 30_000,
      })
      await expectVideoPlaying(page.getByTestId('video-self'))
      const remote = page.getByTestId('video-remote')
      await expectVideoPlaying(remote.nth(0))
      await expectVideoPlaying(remote.nth(1))
      await expect(page.getByTestId('members-count')).toHaveText('3')
    })
  )
}

async function expectWithinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const page = locator.page()
      const viewport = page.viewportSize()
      const box = await locator.boundingBox()
      if (!viewport || !box) return { fits: false, viewport, box }
      return {
        fits:
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1,
        viewport,
        box,
      }
    })
    .toMatchObject({ fits: true })
}

async function expectWithin(container: Locator, child: Locator) {
  await expect
    .poll(async () => {
      const outer = await container.boundingBox()
      const inner = await child.boundingBox()
      if (!outer || !inner) return false
      return (
        inner.x >= outer.x - 1 &&
        inner.y >= outer.y - 1 &&
        inner.x + inner.width <= outer.x + outer.width + 1 &&
        inner.y + inner.height <= outer.y + outer.height + 1
      )
    })
    .toBe(true)
}

async function expectNoOverlap(first: Locator, second: Locator) {
  const a = await first.boundingBox()
  const b = await second.boundingBox()
  if (!a || !b) throw new Error('Cannot measure an invisible layout element')
  expect(
    a.x + a.width <= b.x + 1 ||
      b.x + b.width <= a.x + 1 ||
      a.y + a.height <= b.y + 1 ||
      b.y + b.height <= a.y + 1
  ).toBe(true)
}

async function expectHitTarget(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate(el => {
        const rect = el.getBoundingClientRect()
        const top = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        )
        return el === top || el.contains(top)
      })
    )
    .toBe(true)
}

async function expectTilesDoNotOverlap(page: Page) {
  const boxes = await page.getByTestId('video-tile').evaluateAll(elements =>
    elements.map(el => {
      const rect = el.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }
    })
  )
  expect(boxes).toHaveLength(3)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      expect(
        a.right <= b.left + 1 ||
          b.right <= a.left + 1 ||
          a.bottom <= b.top + 1 ||
          b.bottom <= a.top + 1
      ).toBe(true)
    }
  }
}

async function expectSettingsOnTop(page: Page) {
  await openSettings(page)
  await expectWithinViewport(page.getByTestId('settings-dialog'))
  await expectHitTarget(page.getByTestId('settings-close'))
  expect(
    await page.getByTestId('settings-dialog').evaluate(el => {
      const rect = el.getBoundingClientRect()
      const top = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
      )
      return el.contains(top)
    })
  ).toBe(true)
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
}

test.describe('three users', () => {
  test.setTimeout(120_000)

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('keeps the video grid and side panels usable', async ({
      participants,
    }) => {
      await expectAllVideosPlaying(participants)
      const alice = participants[0].page
      await expectNoOverlap(
        alice.getByTestId('video-stage'),
        alice.getByTestId('meeting-controls')
      )
      await expectTilesDoNotOverlap(alice)
      await expectWithin(
        alice.getByTestId('video-stage'),
        alice.getByTestId('video-grid')
      )

      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(3)
      await expectWithinViewport(alice.getByTestId('members-panel'))
      await expectHitTarget(alice.getByTestId('members-close'))
      await expectNoOverlap(
        alice.getByTestId('video-stage'),
        alice.getByTestId('members-panel')
      )
      for (const tile of await alice.getByTestId('video-tile').all()) {
        await expectWithin(alice.getByTestId('video-stage'), tile)
      }
      await alice.getByTestId('members-close').click()

      await alice.getByTestId('chat-toggle').click()
      await expectWithinViewport(alice.getByTestId('chat-panel'))
      await expectHitTarget(alice.getByTestId('chat-close'))
      await alice.getByTestId('chat-close').click()

      await expectSettingsOnTop(alice)
    })

    test('lays out a shared screen and settings above other content', async ({
      participants,
    }) => {
      await expectAllVideosPlaying(participants)
      const alice = participants[0].page
      const share = alice.getByTestId('toggle-screen')
      await share.click()
      await expect(share).toHaveAttribute('data-active', 'true')

      for (const { page } of participants) {
        const presentation = page.getByTestId('presentation-player')
        await expectVideoPlaying(presentation.getByTestId('video-remote'))
        await expectWithin(page.getByTestId('video-stage'), presentation)
        await expectNoOverlap(presentation, page.getByTestId('video-grid'))
        await expectTilesDoNotOverlap(page)
      }

      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(3)
      await expectWithinViewport(alice.getByTestId('members-panel'))
      await expectNoOverlap(
        alice.getByTestId('video-stage'),
        alice.getByTestId('members-panel')
      )
      await expectSettingsOnTop(alice)
      await alice.getByTestId('members-close').click()
      await share.click()
      await expect(share).toHaveAttribute('data-active', 'false')
    })
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('keeps three tiles and controls within a narrow viewport', async ({
      participants,
    }, testInfo) => {
      await expectAllVideosPlaying(participants)
      const alice = participants[0].page
      await expectTilesDoNotOverlap(alice)
      for (const tile of await alice.getByTestId('video-tile').all()) {
        await expectWithinViewport(tile)
      }
      for (const control of [
        'toggle-audio',
        'toggle-video',
        'members-toggle',
        'chat-toggle',
        'more-toggle',
        'hang-up',
      ]) {
        await expectWithinViewport(alice.getByTestId(control))
        await expectHitTarget(alice.getByTestId(control))
      }
      expect(
        await alice.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      const stageBeforePanel = await alice
        .getByTestId('video-stage')
        .boundingBox()
      await alice.screenshot({
        path: testInfo.outputPath('mobile-meeting-controls.png'),
      })

      await alice.getByTestId('members-toggle').click()
      await expect(alice.getByTestId('member-row')).toHaveCount(3)
      await expectWithinViewport(alice.getByTestId('members-panel'))
      expect(await alice.getByTestId('video-stage').boundingBox()).toEqual(
        stageBeforePanel
      )
      for (const name of participants.map(participant => participant.name)) {
        await expect(alice.getByTestId('members-list')).toContainText(name)
      }
      for (const row of await alice.getByTestId('member-row').all()) {
        await expectWithinViewport(row)
        await expectWithin(alice.getByTestId('members-panel'), row)
      }
      for (const kick of await alice.getByTestId('member-kick').all()) {
        await expectWithinViewport(kick)
      }
      await expectHitTarget(alice.getByTestId('members-close'))
      const closeBounds = await alice.getByTestId('members-close').boundingBox()
      expect(closeBounds?.width).toBeGreaterThanOrEqual(44)
      expect(closeBounds?.height).toBeGreaterThanOrEqual(44)
      await alice.screenshot({
        path: testInfo.outputPath('mobile-members-sheet.png'),
      })
      await alice.getByTestId('members-close').click()

      await alice.getByTestId('chat-toggle').click()
      await expectWithinViewport(alice.getByTestId('chat-panel'))
      await expectHitTarget(alice.getByTestId('chat-close'))
      expect(await alice.getByTestId('video-stage').boundingBox()).toEqual(
        stageBeforePanel
      )
      await alice.getByTestId('chat-input').fill('Hello from mobile')
      await alice.getByTestId('chat-send').click()
      await expect(alice.getByTestId('chat-message')).toHaveText(
        'Hello from mobile'
      )
      await expectWithinViewport(alice.getByTestId('chat-input'))
      await alice.screenshot({
        path: testInfo.outputPath('mobile-chat-sheet.png'),
      })
      await alice.keyboard.press('Escape')
      await expect(alice.getByTestId('chat-panel')).toHaveCount(0)
      await alice.getByTestId('chat-toggle').click()
      await alice.mouse.click(5, 5)
      await expect(alice.getByTestId('chat-panel')).toHaveCount(0)

      await openMobileActions(alice)
      await expectHitTarget(alice.getByTestId('more-close'))
      await expectWithinViewport(alice.getByTestId('mobile-settings-toggle'))
      await alice.screenshot({
        path: testInfo.outputPath('mobile-more-sheet.png'),
      })
      await alice.getByTestId('more-close').click()
      await expectSettingsOnTop(alice)
    })
  })
})
