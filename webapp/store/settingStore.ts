import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface settingState {
    language: string
    videoResolution: string
    screenShareResolution: string
    screenShareButtonShowed: boolean
    setLanguage: (input: string) => void
    setVideoResolution: (input: string) => void
    setScreenShareResolution: (input: string) => void
    setScreenShareButtonShowed: (input: boolean) => void
}

export const useSettingStore = create<settingState>()(
  persist(
    (set) => ({
      language: 'English',
      videoResolution: '480',
      screenShareResolution: '720',
      screenShareButtonShowed: /Mobi|Android|iPhone|iPad|HarmonyOS|HMSCore/i.test(navigator.userAgent),
      setLanguage: (input: string) => set({ language: input }),
      setVideoResolution: (input: string) => set({ videoResolution: input }),
      setScreenShareResolution: (input: string) => set({ screenShareResolution: input }),
      setScreenShareButtonShowed: (input: boolean) => set({ screenShareButtonShowed: input }),
    }),
    {
      name: 'setting-storage',
      partialize: (state) => ({
        language: state.language,
        videoResolution: state.videoResolution,
        screenShareResolution: state.screenShareResolution,
        screenShareButtonShowed: state.screenShareButtonShowed,
      }),
    }
  )
)
