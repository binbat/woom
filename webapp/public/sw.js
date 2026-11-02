const CACHE_PREFIX = 'woom-shell-'
const CACHE = '__WOOM_CACHE__'
const CORE = JSON.parse('__WOOM_PRECACHE__')
const BYPASS = /^\/(user|room|log|whip|whep|session)(\/|$)/

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(CORE)
    })()
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map(key => caches.delete(key))
      )
    })()
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (
    event.request.method !== 'GET' ||
    url.origin !== location.origin ||
    BYPASS.test(url.pathname)
  )
    return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request)
        } catch {
          const cache = await caches.open(CACHE)
          const cached = await cache.match('/index.html')
          if (cached) return cached
          throw new Error('App shell is not cached')
        }
      })()
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(event.request)
      if (cached) return cached

      const response = await fetch(event.request)
      const contentType = response.headers.get('content-type') || ''
      if (
        response.ok &&
        response.type === 'basic' &&
        response.status !== 206 &&
        !contentType.toLowerCase().includes('text/html')
      ) {
        await cache.put(event.request, response.clone())
      }
      return response
    })()
  )
})
