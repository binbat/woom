// WOOM service worker: makes the app installable and the app shell
// available offline. API, SSE and WebRTC signaling are NEVER cached.
const CACHE = 'woom-shell-v1'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/logo.svg']

// these must always hit the network
const BYPASS = /^\/(user|room|log|whip|whep|session)(\/|$)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin || BYPASS.test(url.pathname)) {
    return
  }

  // navigations: network-first, fall back to the cached shell (SPA + offline)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // static assets (vite output is content-hashed): cache-first
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
    )
  )
})
