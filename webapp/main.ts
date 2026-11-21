import { createApp } from 'vue'

import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'

import App from './app.vue'
import './index.css'
import './lib/log'

// PWA: installable app shell (production only; dev proxies would fight the SW cache)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}

createApp(App).mount('#root')
