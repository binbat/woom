import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { createMeeting, getApiToken, getStreamId, joinRoom } from './helper'

const ADMIN_USER = 'admin'
const ADMIN_PASSWORD = 'e2e-admin-9f6c2a84d17b43e0a5c98f21e6d04b7a'
const CAPTION_TOKEN = 'e2e-caption-9f6c2a84d17b43e0a5c98f21e6d04b7a'

async function adminSignIn(page: Page) {
  await page.goto('/admin')
  await page.getByTestId('admin-username').fill(ADMIN_USER)
  await page.getByTestId('admin-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('admin-sign-in').click()
  await expect(page.getByTestId('admin-sign-out')).toBeVisible()
}

// Seed one archived meeting (caption + chat) through the API and return its
// room id; uses a throwaway page only for the standard join flow
async function seedRecord(
  page: Page,
  request: APIRequestContext
): Promise<string> {
  const roomId = await createMeeting(page)
  await joinRoom(page, 'Alice')
  const userId = await getStreamId(page)
  const headers = { Authorization: `Bearer ${await getApiToken(page)}` }

  const caption = await request.post(`/room/${roomId}/caption`, {
    headers: { Authorization: `Bearer ${CAPTION_TOKEN}` },
    data: { id: 'f1', userId, text: 'admin console transcript', isFinal: true },
  })
  expect(caption.status()).toBe(201)
  const message = await request.post(`/room/${roomId}/message`, {
    headers,
    data: { content: 'admin console chat' },
  })
  expect(message.status()).toBe(201)
  const ended = await request.post(`/room/${roomId}/end`, { headers })
  expect(ended.ok()).toBe(true)
  return roomId
}

test('admin console gates on credentials and survives a reload', async ({
  page,
}) => {
  await page.goto('/admin')
  await expect(page.getByTestId('admin-login')).toBeVisible()
  // the admin path must not be treated as a room id on the welcome page
  await expect(page.getByTestId('meeting-id-input')).toHaveCount(0)

  await page.getByTestId('admin-username').fill(ADMIN_USER)
  await page.getByTestId('admin-password').fill('wrong-password')
  await page.getByTestId('admin-sign-in').click()
  await expect(page.getByTestId('admin-login-error')).toContainText('Invalid')

  await page.getByTestId('admin-password').fill(ADMIN_PASSWORD)
  await page.getByTestId('admin-sign-in').click()
  await expect(page.getByTestId('admin-sign-out')).toBeVisible()
  await expect(page.getByTestId('admin-identity')).toContainText(ADMIN_USER)
  await expect(page.getByTestId('admin-records-empty')).toBeVisible()

  // the token lives in sessionStorage: a reload keeps the session
  await page.reload()
  await expect(page.getByTestId('admin-sign-out')).toBeVisible()

  await page.getByTestId('admin-sign-out').click()
  await expect(page.getByTestId('admin-login')).toBeVisible()
})

test('admin lists, inspects, replays and deletes meeting records', async ({
  page,
  request,
}) => {
  const roomId = await seedRecord(page, request)
  await adminSignIn(page)

  const item = page.getByTestId('admin-record-item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText(roomId)

  await page.getByTestId('admin-record-expand').click()
  const transcript = page.getByTestId('admin-transcript')
  await expect(transcript).toContainText('admin console transcript')

  await page.getByTestId('admin-tab-chat').click()
  await expect(page.getByTestId('admin-chat')).toContainText(
    'admin console chat'
  )

  await page.getByTestId('admin-tab-replay').click()
  await expect(page.getByTestId('admin-replay')).toBeVisible()
  await expect(page.getByTestId('replay-entry')).toHaveCount(2)

  // no MINUTES_URL in the e2e environment: the action reports "not enabled"
  await page.getByTestId('admin-tab-minutes').click()
  await page.getByTestId('admin-record-minutes').click()
  await expect(page.getByTestId('admin-minutes-hint')).toContainText(
    'not enabled'
  )

  // two-step delete, then the record is gone for good
  await page.getByTestId('admin-record-delete').click()
  await page.getByTestId('admin-record-delete').click()
  await expect(page.getByTestId('admin-records-empty')).toBeVisible()
  await page.getByTestId('admin-records-refresh').click()
  await expect(page.getByTestId('admin-records-empty')).toBeVisible()

  const headers = { Authorization: `Bearer ${await getApiToken(page)}` }
  const records = await request.get(`/room/${roomId}/records`, { headers })
  expect(await records.json()).toEqual([])
})
