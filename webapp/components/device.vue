<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Device, deviceNone, deviceScreen } from '../lib/device'
import { isMobile, isScreenShareSupported } from '../lib/util'
import { deviceSpeaker, roomInfo, speakerStatus } from '../store/atoms'
import { setting } from '../store/setting'
import Settings from './settings.vue'
import SvgAudio from './svg/audio.vue'
import SvgBackground from './svg/background.vue'
import SvgBackgroundCancel from './svg/background-cancel.vue'
import Loading from './svg/loading.vue'
import SvgPresentToAll from './svg/present.vue'
import SvgPresentCancel from './svg/present-cancel.vue'
import SvgSetting from './svg/setting.vue'
import SvgSpeaker from './svg/speaker.vue'
import SvgSwitchCamera from './svg/switch-camera.vue'
import SvgVideo from './svg/video.vue'
import useWhipClient from './use/whip'

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

const deviceError = ref('')

const whip = useWhipClient(props.streamId)
const virtualBackgroundEnabled = computed(
  () => whip.value.virtualBackgroundEnabled
)

const deviceSpeakerList = ref<Device[]>([deviceNone])
const deviceAudio = ref<Device[]>([deviceNone])
const deviceVideo = ref<Device[]>([deviceNone])

const isSetting = ref(false)

const permissionsQuery = async () =>
  (
    await Promise.all(
      ['camera', 'microphone'].map(
        // NOTE:
        // Firefox don't have `camera` and `microphone` in permissions
        // https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query#name
        i => navigator.permissions.query({ name: i as PermissionName })
      )
    )
  ).forEach(status => {
    // Chrome: audio_capture, video_capture
    // Safari: microphone, camera
    if (status.name === 'audio_capture' || status.name === 'microphone') {
      permissionAudio.value = status.state
    }
    if (status.name === 'video_capture' || status.name === 'camera') {
      permissionVideo.value = status.state
    }
  })

const reportDeviceError = (e: unknown) => {
  deviceError.value = e instanceof Error ? e.message : String(e)
}

const probeMedia = async (constraints: MediaStreamConstraints) => {
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  stream.getTracks().forEach(track => {
    track.stop()
  })
}

const updateDeviceList = async () => {
  try {
    try {
      await probeMedia({ audio: true, video: true })
    } catch {
      try {
        await probeMedia({ audio: true })
      } catch {
        /* permission denied */
      }
      try {
        await probeMedia({ video: true })
      } catch {
        /* permission denied */
      }
    }

    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      i => !!i.deviceId
    )
    const speakers = devices.filter(i => i.kind === 'audiooutput').map(toDevice)
    const audios = devices.filter(i => i.kind === 'audioinput').map(toDevice)
    const videos = devices.filter(i => i.kind === 'videoinput').map(toDevice)
    deviceSpeakerList.value = speakers
    deviceAudio.value = audios
    deviceVideo.value = videos

    if (deviceSpeaker.value === deviceNone.deviceId && speakers[0]) {
      deviceSpeaker.value = speakers[0].deviceId
    }
    if (whip.value.currentDeviceAudio === deviceNone.deviceId && audios[0]) {
      try {
        await whip.value.setCurrentDeviceAudio(audios[0].deviceId)
      } catch {
        /* permission can be granted later from the device controls */
      }
    }
    if (whip.value.currentDeviceVideo === deviceNone.deviceId && videos[0]) {
      try {
        await whip.value.setCurrentDeviceVideo(videos[0].deviceId)
      } catch {
        /* permission can be granted later from the device controls */
      }
    }
  } catch (e) {
    reportDeviceError(e)
  }
}

const init = async () => {
  try {
    await probeMedia({ video: true, audio: true })
    await permissionsQuery()
  } catch {
    try {
      await probeMedia({ audio: true })
      await permissionsQuery()
    } catch {
      /* permission denied */
    }
    try {
      await probeMedia({ video: true })
      await permissionsQuery()
    } catch {
      /* permission denied */
    }
  }
  await updateDeviceList()
}

onMounted(() => {
  void init()
  navigator.mediaDevices.addEventListener('devicechange', updateDeviceList)
})

onUnmounted(() => {
  navigator.mediaDevices.removeEventListener('devicechange', updateDeviceList)
})

const onChangedDeviceSpeaker = async (current: string) => {
  loadingSpeaker.value = true
  try {
    deviceSpeaker.value = current
  } finally {
    loadingSpeaker.value = false
  }
}

const onChangedDeviceAudio = async (current: string) => {
  loadingAudio.value = true
  deviceError.value = ''
  try {
    await whip.value.setCurrentDeviceAudio(current)
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingAudio.value = false
  }
}

const onChangedDeviceVideo = async (
  current: string,
  constraints?: MediaTrackConstraints
) => {
  loadingVideo.value = true
  deviceError.value = ''
  try {
    await whip.value.setCurrentDeviceVideo(current, constraints)
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingVideo.value = false
  }
}

const screenResolutions = [
  { label: '720p (Default)', value: '720' },
  { label: '1080p', value: '1080' },
  { label: 'Native', value: 'native' },
]

watch(
  [() => roomInfo.value.presenter, () => whip.value.userStatus.screen],
  ([presenter]) => {
    if (presenter && presenter !== props.streamId) {
      void whip.value.revokeScreenSharing()
    }
  },
  { immediate: true }
)

const toggleEnableScreen = async () => {
  loadingScreen.value = true
  deviceError.value = ''
  try {
    if (whip.value.userStatus.screen) {
      await whip.value.stopScreenSharing()
    } else {
      const height = Number.parseInt(setting.screenShareResolution, 10)
      const constraints = Number.isNaN(height) ? {} : { height }
      await whip.value.setCurrentDeviceVideo(deviceScreen.deviceId, constraints)
    }
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingScreen.value = false
  }
}

const canShareScreen = computed(
  () =>
    whip.value.userStatus.screen ||
    (isScreenShareSupported &&
      (!roomInfo.value.presenter ||
        roomInfo.value.presenter === props.streamId))
)

const facingMode = ref<'user' | 'environment'>('user')
const showCameraSwitch = computed(
  () =>
    isMobile &&
    whip.value.currentDeviceVideo !== deviceNone.deviceId &&
    !whip.value.userStatus.screen
)
const onSwitchCamera = async () => {
  facingMode.value = facingMode.value === 'user' ? 'environment' : 'user'
  await onChangedDeviceVideo(whip.value.currentDeviceVideo, {
    height: 480,
    facingMode: facingMode.value,
  })
}

const onChangeScreenShareResolution = async (resolution: string) => {
  setting.screenShareResolution = resolution
  if (!whip.value.userStatus.screen) return
  loadingScreen.value = true
  deviceError.value = ''
  try {
    const height = Number.parseInt(resolution, 10)
    const constraints = Number.isNaN(height) ? {} : { height }
    await whip.value.setCurrentDeviceVideo(deviceScreen.deviceId, constraints)
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingScreen.value = false
  }
}

const onToggleSpeaker = async () => {
  loadingSpeaker.value = true
  try {
    speakerStatus.value = !speakerStatus.value
  } finally {
    loadingSpeaker.value = false
  }
}

const onToggleAudio = async () => {
  loadingAudio.value = true
  deviceError.value = ''
  try {
    await whip.value.toggleEnableAudio()
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingAudio.value = false
  }
}

const onToggleVideo = async () => {
  loadingVideo.value = true
  deviceError.value = ''
  try {
    await whip.value.toggleEnableVideo()
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingVideo.value = false
  }
}

const onToggleBackground = async () => {
  loadingBackground.value = true
  deviceError.value = ''
  try {
    await whip.value.toggleEnableVirtualBackground()
  } catch (e) {
    reportDeviceError(e)
  } finally {
    loadingBackground.value = false
  }
}

const selectValue = (e: Event) => (e.target as HTMLSelectElement).value
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-2">
    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" data-testid="toggle-speaker" :disabled="loadingSpeaker" @click="onToggleSpeaker">
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
          data-testid="speaker-select"
          :disabled="loadingSpeaker"
          @change="onChangedDeviceSpeaker(selectValue($event))"
        >
          <option v-for="device in deviceSpeakerList" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" data-testid="toggle-audio" :disabled="loadingAudio" @click="onToggleAudio">
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
          data-testid="audio-select"
          :disabled="loadingAudio"
          @change="onChangedDeviceAudio(selectValue($event))"
        >
          <option v-for="device in deviceAudio" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" data-testid="toggle-video" :disabled="loadingVideo" @click="onToggleVideo">
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
          data-testid="video-select"
          :disabled="loadingVideo"
          @change="onChangedDeviceVideo(selectValue($event))"
        >
          <option v-for="device in deviceVideo" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
      <button v-if="showCameraSwitch" class="icon-btn" aria-label="Switch camera" data-testid="switch-camera" :disabled="loadingVideo" @click="onSwitchCamera">
        <SvgSwitchCamera />
      </button>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" data-testid="toggle-background" :disabled="loadingBackground || !whip.userStatus.video || whip.userStatus.screen" @click="onToggleBackground">
        <Loading v-if="loadingBackground" />
        <SvgBackgroundCancel v-else-if="virtualBackgroundEnabled" />
        <SvgBackground v-else />
      </button>
    </div>

    <div v-if="!setting.screenShareButtonShowed" class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button
        class="icon-btn"
        data-testid="toggle-screen"
        :data-active="whip.userStatus.screen ? 'true' : 'false'"
        :disabled="loadingScreen || !canShareScreen"
        @click="toggleEnableScreen()"
      >
        <Loading v-if="loadingScreen" />
        <SvgPresentCancel v-else-if="whip.userStatus.screen" />
        <SvgPresentToAll v-else />
      </button>
      <div class="relative grid place-items-center w-4 h-10">
        <select
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="setting.screenShareResolution"
          data-testid="screen-resolution"
          :disabled="loadingScreen || !canShareScreen"
          @change="onChangeScreenShareResolution(selectValue($event))"
        >
          <option v-for="r in screenResolutions" :key="r.label" :value="r.value">{{ r.label }}</option>
        </select>
        <span class="pointer-events-none text-slate-400 text-xs">&#9662;</span>
      </div>
    </div>

    <div class="flex items-center gap-1 rounded-xl bg-white/5 border border-white/10 px-1.5 py-1">
      <button class="icon-btn" aria-label="Settings" data-testid="settings-toggle" @click="isSetting = true">
        <SvgSetting />
      </button>
    </div>
    <p v-if="deviceError" class="w-full text-center text-xs text-rose-400" data-testid="device-error">{{ deviceError }}</p>
    <Settings v-if="isSetting" @close="isSetting = false" />
  </div>
</template>
