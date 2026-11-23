<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { Caption } from '../lib/api'

const EXPIRY_SECONDS = 8
const MAX_VISIBLE = 3

const props = defineProps<{ captions: Caption[] }>()

// tick so segments expire on schedule even when no new caption events arrive
const now = ref(Date.now())
const ticker = window.setInterval(() => {
  now.value = Date.now()
}, 1000)
onUnmounted(() => window.clearInterval(ticker))

// server ts is unix seconds
const visible = computed(() =>
  props.captions
    .filter(c => now.value / 1000 - c.ts < EXPIRY_SECONDS)
    .slice(-MAX_VISIBLE)
)
</script>

<template>
  <div
    v-if="visible.length"
    class="absolute inset-x-0 bottom-4 z-10 flex justify-center px-4 pointer-events-none"
    data-testid="caption-overlay"
  >
    <div class="flex max-w-3xl flex-col gap-0.5 rounded-2xl bg-black/60 px-4 py-2 text-center backdrop-blur">
      <p
        v-for="c in visible"
        :key="c.id"
        class="text-sm text-white break-words md:text-base"
        :class="{ 'italic opacity-70': !c.isFinal }"
        data-testid="caption-line"
      >{{ c.name }}: {{ c.text }}</p>
    </div>
  </div>
</template>
