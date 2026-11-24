<script setup lang="ts">
import type { MediaPlayerClass } from 'dashjs'
import { onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{ src: string }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const playbackError = ref('')

let player: MediaPlayerClass | undefined

onMounted(async () => {
  if (!videoEl.value) return
  // dash.js is heavy and rarely used: keep it out of the initial bundle
  const dashjs = await import('dashjs')
  if (!videoEl.value) return
  player = dashjs.MediaPlayer().create()
  player.initialize(videoEl.value, props.src, false)
  player.on(dashjs.MediaPlayer.events.ERROR, () => {
    playbackError.value = 'Playback failed'
  })
})

onUnmounted(() => {
  player?.destroy()
  player = undefined
})
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="dash-player">
    <video
      ref="videoEl"
      class="w-full rounded-xl bg-black max-h-96"
      controls
      playsinline
    />
    <p v-if="playbackError" class="text-xs text-danger" data-testid="dash-player-error">
      {{ playbackError }}
    </p>
  </div>
</template>
