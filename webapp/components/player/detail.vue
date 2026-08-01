<script setup lang="ts">
import type { UserStatus } from '../../store/atoms'

defineProps<{
  streamId: string
  connStatus: string
  userStatus: UserStatus
  restart: () => void
}>()
</script>

<template>
  <details class="absolute left-2 top-2 text-white text-xs font-border">
    <summary class="inline-block text-center rounded-lg px-2.5 py-1 backdrop-blur cursor-pointer list-none" :style="{ backgroundColor: connStatus === 'connected' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)' }">{{ userStatus.name }}</summary>
    <div class="mt-2 rounded-xl bg-black/70 backdrop-blur p-3 ring-1 ring-white/10">
      <div class="flex flex-row flex-wrap justify-around gap-x-3">
        <p>name: <code>{{ userStatus.name }}</code></p>
        <p>state: <code>{{ String(userStatus.state) }}</code></p>
      </div>
      <div class="flex flex-row flex-wrap justify-around gap-x-3">
        <p>audio: <code>{{ String(userStatus.audio) }}</code></p>
        <p>video: <code>{{ String(userStatus.video) }}</code></p>
        <p>screen: <code>{{ String(userStatus.screen) }}</code></p>
      </div>
      <code class="block text-center mt-1 text-slate-400">{{ streamId }}</code>

      <div class="mt-2 flex flex-row items-center justify-around gap-2">
        <p class="rounded-lg px-2 py-1 b-1 hover:border-orange-300">{{ userStatus.state }}</p>
        <button class="btn-primary px-3 py-1 text-xs" @click="restart">restart</button>
      </div>
    </div>
  </details>
</template>
