<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { MeetingRecord } from '../lib/api'

interface ReplayEntry {
  kind: 'chat' | 'caption'
  ts: number
  name: string
  text: string
}

const props = defineProps<{ record: MeetingRecord }>()

/** chat messages and transcript lines merged onto one timeline */
const entries = computed<ReplayEntry[]>(() => {
  const chat = props.record.messages.map(message => ({
    kind: 'chat' as const,
    ts: message.ts,
    name: message.name,
    text: message.content,
  }))
  const captions = props.record.captions.map(caption => ({
    kind: 'caption' as const,
    ts: caption.ts,
    name: caption.name,
    text: caption.text,
  }))
  return [...chat, ...captions].sort((a, b) => a.ts - b.ts)
})

const startTs = computed(() => entries.value[0]?.ts ?? 0)
const total = computed(() =>
  Math.max(
    0,
    (entries.value[entries.value.length - 1]?.ts ?? 0) - startTs.value
  )
)

/** virtual seconds elapsed; null means the static view showing everything */
const clock = ref<number | null>(null)
const playing = ref(false)
const speed = ref(1)
const listEl = ref<HTMLElement | null>(null)

const visible = computed(() => {
  const elapsed = clock.value
  if (elapsed === null) return entries.value
  return entries.value.filter(entry => entry.ts - startTs.value <= elapsed)
})
const progress = computed(() =>
  Math.min(clock.value ?? total.value, total.value)
)

let timer: number | undefined
const stopTimer = () => {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}
const startTimer = () => {
  stopTimer()
  timer = window.setInterval(() => {
    clock.value = Math.min(total.value, (clock.value ?? 0) + 0.25 * speed.value)
    if (clock.value >= total.value) {
      playing.value = false
      stopTimer()
    }
  }, 250)
}

const toggle = () => {
  if (playing.value) {
    playing.value = false
    stopTimer()
    return
  }
  if (clock.value === null || clock.value >= total.value) clock.value = 0
  playing.value = true
  startTimer()
}

const reset = () => {
  playing.value = false
  stopTimer()
  clock.value = null
}

watch(speed, () => {
  if (playing.value) startTimer()
})

watch(
  () => visible.value.length,
  async () => {
    await nextTick()
    if (playing.value && listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight
    }
  }
)

onUnmounted(stopTimer)

const formatClock = (secs: number) => {
  const rounded = Math.round(secs)
  const mm = Math.floor(rounded / 60)
    .toString()
    .padStart(2, '0')
  const ss = (rounded % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="admin-replay">
    <div class="flex flex-wrap items-center gap-2">
      <button
        class="btn-primary px-3 py-1.5 text-sm"
        :disabled="!entries.length"
        data-testid="replay-toggle"
        @click="toggle"
      >
        {{ playing ? 'Pause' : 'Play' }}
      </button>
      <select
        v-model.number="speed"
        class="input-control px-2 py-1.5 text-sm"
        data-testid="replay-speed"
      >
        <option :value="1">1x</option>
        <option :value="2">2x</option>
        <option :value="4">4x</option>
      </select>
      <button
        class="icon-btn w-auto px-3 h-9 text-sm"
        :disabled="clock === null"
        data-testid="replay-reset"
        @click="reset"
      >
        Reset
      </button>
      <span class="ml-auto text-xs text-muted font-mono" data-testid="replay-progress">
        {{ formatClock(progress) }} / {{ formatClock(total) }}
      </span>
    </div>

    <div ref="listEl" class="max-h-72 overflow-y-auto rounded-xl bg-surface px-3 py-2 flex flex-col gap-1.5">
      <template v-if="visible.length">
        <p
          v-for="(entry, index) in visible"
          :key="index"
          class="text-sm text-foreground break-words whitespace-pre-wrap"
          data-testid="replay-entry"
        >
          <span class="text-xs text-muted font-mono">+{{ formatClock(entry.ts - startTs) }}</span>
          <span
            class="mx-1.5 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide"
            :class="entry.kind === 'chat' ? 'bg-control text-muted' : 'bg-indigo-500/20 text-accent'"
          >{{ entry.kind === 'chat' ? 'chat' : 'speech' }}</span>
          <span class="font-medium">{{ entry.name }}:</span>
          {{ entry.text }}
        </p>
      </template>
      <p v-else class="text-sm text-muted" data-testid="replay-empty">
        {{ clock === null ? 'Nothing to replay' : '…' }}
      </p>
    </div>
  </div>
</template>
