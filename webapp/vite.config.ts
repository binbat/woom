import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

const ProjectRoot = path.resolve(import.meta.dirname, '..')
const WebAppRoot = path.resolve(ProjectRoot, 'webapp')
const DistRoot = path.resolve(ProjectRoot, 'static/dist')

const precacheServiceWorker = () => ({
  name: 'woom-precache-service-worker',
  apply: 'build' as const,
  closeBundle: async () => {
    const html = await readFile(path.join(DistRoot, 'index.html'), 'utf8')
    const urls = new Set([
      '/index.html',
      '/manifest.webmanifest',
      '/logo.svg',
      '/apple-touch-icon.png',
      '/icon-192.png',
      '/icon-512.png',
      '/icon-maskable-512.png',
    ])
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
      const url = match[1]
      if (url.startsWith('/') && !url.startsWith('//')) urls.add(url)
    }

    const precache = [...urls].sort()
    const hash = createHash('sha256')
    for (const url of precache) {
      const pathname = decodeURIComponent(
        new URL(url, 'http://woom.local').pathname
      )
      const contents = await readFile(
        path.join(DistRoot, pathname.replace(/^\/+/, ''))
      )
      hash.update(url).update(contents)
    }
    const serviceWorkerPath = path.join(DistRoot, 'sw.js')
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8')
    hash.update(serviceWorker)
    const version = hash.digest('hex').slice(0, 16)
    const output = serviceWorker
      .replace('__WOOM_CACHE__', `woom-shell-${version}`)
      .replace('__WOOM_PRECACHE__', JSON.stringify(precache))
    await writeFile(serviceWorkerPath, output)
  },
})

/**
 * vite config
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
  root: WebAppRoot,
  publicDir: path.resolve(WebAppRoot, 'public'),
  server: {
    proxy: {
      '^/session/.*': 'http://localhost:4000',
      '^/whip/.*': 'http://localhost:4000',
      '^/whep/.*': 'http://localhost:4000',
      '^/log(?:/|$)': 'http://localhost:4000',
      '^/room/.*': 'http://localhost:4000',
      '^/user/.*': 'http://localhost:4000',
    },
  },
  build: {
    outDir: DistRoot,
    emptyOutDir: true,
  },
  plugins: [
    UnoCSS(path.resolve(WebAppRoot, 'uno.config.ts')),
    Vue(),
    precacheServiceWorker(),
  ],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: WebAppRoot,
      },
      // "./wasm" was not defind in "exports" of "@mediapipe/tasks-vision"
      {
        find: '@mediapipe/tasks-vision/wasm',
        replacement: path.join(
          ProjectRoot,
          'node_modules',
          '@mediapipe',
          'tasks-vision',
          'wasm'
        ),
      },
    ],
  },
  optimizeDeps: {
    // vite would complain without excluding them
    exclude: [
      '@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url',
      '@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url',
    ],
  },
})
