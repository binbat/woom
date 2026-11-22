import { reactive, watch } from 'vue'
import {
  isVirtualBackgroundId,
  type VirtualBackgroundId,
} from '../lib/background'

const STORAGE_KEY = 'setting-storage'

type Theme = 'light' | 'dark'

interface SettingState {
  language: string
  theme: Theme
  virtualBackground: VirtualBackgroundId
  videoResolution: string
  screenShareResolution: string
  screenShareButtonShowed: boolean
}

const defaultState = (): SettingState => ({
  language: 'English',
  theme: 'dark',
  virtualBackground: 'studio',
  videoResolution: '480',
  screenShareResolution: '720',
  screenShareButtonShowed: /Mobi|Android|iPhone|iPad|HarmonyOS|HMSCore/i.test(
    navigator.userAgent
  ),
})

function load(): SettingState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    // the old zustand/persist format stored the fields under `state`
    const stored = raw.state ?? raw
    const theme =
      stored.theme === 'light' || stored.theme === 'dark'
        ? stored.theme
        : 'dark'
    const virtualBackground = isVirtualBackgroundId(stored.virtualBackground)
      ? stored.virtualBackground
      : 'studio'
    return { ...defaultState(), ...stored, theme, virtualBackground }
  } catch {
    return defaultState()
  }
}

const setting = reactive<SettingState>(load())

watch(
  () => setting.theme,
  theme => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0a0f1e' : '#f1f5f9')
  },
  { immediate: true }
)

watch(setting, s => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      language: s.language,
      theme: s.theme,
      virtualBackground: s.virtualBackground,
      videoResolution: s.videoResolution,
      screenShareResolution: s.screenShareResolution,
      screenShareButtonShowed: s.screenShareButtonShowed,
    })
  )
})

export type { Theme }
export { setting }
