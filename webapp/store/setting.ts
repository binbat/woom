import { reactive, watch } from 'vue'

const STORAGE_KEY = 'setting-storage'

interface SettingState {
  language: string
  videoResolution: string
  screenShareResolution: string
  screenShareButtonShowed: boolean
}

const defaultState = (): SettingState => ({
  language: 'English',
  videoResolution: '480',
  screenShareResolution: '720',
  screenShareButtonShowed: /Mobi|Android|iPhone|iPad|HarmonyOS|HMSCore/i.test(navigator.userAgent),
})

function load(): SettingState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    // the old zustand/persist format stored the fields under `state`
    const stored = raw.state ?? raw
    return { ...defaultState(), ...stored }
  } catch {
    return defaultState()
  }
}

const setting = reactive<SettingState>(load())

watch(setting, (s) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    language: s.language,
    videoResolution: s.videoResolution,
    screenShareResolution: s.screenShareResolution,
    screenShareButtonShowed: s.screenShareButtonShowed,
  }))
})

export {
  setting,
}
