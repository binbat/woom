import { expect, test } from '@playwright/test'

test.describe('versioned offline app shell', () => {
  test('first installation starts offline with its built assets', async ({
    browser,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    try {
      const page = await context.newPage()
      await page.goto('/')
      const shell = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        if (!registration.active)
          throw new Error('Service worker is not active')
        const key = (await caches.keys()).find(name =>
          name.startsWith('woom-shell-')
        )
        if (!key) throw new Error('Versioned shell cache is missing')
        const cache = await caches.open(key)
        const urls = (await cache.keys()).map(
          request => new URL(request.url).pathname
        )
        return {
          key,
          urls,
          hasShell: !!(await cache.match('/index.html')),
        }
      })
      expect(shell.key).toMatch(/^woom-shell-[a-f0-9]{16}$/)
      expect(shell.hasShell).toBe(true)
      expect(shell.urls).toContain('/manifest.webmanifest')
      expect(shell.urls).toContain('/icon-192.png')
      expect(shell.urls.some(url => /^\/assets\/.*\.js$/.test(url))).toBe(true)
      expect(shell.urls.some(url => /^\/assets\/.*\.css$/.test(url))).toBe(true)

      await page.close()
      await context.setOffline(true)
      const offlinePage = await context.newPage()
      await offlinePage.goto('/')
      await expect(offlinePage.getByTestId('new-meeting')).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('navigations and HTML responses cannot poison the shell cache', async ({
    browser,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    try {
      const page = await context.newPage()
      await page.goto('/')
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await page.reload()
      await page.evaluate(async () => {
        const key = (await caches.keys()).find(name =>
          name.startsWith('woom-shell-')
        )
        if (!key) throw new Error('Versioned shell cache is missing')
        const cache = await caches.open(key)
        await cache.put(
          '/index.html',
          new Response('offline-shell-sentinel', {
            headers: { 'Content-Type': 'text/html' },
          })
        )
      })

      await page.goto('/123-456-789')
      const cachedNavigation = await page.evaluate(async () => {
        const key = (await caches.keys()).find(name =>
          name.startsWith('woom-shell-')
        )
        if (!key) throw new Error('Versioned shell cache is missing')
        const cache = await caches.open(key)
        const shell = await cache.match('/index.html')
        if (!shell) throw new Error('Cached app shell is missing')
        return shell.text()
      })
      expect(cachedNavigation).toBe('offline-shell-sentinel')

      await page.evaluate(async () => {
        const response = await fetch('/index.html?cache-pollution-check')
        if (!response.ok) throw new Error('HTML fixture request failed')
        await response.text()
      })
      const cachedHtml = await page.evaluate(async () => {
        const key = (await caches.keys()).find(name =>
          name.startsWith('woom-shell-')
        )
        if (!key) throw new Error('Versioned shell cache is missing')
        const cache = await caches.open(key)
        return !!(await cache.match('/index.html?cache-pollution-check'))
      })
      expect(cachedHtml).toBe(false)
    } finally {
      await context.close()
    }
  })
})
