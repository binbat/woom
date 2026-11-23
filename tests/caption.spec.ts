import { type APIRequestContext, expect, test } from '@playwright/test'
import { createMeeting, getStreamId, joinRoom } from './helper'

const CAPTION_TOKEN = 'e2e-caption-9f6c2a84d17b43e0a5c98f21e6d04b7a'

interface CaptionBody {
  id: string
  userId: string
  text: string
  isFinal: boolean
}

// Server-side transcription endpoint; same shape the caption bot uses
function postCaption(
  request: APIRequestContext,
  roomId: string,
  body: CaptionBody,
  token = CAPTION_TOKEN
) {
  return request.post(`/room/${roomId}/caption`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  })
}

// Live captions: segments arrive over SSE and render as an overlay on the
// video stage; partial results share an id and revise in place.
test.describe('live captions', () => {
  test('renders, revises in place, and finalizes captions', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext()
    const alice = await context.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      const userId = await getStreamId(alice)

      await expect(alice.getByTestId('caption-overlay')).toHaveCount(0)

      // The SSE subscription may still be connecting right after join;
      // re-posting the same segment id is idempotent, so retry until the
      // overlay shows it.
      await expect(async () => {
        const res = await postCaption(request, roomId, {
          id: 's1',
          userId,
          text: '你',
          isFinal: false,
        })
        expect(res.status()).toBe(201)
        await expect(alice.getByTestId('caption-line')).toHaveCount(1, {
          timeout: 1_000,
        })
      }).toPass({ timeout: 15_000 })
      await expect(alice.getByTestId('caption-line')).toContainText('你')

      // a partial result with the same id revises the line in place
      let res = await postCaption(request, roomId, {
        id: 's1',
        userId,
        text: '你好，世',
        isFinal: false,
      })
      expect(res.status()).toBe(201)
      await expect(alice.getByTestId('caption-line')).toHaveCount(1)
      await expect(alice.getByTestId('caption-line')).toContainText('你好，世')

      // finalizing commits the full sentence
      res = await postCaption(request, roomId, {
        id: 's1',
        userId,
        text: '你好，世界',
        isFinal: true,
      })
      expect(res.status()).toBe(201)
      await expect(alice.getByTestId('caption-line')).toHaveCount(1)
      await expect(alice.getByTestId('caption-line')).toContainText(
        '你好，世界'
      )

      // a new segment id adds a second line
      res = await postCaption(request, roomId, {
        id: 's2',
        userId,
        text: '第二句',
        isFinal: true,
      })
      expect(res.status()).toBe(201)
      await expect(alice.getByTestId('caption-line')).toHaveCount(2)
      await expect(alice.getByTestId('caption-line').nth(1)).toContainText(
        '第二句'
      )
    } finally {
      await context.close()
    }
  })

  test('rejects invalid caption posts', async ({ browser, request }) => {
    const context = await browser.newContext()
    const alice = await context.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')
      const userId = await getStreamId(alice)

      // wrong bearer token
      let res = await postCaption(
        request,
        roomId,
        { id: 's1', userId, text: 'hello', isFinal: true },
        'e2e-caption-00000000000000000000000000000000'
      )
      expect(res.status()).toBe(401)

      // userId is not an active participant of the room
      res = await postCaption(request, roomId, {
        id: 's1',
        userId: '00000000-0000-0000-0000-000000000000',
        text: 'hello',
        isFinal: true,
      })
      expect(res.status()).toBe(403)

      // empty text
      res = await postCaption(request, roomId, {
        id: 's1',
        userId,
        text: '',
        isFinal: true,
      })
      expect(res.status()).toBe(400)
    } finally {
      await context.close()
    }
  })
})
