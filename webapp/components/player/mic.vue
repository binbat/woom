<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import SvgMic from '../svg/mic.vue'
import VolumeExtractor from '../use/volumeExtraction'

const props = defineProps<{ stream: MediaStream }>()

const volumeValue = ref(0)
const rest = computed(() => 100 - volumeValue.value)

let stopFlag = { stopped: false }

watch(() => props.stream, (stream) => {
  stopFlag.stopped = true
  stopFlag = { stopped: false }
  const flag = stopFlag
  if (stream.getAudioTracks().length) {
    const extractor = new VolumeExtractor(stream)
    const updateVolume = () => {
      volumeValue.value = extractor.calculateVolume()
      if (!flag.stopped) requestAnimationFrame(updateVolume)
    }
    updateVolume()
  }
}, { immediate: true })

onUnmounted(() => {
  stopFlag.stopped = true
})
</script>

<template>
  <div
    class="absolute top-0 right-0 rounded-xl p-1 m-2 transition-opacity duration-300"
    :style="{
      background: `linear-gradient(to bottom, white ${rest}%, red ${volumeValue}%)`,
      opacity: volumeValue > 3 ? '1' : '0'
    }"
  >
    <SvgMic />
  </div>
</template>
