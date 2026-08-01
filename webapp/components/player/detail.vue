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
  <details class="absolute left-8 top-8 text-white text-sm font-border">
    <summary class="text-center rounded-lg px-xs" :style="{ backgroundColor: connStatus === 'connected' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)' }">{{ userStatus.name }}</summary>
    <center>
      <div class="flex flex-row flex-wrap justify-around">
        <p>name: <code>{{ userStatus.name }}</code></p>
        <p>state: <code>{{ String(userStatus.state) }}</code></p>
      </div>
      <div class="flex flex-row flex-wrap justify-around">
        <p>audio: <code>{{ String(userStatus.audio) }}</code></p>
        <p>video: <code>{{ String(userStatus.video) }}</code></p>
        <p>screen: <code>{{ String(userStatus.screen) }}</code></p>
      </div>
      <code>{{ streamId }}</code>
    </center>

    <center class="text-white flex flex-row justify-around">
      <p class="rounded-xl p-2 b-1 hover:border-orange-300">{{ userStatus.state }}</p>
      <button class="btn-primary" @click="restart">restart</button>
    </center>
  </details>
</template>
