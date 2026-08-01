<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { meetingJoined } from '../store/atoms'
import Layout from '../components/layout.vue'
import Prepare from '../components/prepare.vue'
import WakeLock from '../components/use/wakeLock'

defineProps<{ meetingId: string }>()

const lock = new WakeLock()

watch(meetingJoined, (joined) => {
  if (joined) {
    lock.request()
  } else {
    lock.release()
  }
}, { immediate: true })

onUnmounted(() => {
  lock.release()
})
</script>

<template>
  <div class="flex flex-col justify-around min-h-screen">
    <Layout v-if="meetingJoined" :meeting-id="meetingId" />
    <Prepare v-else :meeting-id="meetingId" />
  </div>
</template>
