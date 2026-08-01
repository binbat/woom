<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import useWhipClient from './use/whip'
import {
  Device,
  deviceNone,
  deviceScreen,
} from '../lib/device'
import { isScreenShareSupported } from '../lib/util'
import { deviceSpeaker, speakerStatus } from '../store/atoms'
import { setting } from '../store/setting'

import Loading from './svg/loading.vue'
import SvgSpeaker from './svg/speaker.vue'
import SvgAudio from './svg/audio.vue'
import SvgVideo from './svg/video.vue'
import SvgPresentCancel from './svg/present-cancel.vue'
import SvgPresentToAll from './svg/present.vue'
import SvgBackgroundCancel from './svg/background-cancel.vue'
import SvgBackground from './svg/background.vue'
import SvgSetting from './svg/setting.vue'
import Settings from './settings.vue'

const props = defineProps<{ streamId: string }>()

function toDevice(info: MediaDeviceInfo): Device {
  const deviceId = info.deviceId
  let label = info.label
  if (label.length <= 0) {
    label = `${info.kind} (${deviceId.substring(0, 8)})`
  }
  return { deviceId, label }
}

const permissionAudio = ref('')
const permissionVideo = ref('')

const loadingSpeaker = ref(false)
const loadingAudio = ref(false)
const loadingVideo = ref(false)
const loadingScreen = ref(false)
const loadingBackground = ref(false)

const virtualBackgroundEnabled = ref(false)

const whip = useWhipClient(props.streamId)

const deviceSpeakerList = ref<Device[]>([deviceNone])
const deviceAudio = ref<Device[]>([deviceNone])
const deviceVideo = ref<Device[]>([deviceNone])

const isSetting = ref(false)

const permissionsQuery = async () =>
  (await Promise.all(['camera', 'microphone'].map(
    // NOTE:
    // Firefox don't have `camera` and `microphone` in permissions
    // https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query#name
    i => navigator.permissions.query({ name: i as PermissionName })
  ))).map(status => {
    // Chrome: audio_capture, video_capture
    // Safari: microphone, camera
    if (status.name === 'audio_capture' || status.name === 'microphone') {
      permissionAudio.value = status.state
    }
    if (status.name === 'video_capture' || status.name === 'camera') {
      permissionVideo.value = status.state
    }
  })

const updateDeviceList = async () => {
  // to obtain non-empty device label, there needs to be an active media stream or persistent permission
  // https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo/label#value
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
  } catch {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch { /* empty */ }

    try {
      await navigator.mediaDevices.getUserMedia({ video: true })
    } catch { /* empty */ }
  }

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(i => !!i.deviceId)

  const speakers = devices.filter(i => i.kind === 'audiooutput').map(toDevice)
  const audios = devices.filter(i => i.kind === 'audioinput').map(toDevice)
  const videos = devices.filter(i => i.kind === 'videoinput').map(toDevice)

  if (deviceSpeaker.value === deviceNone.deviceId) {
    const device = speakers[0]
    if (device) deviceSpeaker.value = device.deviceId
  }

  if (whip.value.currentDeviceAudio === deviceNone.deviceId) {
    const device = audios[0]
    if (device) await whip.value.setCurrentDeviceAudio(device.deviceId)
  }

  if (whip.value.currentDeviceVideo === deviceNone.deviceId) {
    const device = videos[0]
    if (device) await whip.value.setCurrentDeviceVideo(device.deviceId)
  }

  deviceSpeakerList.value = [...speakers]
  deviceAudio.value = [...audios]
  deviceVideo.value = [...videos]
}

const init = async () => {
  try {
    (await navigator.mediaDevices.getUserMedia({ video: true, audio: true })).getTracks().map(track => track.stop())
    // NOTE:
    // In some device have problem:
    // - Android Web Browser
    // - Wechat WebView
    await permissionsQuery()
  } catch {
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().map(track => track.stop())
      await permissionsQuery()
    } catch { /* empty */ }
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().map(track => track.stop())
      await permissionsQuery()
    } catch { /* empty */ }
  }
  await updateDeviceList()
}

onMounted(() => {
  init()
  // Reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
  navigator.mediaDevices.addEventListener('devicechange', updateDeviceList)
})

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', updateDeviceList)
})

const onChangedDeviceSpeaker = async (current: string) => {
  loadingSpeaker.value = true
  deviceSpeaker.value = current
  loadingSpeaker.value = false
}

const onChangedDeviceAudio = async (current: string) => {
  loadingAudio.value = true
  await whip.value.setCurrentDeviceAudio(current)
  loadingAudio.value = false
}

const onChangedDeviceVideo = async (current: string, constraints?: MediaTrackConstraints) => {
  loadingVideo.value = true
  await whip.value.setCurrentDeviceVideo(current, constraints)
  if (whip.value.userStatus.screen) {
    virtualBackgroundEnabled.value = false
  }
  loadingVideo.value = false
}

const screenResolutions = [
  { label: '720p (Default)', value: '720' },
  { label: '1080p', value: '1080' },
  { label: 'Native', value: 'native' }
]

watch(() => setting.screenShareResolution, () => {
  if (whip.value.userStatus.screen) {
    onChangedDeviceVideo(deviceNone.deviceId)
  }
})

const toggleEnableScreen = async () => {
  const height = Number.parseInt(setting.screenShareResolution)
  const constraints = Number.isNaN(height) ? {} : { height }
  loadingScreen.value = true
  await onChangedDeviceVideo(whip.value.userStatus.screen ? deviceNone.deviceId : deviceScreen.deviceId, constraints)
  loadingScreen.value = false
}

const onChangeScreenShareResolution = async (resolution: string) => {
  setting.screenShareResolution = resolution
  const height = Number.parseInt(resolution)
  const constraints = Number.isNaN(height) ? {} : { height }
  loadingScreen.value = true
  await onChangedDeviceVideo(deviceScreen.deviceId, constraints)
  loadingScreen.value = false
}

const onToggleSpeaker = async () => {
  loadingSpeaker.value = true
  speakerStatus.value = !speakerStatus.value
  loadingSpeaker.value = false
}

const onToggleAudio = async () => {
  loadingAudio.value = true
  whip.value.toggleEnableAudio()
  loadingAudio.value = false
}

const onToggleVideo = async () => {
  loadingVideo.value = true
  await whip.value.toggleEnableVideo()
  if (!whip.value.userStatus.video && virtualBackgroundEnabled.value) {
    virtualBackgroundEnabled.value = false
  }
  loadingVideo.value = false
}

const onToggleBackground = async () => {
  loadingBackground.value = true
  await whip.value.toggleEnableVirtualBackground()
  virtualBackgroundEnabled.value = !virtualBackgroundEnabled.value
  loadingBackground.value = false
}

const selectValue = (e: Event) => (e.target as HTMLSelectElement).value
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-2">
    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" @click="onToggleSpeaker">
        <Loading v-if="loadingSpeaker" />
        <SvgSpeaker v-else />
      </button>
      <div class="relative w-0 h-10 pointer-events-none">
        <div v-if="!speakerStatus" class="absolute -left-9 top-1/2 w-8 h-0.5 bg-rose-500 rounded-full rotate-45"></div>
      </div>
      <div class="relative grid place-items-center w-4 h-10">
        <select
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="deviceSpeaker"
          @change="onChangedDeviceSpeaker(selectValue($event))"
        >
          <option v-for="device in deviceSpeakerList" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" @click="onToggleAudio">
        <Loading v-if="loadingAudio" />
        <SvgAudio v-else />
      </button>
      <div class="relative w-0 h-10 pointer-events-none">
        <div v-if="permissionAudio !== 'granted'" class="absolute -left-4 top-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
        <div v-if="!whip.userStatus.audio" class="absolute -left-9 top-1/2 w-8 h-0.5 bg-rose-500 rounded-full rotate-45"></div>
      </div>
      <div class="relative grid place-items-center w-4 h-10">
        <select
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="whip.currentDeviceAudio"
          @change="onChangedDeviceAudio(selectValue($event))"
        >
          <option v-for="device in deviceAudio" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" @click="onToggleVideo">
        <Loading v-if="loadingVideo" />
        <SvgVideo v-else />
      </button>
      <div class="relative w-0 h-10 pointer-events-none">
        <div v-if="permissionVideo !== 'granted'" class="absolute -left-4 top-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
        <div v-if="!whip.userStatus.video" class="absolute -left-9 top-1/2 w-8 h-0.5 bg-rose-500 rounded-full rotate-45"></div>
      </div>
      <div class="relative grid place-items-center w-4 h-10">
        <select
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="whip.currentDeviceVideo"
          @change="onChangedDeviceVideo(selectValue($event))"
        >
          <option v-for="device in deviceVideo" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" :disabled="!whip.userStatus.video || whip.userStatus.screen" @click="onToggleBackground">
        <Loading v-if="loadingBackground" />
        <SvgBackgroundCancel v-else-if="virtualBackgroundEnabled" />
        <SvgBackground v-else />
      </button>
    </div>

    <div v-if="!setting.screenShareButtonShowed" class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" :disabled="!isScreenShareSupported" @click="toggleEnableScreen()">
        <Loading v-if="loadingScreen" />
        <SvgPresentCancel v-else-if="whip.userStatus.screen" />
        <SvgPresentToAll v-else />
      </button>
      <div class="relative grid place-items-center w-4 h-10">
        <select
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="setting.screenShareResolution"
          :disabled="!isScreenShareSupported"
          @change="onChangeScreenShareResolution(selectValue($event))"
        >
          <option v-for="r in screenResolutions" :key="r.label" :value="r.value">{{ r.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" aria-label="Settings" @click="isSetting = true">
        <SvgSetting />
      </button>
    </div>
    <Settings v-if="isSetting" @close="isSetting = false" />
  </div>
</template>
