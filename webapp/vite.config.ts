import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import UnoCSS from 'unocss/vite'
import React from '@vitejs/plugin-react'

const ProjectRoot = resolve(import.meta.dirname, '..')
const WebAppRoot = resolve(ProjectRoot, 'webapp')

/**
 * vite config
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
  root: WebAppRoot,
  publicDir: resolve(WebAppRoot, 'public'),
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
    outDir: resolve(ProjectRoot, 'static/dist'),
    emptyOutDir: true
  },
  plugins: [
    UnoCSS(resolve(WebAppRoot, 'uno.config.ts')),
    React(),
  ],
  resolve: {
    alias: {
      '@': ProjectRoot,
    }
  }
})
