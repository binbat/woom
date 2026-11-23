<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ApiError,
  createMinutes,
  getRoom,
  getRoomRecords,
  type MeetingRecord,
  setApiToken,
} from '../lib/api'
import { getStorage } from '../lib/storage'
import Loading from './svg/loading.vue'

const RECENT_LIMIT = 5

const props = defineProps<{ roomId: string }>()

interface MinutesState {
  loading: boolean
  text: string
  hint: '' | 'disabled' | 'no-transcript'
  error: string
}

const records = ref<MeetingRecord[]>([])
const showAll = ref(false)
const expanded = ref<Record<string, boolean>>({})
const minutes = ref<Record<string, MinutesState>>({})

const visibleRecords = computed(() =>
  showAll.value ? records.value : records.value.slice(0, RECENT_LIMIT)
)

const minutesState = (meetingNo: string): MinutesState =>
  minutes.value[meetingNo] ?? { loading: false, text: '', hint: '', error: '' }

const toggleExpand = (meetingNo: string) => {
  expanded.value[meetingNo] = !expanded.value[meetingNo]
}

const generateMinutes = async (meetingNo: string) => {
  if (!minutes.value[meetingNo]) {
    minutes.value[meetingNo] = { loading: false, text: '', hint: '', error: '' }
  }
  const state = minutes.value[meetingNo]
  if (state.loading) return
  state.loading = true
  state.text = ''
  state.hint = ''
  state.error = ''
  try {
    state.text = await createMinutes(props.roomId, meetingNo)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      state.hint = 'disabled'
    } else if (e instanceof ApiError && e.status === 400) {
      state.hint = 'no-transcript'
    } else {
      state.error = e instanceof Error ? e.message : String(e)
    }
  } finally {
    state.loading = false
  }
}

const formatStart = (secs: number) => new Date(secs * 1000).toLocaleString()

const formatDuration = (record: MeetingRecord) => {
  const secs = Math.max(0, record.endedAt - record.startedAt)
  const mins = Math.round(secs / 60)
  if (mins < 1) return `${secs}s`
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

onMounted(async () => {
  // owner-only and room-scoped: nothing is fetched on the bare welcome page
  // or for visitors who cannot own this room
  const user = getStorage()
  if (!user.token || !user.stream) return
  setApiToken(user.token)
  try {
    const detail = await getRoom(props.roomId)
    if (detail.owner !== user.stream) return
    const list = await getRoomRecords(props.roomId)
    records.value = list.sort((a, b) => b.startedAt - a.startedAt)
  } catch {
    // room gone or records unavailable: keep the section hidden
  }
})
</script>

<template>
  <section v-if="records.length" class="panel w-full max-w-2xl p-6 sm:p-8 flex flex-col gap-4" data-testid="records-section">
    <h2 class="text-lg font-semibold text-heading">Meeting history</h2>

    <ul class="flex flex-col gap-2">
      <li
        v-for="record in visibleRecords"
        :key="record.meetingNo"
        class="rounded-2xl bg-control ring-1 ring-line px-4 py-3"
        data-testid="record-item"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{{ formatStart(record.startedAt) }}</p>
            <p class="mt-0.5 text-xs text-muted">
              {{ formatDuration(record) }} · {{ record.participants.length }} participants · {{ record.messages.length }} messages · {{ record.captions.length }} transcript lines
            </p>
          </div>
          <button
            class="icon-btn w-9 h-9 shrink-0"
            :aria-expanded="!!expanded[record.meetingNo]"
            aria-label="Toggle transcript"
            data-testid="record-expand"
            @click="toggleExpand(record.meetingNo)"
          >
            <svg class="h-4 w-4 transition-transform" :class="{ 'rotate-180': expanded[record.meetingNo] }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>

        <div v-if="expanded[record.meetingNo]" class="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <div class="rounded-xl bg-surface px-3 py-2 text-sm flex flex-col gap-1" data-testid="record-transcript">
            <template v-if="record.captions.length">
              <p v-for="caption in record.captions" :key="caption.id" class="text-foreground break-words whitespace-pre-wrap">{{ caption.name }}: {{ caption.text }}</p>
            </template>
            <p v-else class="text-muted">No transcript</p>
          </div>

          <div>
            <button
              class="btn-primary px-3 py-1.5 text-sm"
              :disabled="minutesState(record.meetingNo).loading"
              data-testid="record-minutes"
              @click="generateMinutes(record.meetingNo)"
            >
              <Loading v-if="minutesState(record.meetingNo).loading" />
              Generate minutes
            </button>
          </div>

          <p v-if="minutesState(record.meetingNo).hint === 'disabled'" class="text-xs text-muted" data-testid="minutes-hint">
            Minutes are not enabled on this server
          </p>
          <p v-else-if="minutesState(record.meetingNo).hint === 'no-transcript'" class="text-xs text-muted" data-testid="minutes-hint">
            No transcript available for minutes
          </p>
          <p v-if="minutesState(record.meetingNo).error" class="text-xs text-danger" data-testid="minutes-error">
            {{ minutesState(record.meetingNo).error }}
          </p>
          <p v-if="minutesState(record.meetingNo).text" class="rounded-xl bg-surface px-3 py-2 text-sm text-foreground break-words whitespace-pre-wrap" data-testid="minutes-content">
            {{ minutesState(record.meetingNo).text }}
          </p>
        </div>
      </li>
    </ul>

    <button
      v-if="!showAll && records.length > RECENT_LIMIT"
      class="self-center text-sm text-accent underline underline-offset-2 cursor-pointer"
      data-testid="records-show-all"
      @click="showAll = true"
    >
      Show all {{ records.length }} meetings
    </button>
  </section>
</template>
