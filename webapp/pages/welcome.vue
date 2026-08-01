<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Join from '../components/join.vue'
import { getMyRecords, MeetingRecord, setApiToken } from '../lib/api'
import { getStorageToken } from '../lib/storage'

const records = ref<MeetingRecord[]>([])

onMounted(async () => {
  // after a full page load the api token is gone; restore it from storage
  const token = getStorageToken()
  if (!token) return
  setApiToken(token)
  try {
    records.value = (await getMyRecords()).slice().reverse()
  } catch { /* no records yet */ }
})

const formatTime = (secs: number) => new Date(secs * 1000).toLocaleString()
const formatDuration = (start: number, end: number) => {
  const mins = Math.round((end - start) / 60)
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-10 px-4">
    <div class="text-center">
      <h1 class="text-white text-6xl font-extrabold tracking-tight">WOOM</h1>
      <p class="mt-2 text-slate-400">A new meeting</p>
    </div>
    <Join />

    <div v-if="records.length" class="panel w-full max-w-2xl p-5">
      <h2 class="text-sm font-semibold text-slate-300 mb-3">Meeting Records</h2>
      <ul class="divide-y divide-white/5 text-sm">
        <li v-for="r in records" :key="r.meetingNo" class="flex items-center justify-between py-2">
          <code class="font-mono text-indigo-300">{{ r.roomId }}</code>
          <span class="text-slate-400">{{ formatTime(r.startedAt) }}</span>
          <span class="text-slate-400">{{ formatDuration(r.startedAt, r.endedAt) }}</span>
          <span class="text-slate-400">{{ r.participants.length }} participants</span>
        </li>
      </ul>
    </div>
  </div>
</template>
