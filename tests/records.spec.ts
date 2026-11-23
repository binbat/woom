import { type APIRequestContext, expect, test } from '@playwright/test'
import {
  createMeeting,
  getApiToken,
  getStreamId,
  joinMeetingFromWelcome,
  joinRoom,
} from './helper'

const CAPTION_TOKEN = 'e2e-caption-9f6c2a84d17b43e0a5c98f21e6d04b7a'

interface CaptionBody {
  id: string
  userId: string
  text: string
  isFinal: boolean
}

// Same transcription endpoint the caption bot uses; archiving is what matters
// here, so plain 201-asserting posts without SSE synchronization are fine
function postCaption(
  request: APIRequestContext,
  roomId: string,
  body: CaptionBody
) {
  return request.post(`/room/${roomId}/caption`, {
    headers: { Authorization: `Bearer ${CAPTION_TOKEN}` },
    data: body,
  })
}

// Room-scoped meeting history: only the room owner sees archived records on
// the pre-join page, with transcripts and server-dependent minutes.
test.describe('meeting records', () => {
  test('owner sees transcript in room history', async ({ page, request }) => {
    const roomId = await createMeeting(page)
    await joinRoom(page, 'Alice')
    const userId = await getStreamId(page)

    // final segments are archived into the record; partials never persist
    for (const body of [
      { id: 'f1', text: '第一句', isFinal: true },
      { id: 'f2', text: 'second sentence', isFinal: true },
      { id: 'p1', text: '不应该出现', isFinal: false },
    ]) {
      const res = await postCaption(request, roomId, { userId, ...body })
      expect(res.status()).toBe(201)
    }

    const headers = { Authorization: `Bearer ${await getApiToken(page)}` }
    const ended = await request.post(`/room/${roomId}/end`, { headers })
    expect(ended.ok()).toBe(true)

    await page.goto(`/${roomId}`)
    await expect(page.getByTestId('records-section')).toBeVisible()
    await expect(page.getByTestId('record-item')).toHaveCount(1)

    await page.getByTestId('record-expand').click()
    const transcript = page.getByTestId('record-transcript')
    await expect(transcript).toContainText('第一句')
    await expect(transcript).toContainText('second sentence')
    await expect(transcript).not.toContainText('不应该出现')

    // the e2e server has no minutes upstream configured
    await page.getByTestId('record-minutes').click()
    await expect(page.getByTestId('minutes-hint')).toBeVisible()
    await expect(page.getByTestId('minutes-hint')).toContainText('not enabled')
  })

  test('non-owner sees no history', async ({ browser, request }) => {
    const aliceContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bob = await bobContext.newPage()

    try {
      const roomId = await createMeeting(alice)
      await joinRoom(alice, 'Alice')

      let recordsRequests = 0
      bob.on('request', req => {
        if (new URL(req.url()).pathname === `/room/${roomId}/records`)
          recordsRequests++
      })
      await joinMeetingFromWelcome(bob, roomId)
      await joinRoom(bob, 'Bob')

      const headers = { Authorization: `Bearer ${await getApiToken(alice)}` }
      const ended = await request.post(`/room/${roomId}/end`, { headers })
      expect(ended.ok()).toBe(true)

      // Bob revisits the room with his own credentials: no fetch, no section
      await bob.reload({ waitUntil: 'networkidle' })
      await expect(bob.getByTestId('records-section')).toHaveCount(0)
      expect(recordsRequests).toBe(0)
    } finally {
      await aliceContext.close()
      await bobContext.close()
    }
  })
})
