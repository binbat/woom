import { expect, test } from '@playwright/test'
import { createMeeting, getApiToken, joinRoom } from './helper'

test.describe('welcome page', () => {
  test('renders join controls', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'WOOM' })).toBeVisible()
    await expect(page.getByTestId('new-meeting')).toBeEnabled()
    await expect(page.getByTestId('meeting-id-input')).toHaveValue('')
    await expect(page.getByTestId('join-meeting')).toBeDisabled()
  })

  test('pre-fills meeting id from URL', async ({ page }) => {
    await page.goto('/123-456-789')

    await expect(page.getByTestId('meeting-id-input')).toHaveValue(
      '123-456-789'
    )
    await expect(page.getByTestId('join-meeting')).toBeEnabled()
    // "New Meeting" must not be available when an id is entered
    await expect(page.getByTestId('new-meeting')).toBeDisabled()
  })

  test('does not show archived meeting records', async ({ page }) => {
    let recordRequests = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/user/records') recordRequests++
    })
    const roomId = await createMeeting(page)
    await joinRoom(page, 'Alice')
    const headers = { Authorization: `Bearer ${await getApiToken(page)}` }
    const ended = await page.request.post(`/room/${roomId}/end`, { headers })
    expect(ended.ok()).toBe(true)
    const archived = await page.request.get('/user/records', { headers })
    expect(archived.ok()).toBe(true)
    const records = (await archived.json()) as Array<{ roomId: string }>
    expect(records.some(record => record.roomId === roomId)).toBe(true)

    await page.goto('/', { waitUntil: 'networkidle' })

    await expect(page.getByTestId('new-meeting')).toBeEnabled()
    await expect(page.getByTestId('welcome-page')).not.toContainText(
      'Meeting Records'
    )
    await expect(page.getByTestId('welcome-page')).not.toContainText(roomId)
    expect(recordRequests).toBe(0)
  })
})
