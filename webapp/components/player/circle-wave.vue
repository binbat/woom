<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

/**
 * Circular audio spectrum ring around the video-off avatar, in the style
 * of music-player "dial" effects: a dense ring of fine radial ticks that
 * pulses with the audio spectrum.
 */

const props = defineProps<{ stream: MediaStream }>()

const SIZE = 180
const RADIUS = 52
const TICKS = 120

const canvasRef = ref<HTMLCanvasElement>()
let audioContext: AudioContext | undefined
let raf = 0

const stop = () => {
  cancelAnimationFrame(raf)
  audioContext?.close().catch(() => {})
  audioContext = undefined
}

const start = () => {
  stop()
  const canvas = canvasRef.value
  const tracks = props.stream?.getAudioTracks() ?? []
  if (!canvas || !tracks.length) return

  audioContext = new AudioContext()
  audioContext.resume().catch(() => {})
  const source = audioContext.createMediaStreamSource(new MediaStream(tracks))
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8
  source.connect(analyser)

  const data = new Uint8Array(analyser.frequencyBinCount)
  const ctx = canvas.getContext('2d')!
  const center = SIZE / 2

  const draw = () => {
    raf = requestAnimationFrame(draw)
    analyser.getByteFrequencyData(data)
    ctx.clearRect(0, 0, SIZE, SIZE)

    for (let i = 0; i < TICKS; i++) {
      // spread the frequency bins evenly over the tick ring, focusing on
      // the lower 3/4 of the spectrum where speech energy lives
      const bin = Math.floor((i / TICKS) * data.length * 0.75)
      const v = data[bin] / 255
      const angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2
      const len = 3 + v * 24
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      ctx.strokeStyle = `rgba(129, 140, 248, ${0.25 + v * 0.75})`
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(center + cos * RADIUS, center + sin * RADIUS)
      ctx.lineTo(center + cos * (RADIUS + len), center + sin * (RADIUS + len))
      ctx.stroke()
    }
  }
  draw()
}

onMounted(start)
watch(() => props.stream, start)
onUnmounted(stop)
</script>

<template>
  <canvas
    ref="canvasRef"
    :width="SIZE"
    :height="SIZE"
    class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
    data-testid="circle-wave"
  />
</template>
