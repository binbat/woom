import React from 'react'
import { createRoot } from 'react-dom/client'
import { DevTools } from 'jotai-devtools'

import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'
import 'jotai-devtools/styles.css'

import App from './app'
import './index.css'

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(
  <React.StrictMode>
    <DevTools />
    <App />
  </React.StrictMode>,
)
