<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import SvgMic from '../svg/mic.vue'
import VolumeExtractor from '../use/volumeExtraction'

const props = defineProps<{ stream: MediaStream }>()

const volumeValue = ref(0)
const rest = computed(() => 100 - volumeValue.value)

let extractor: VolumeExtractor | undefined
let animationFrame = 0

const stop = () => {
  cancelAnimationFrame(animationFrame)
  extractor?.close()
  extractor = undefined
  volumeValue.value = 0
}

watch(
  () => props.stream,
  stream => {
    stop()
    if (stream.getAudioTracks().length) {
      extractor = new VolumeExtractor(stream)
      const updateVolume = () => {
        if (!extractor) return
        volumeValue.value = extractor.calculateVolume()
        animationFrame = requestAnimationFrame(updateVolume)
      }
      updateVolume()
    }
  },
  { immediate: true }
)

onUnmounted(stop)
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
