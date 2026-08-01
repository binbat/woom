import { createApp } from 'vue'

import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'

import App from './app.vue'
import './index.css'
import './lib/log'

createApp(App).mount('#root')
