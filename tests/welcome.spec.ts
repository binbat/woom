import { test, expect } from '@playwright/test'

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

    await expect(page.getByTestId('meeting-id-input')).toHaveValue('123-456-789')
    await expect(page.getByTestId('join-meeting')).toBeEnabled()
    // "New Meeting" must not be available when an id is entered
    await expect(page.getByTestId('new-meeting')).toBeDisabled()
  })
})
