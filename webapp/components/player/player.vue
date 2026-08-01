<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  isWechat,
  isFullscreenSupported,
  isPictureInPictureSupported,
} from '../../lib/util'
import SvgProgress from '../svg/progress.vue'
import { deviceSpeaker, speakerStatus } from '../../store/atoms'
import SvgMuted from '../svg/muted.vue'
import SvgUnmuted from '../svg/unmuted.vue'
import SvgFullscreen from '../svg/fullscreen.vue'
import SvgExitFullscreen from '../svg/exit-fullscreen.vue'
import SvgPictureInPicture from '../svg/pip.vue'
import SvgExitPictureInPicture from '../svg/exit-pip.vue'
import AudioWave from './audio-wave.vue'
import Mic from './mic.vue'

const props = defineProps<{
  stream: MediaStream
  muted: boolean
  audio?: boolean
  video?: boolean
  width: string
  self: boolean
}>()

const refVideo = ref<HTMLVideoElement>()
const refControls = ref<HTMLDivElement>()
const audioTrack = computed(() => props.stream.getAudioTracks()[0])
const videoTrack = computed(() => props.stream.getVideoTracks()[0])
const showControls = ref(false)
const isMuted = ref(false)
const isFullscreened = ref(false)
const isPictureInPictured = ref(false)
const hasTracks = computed(() => props.stream.getTracks().length > 0)
const mediaEnabled = computed(() => props.audio || props.video)
const showAudio = computed(() => props.audio && !props.video)
const mediaDisabledTip = `All ${props.self ? 'your' : 'their'} media are disabled`

let timeoutId: number | undefined
let playPromise: Promise<void> | undefined

const handleMouseMove = () => {
  showControls.value = true
  if (timeoutId) clearTimeout(timeoutId)
  timeoutId = window.setTimeout(() => {
    showControls.value = false
  }, 2000)
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
}

const toggleFullscreen = () => {
  const container = refVideo.value!.parentElement!
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    container.requestFullscreen()
  }
}

const togglePictureInPicture = () => {
  const container = refVideo.value!
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture()
  } else {
    container.requestPictureInPicture()
  }
}

const onFullScreenChange = () => {
  isFullscreened.value = !!document.fullscreenElement
}
const onEnterPictureInPicture = () => {
  isPictureInPictured.value = true
}
const onLeavePictureInPicture = () => {
  isPictureInPictured.value = false
}
const onVolumeChange = () => {
  if (refVideo.value) isMuted.value = refVideo.value.muted
}

onMounted(() => {
  const video = refVideo.value
  if (isFullscreenSupported) document.addEventListener('fullscreenchange', onFullScreenChange)
  if (isPictureInPictureSupported) {
    video?.addEventListener('enterpictureinpicture', onEnterPictureInPicture)
    video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture)
  }
  video?.addEventListener('volumechange', onVolumeChange)
  const container = refControls.value?.parentElement
  container?.addEventListener('mousemove', handleMouseMove)
})

onUnmounted(() => {
  const video = refVideo.value
  document.removeEventListener('fullscreenchange', onFullScreenChange)
  video?.removeEventListener('enterpictureinpicture', onEnterPictureInPicture)
  video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture)
  video?.removeEventListener('volumechange', onVolumeChange)
  const container = refControls.value?.parentElement
  container?.removeEventListener('mousemove', handleMouseMove)
  if (timeoutId) clearTimeout(timeoutId)
})

watch(speakerStatus, (status) => {
  isMuted.value = !status
}, { immediate: true })

// play the audio track through a detached <audio> element so that the
// speaker device (setSinkId) and the mute button can be controlled
// independently of the <video> element
let audioEl: HTMLAudioElement | undefined
const teardownAudio = () => {
  const el = audioEl
  audioEl = undefined
  playPromise?.finally(() => {
    el?.pause()
    if (el) el.srcObject = null
    el?.remove()
  })
  playPromise = undefined
}
const setupAudio = () => {
  teardownAudio()
  const track = audioTrack.value
  if (track && props.audio && !props.muted && refVideo.value) {
    const el = document.createElement('audio')
    el.srcObject = new MediaStream([track])

    if (el.setSinkId) {
      el.setSinkId(deviceSpeaker.value)
    }

    el.muted = !speakerStatus.value || isMuted.value
    refVideo.value.muted = !speakerStatus.value || isMuted.value
    audioEl = el
    playPromise = el.play()
  }
}

const applyStream = () => {
  if (refVideo.value && videoTrack.value) {
    refVideo.value.srcObject = new MediaStream([videoTrack.value])

    // NOTE: About Autoplay
    // Reference: https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide
    // NOTE:
    // iOS Wechat WebView
    // https://developers.weixin.qq.com/community/develop/doc/0006a61de48ab0165f99e1dcd51c00
    if (isWechat()) refVideo.value.play()
  }
}

// NOTE: template refs are only attached after mount, so both bindings must
// be (re)applied from onMounted as well as on later changes
onMounted(() => {
  setupAudio()
  applyStream()
})
watch([audioTrack, videoTrack, deviceSpeaker, speakerStatus, isMuted], setupAudio)
watch(videoTrack, applyStream)
onUnmounted(teardownAudio)
</script>

<!-- NOTE: iOS can't display video
https://webkit.org/blog/6784/new-video-policies-for-ios/ -->
<template>
  <div class="relative flex flex-col justify-center items-center min-h-60 rounded-xl bg-black m-8" :style="{ width: width }">
    <p
      v-if="!mediaEnabled"
      class="text-white transition-opacity duration-300"
      :class="showControls ? 'opacity-100' : 'opacity-0'"
    >{{ mediaDisabledTip }}</p>
    <SvgProgress v-if="mediaEnabled && !hasTracks" />
    <video
      ref="refVideo"
      class="aspect-ratio-[4/3] w-full h-full object-contain rounded-xl"
      :data-testid="self ? 'video-self' : 'video-remote'"
      :playsinline="true"
      :autoplay="true"
      :controls="false"
      :muted="true"
      :style="stream?.getVideoTracks().length
        ? { display: video ? 'inline' : 'none' }
        : { height: '0px' }"
    />
    <div v-if="showAudio" class="w-full"><AudioWave :stream="stream" /></div>
    <Mic :stream="stream" />
    <div
      ref="refControls"
      class="absolute bottom-0 left-0 right-0 rounded-b-xl px-4 py-3 flex justify-between items-center transition-opacity duration-300"
      :class="showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'"
    >
      <button
        class="rounded-md"
        :class="muted ? 'opacity-0 pointer-events-none' : 'disabled:bg-gray-400 disabled:opacity-70'"
        :disabled="!speakerStatus"
        @click="toggleMute"
      >
        <SvgMuted v-if="isMuted" />
        <SvgUnmuted v-else />
      </button>
      <div class="flex items-center space-x-2">
        <button
          class="rounded-md disabled:hidden"
          :disabled="!isFullscreenSupported || isPictureInPictured"
          @click="toggleFullscreen"
        >
          <SvgExitFullscreen v-if="isFullscreened" />
          <SvgFullscreen v-else />
        </button>
        <button
          class="rounded-md disabled:hidden"
          :disabled="!isPictureInPictureSupported || !video"
          @click="togglePictureInPicture"
        >
          <SvgExitPictureInPicture v-if="isPictureInPictured" />
          <SvgPictureInPicture v-else />
        </button>
      </div>
    </div>
  </div>
</template>
