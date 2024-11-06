import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import React from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
import presetAttributify from '@unocss/preset-attributify'
import presetIcons from '@unocss/preset-icons'
import presetUno from '@unocss/preset-uno'

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
    UnoCSS({
      shortcuts: [
        { logo: 'i-logos-react w-6em h-6em transform transition-800 hover:rotate-180' },
        { 'btn-primary': 'py-2 px-4 bg-blue-500 duration-500 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 disabled:pointer-events-none disabled:bg-slate-300' }
      ],
      presets: [
        presetUno(),
        presetAttributify(),
        presetIcons({
          extraProperties: {
            'display': 'inline-block',
            'vertical-align': 'middle'
          }
        })
      ]
    }),
    React()
  ]
})
