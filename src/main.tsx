import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'virtual:uno.css'
import App from './app'
import { DevTools } from 'jotai-devtools'

import '@unocss/reset/tailwind-compat.css'

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(
  <React.StrictMode>
    <DevTools />
    <App />
  </React.StrictMode>,
)
