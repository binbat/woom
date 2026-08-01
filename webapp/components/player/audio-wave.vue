<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'

const props = defineProps<{ stream: MediaStream }>()

const refWave = ref<HTMLDivElement>()

let destroy: (() => void) | undefined

const setup = () => {
  destroy?.()
  destroy = undefined
  if (refWave.value && !!props.stream?.getAudioTracks().length) {
    const wavesurfer = WaveSurfer.create({
      container: refWave.value,
      waveColor: 'rgb(200, 100, 0)',
      progressColor: 'rgb(100, 50, 0)',
    })

    const record = wavesurfer.registerPlugin(RecordPlugin.create())
    const { onDestroy, onEnd } = record.renderMicStream(new MediaStream(props.stream.getAudioTracks()))

    destroy = () => {
      onDestroy()
      onEnd()
      wavesurfer.destroy()
    }
  }
}

// template refs are only attached after mount
onMounted(setup)
watch(() => props.stream, setup)

onUnmounted(() => {
  destroy?.()
})
</script>

<template>
  <div ref="refWave"></div>
</template>
