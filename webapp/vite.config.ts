import path from 'node:path'

import { defineConfig } from 'vite'
import UnoCSS from 'unocss/vite'
import React from '@vitejs/plugin-react'

const ProjectRoot = path.resolve(import.meta.dirname, '..')
const WebAppRoot = path.resolve(ProjectRoot, 'webapp')

/**
 * vite config
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
  root: WebAppRoot,
  publicDir: path.resolve(WebAppRoot, 'public'),
  server: {
    proxy: {
      '^/session/.*': 'http://localhost:7777',
      '^/whip/.*': 'http://localhost:7777',
      '^/whep/.*': 'http://localhost:7777',
      '^/room/.*': 'http://localhost:4000',
      '^/user/.*': 'http://localhost:4000'
    }
  },
  build: {
    outDir: path.resolve(ProjectRoot, 'static/dist'),
    emptyOutDir: true
  },
  plugins: [
    UnoCSS(path.resolve(WebAppRoot, 'uno.config.ts')),
    React()
  ],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: WebAppRoot
      },
      // "./wasm" was not defind in "exports" of "@mediapipe/tasks-vision"
      {
        find: '@mediapipe/tasks-vision/wasm',
        replacement: path.join(ProjectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
      }
    ]
  },
  optimizeDeps: {
    // vite would complain without excluding them
    exclude: [
      '@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url',
      '@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'
    ]
  },
})
