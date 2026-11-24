<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  type AdminRecordSummary,
  ApiError,
  adminPlaybackUrl,
  createAdminCleanup,
  createAdminMinutes,
  createAdminPlaybackTicket,
  deleteAdminRecord,
  deleteAdminRecording,
  getAdminRecord,
  getAdminRecords,
  type MeetingRecord,
  type RecordingInfo,
} from '../lib/api'
import AdminReplay from './admin-replay.vue'
import DashPlayer from './player/dash-player.vue'
import Loading from './svg/loading.vue'

const emit = defineEmits<(e: 'auth-expired') => void>()

type Tab = 'transcript' | 'chat' | 'minutes' | 'recordings' | 'replay'

/** transient per-artifact state; generated content lives on the record itself */
interface ArtifactState {
  loading: boolean
  hint: '' | 'disabled' | 'no-transcript'
  error: string
}

const summaries = ref<AdminRecordSummary[]>([])
const loading = ref(true)
const loadError = ref('')
const expanded = ref('')
const detail = ref<MeetingRecord | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const tab = ref<Tab>('transcript')
const confirmDelete = ref('')
const deleting = ref(false)
const minutesStates = ref<Record<string, ArtifactState>>({})
const cleanupStates = ref<Record<string, ArtifactState>>({})

const emptyArtifact = (): ArtifactState => ({
  loading: false,
  hint: '',
  error: '',
})

const minutesState = (meetingNo: string): ArtifactState =>
  minutesStates.value[meetingNo] ?? emptyArtifact()
const cleanupState = (meetingNo: string): ArtifactState =>
  cleanupStates.value[meetingNo] ?? emptyArtifact()

/** returns true when the error was an expired/revoked admin token */
const handleAuth = (e: unknown): boolean => {
  if (e instanceof ApiError && e.status === 401) {
    emit('auth-expired')
    return true
  }
  return false
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    summaries.value = await getAdminRecords()
  } catch (e) {
    if (handleAuth(e)) return
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const toggle = async (meetingNo: string) => {
  if (expanded.value === meetingNo) {
    expanded.value = ''
    detail.value = null
    return
  }
  expanded.value = meetingNo
  detail.value = null
  detailError.value = ''
  tab.value = 'transcript'
  confirmDelete.value = ''
  confirmDeleteRecording.value = ''
  playbackKey.value = ''
  playbackSrc.value = ''
  detailLoading.value = true
  try {
    detail.value = await getAdminRecord(meetingNo)
  } catch (e) {
    if (handleAuth(e)) return
    detailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailLoading.value = false
  }
}

/** at most one DASH player at a time, keyed by the recording's recordDir */
const playbackKey = ref('')
const playbackSrc = ref('')
const playbackLoading = ref('')
const playbackError = ref('')
const confirmDeleteRecording = ref('')
const deletingRecording = ref(false)

const playRecording = async (recording: RecordingInfo) => {
  const record = detail.value
  if (!record) return
  if (playbackKey.value === recording.recordDir) {
    playbackKey.value = ''
    playbackSrc.value = ''
    return
  }
  if (playbackLoading.value) return
  playbackLoading.value = recording.recordDir
  playbackError.value = ''
  try {
    const ticket = await createAdminPlaybackTicket(record.meetingNo)
    playbackSrc.value = adminPlaybackUrl(
      record.meetingNo,
      recording.recordDir,
      ticket.ticket
    )
    playbackKey.value = recording.recordDir
  } catch (e) {
    if (handleAuth(e)) return
    playbackError.value = e instanceof Error ? e.message : String(e)
  } finally {
    playbackLoading.value = ''
  }
}

const removeRecording = async (recording: RecordingInfo) => {
  const record = detail.value
  if (!record || deletingRecording.value) return
  if (confirmDeleteRecording.value !== recording.recordDir) {
    confirmDeleteRecording.value = recording.recordDir
    return
  }
  deletingRecording.value = true
  try {
    await deleteAdminRecording(record.meetingNo, recording.recordDir)
    record.recordings = record.recordings.filter(
      item => item.recordDir !== recording.recordDir
    )
    const summary = summaries.value.find(
      item => item.meetingNo === record.meetingNo
    )
    if (summary) summary.recordingCount = record.recordings.length
    if (playbackKey.value === recording.recordDir) {
      playbackKey.value = ''
      playbackSrc.value = ''
    }
  } catch (e) {
    if (handleAuth(e)) return
    // already gone server-side: drop it from the detail as well
    if (e instanceof ApiError && e.status === 404) {
      record.recordings = record.recordings.filter(
        item => item.recordDir !== recording.recordDir
      )
    }
  } finally {
    deletingRecording.value = false
    confirmDeleteRecording.value = ''
  }
}

const generate = async (kind: 'minutes' | 'cleanup') => {
  const record = detail.value
  if (!record) return
  const map = kind === 'minutes' ? minutesStates.value : cleanupStates.value
  if (!map[record.meetingNo]) map[record.meetingNo] = emptyArtifact()
  const state = map[record.meetingNo]
  if (state.loading) return
  state.loading = true
  state.hint = ''
  state.error = ''
  // a non-empty artifact is the cached value: regenerating forces it
  const force =
    kind === 'minutes' ? !!record.minutes : !!record.polishedTranscript
  try {
    if (kind === 'minutes') {
      const res = await createAdminMinutes(record.meetingNo, force)
      record.minutes = res.minutes
    } else {
      const res = await createAdminCleanup(record.meetingNo, force)
      record.polishedTranscript = res.polishedTranscript
    }
    const summary = summaries.value.find(
      item => item.meetingNo === record.meetingNo
    )
    if (summary) {
      if (kind === 'minutes') summary.hasMinutes = true
      else summary.hasPolishedTranscript = true
    }
  } catch (e) {
    if (handleAuth(e)) return
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

const remove = async (meetingNo: string) => {
  if (deleting.value) return
  if (confirmDelete.value !== meetingNo) {
    confirmDelete.value = meetingNo
    return
  }
  deleting.value = true
  try {
    await deleteAdminRecord(meetingNo)
    summaries.value = summaries.value.filter(
      item => item.meetingNo !== meetingNo
    )
    expanded.value = ''
    detail.value = null
  } catch (e) {
    if (handleAuth(e)) return
    // already gone server-side: drop it from the list as well
    if (e instanceof ApiError && e.status === 404) {
      summaries.value = summaries.value.filter(
        item => item.meetingNo !== meetingNo
      )
      expanded.value = ''
      detail.value = null
    }
  } finally {
    deleting.value = false
    confirmDelete.value = ''
  }
}

const formatStart = (secs: number) => new Date(secs * 1000).toLocaleString()

const formatDuration = (summary: AdminRecordSummary) => {
  const secs = Math.max(0, summary.endedAt - summary.startedAt)
  const mins = Math.round(secs / 60)
  if (mins < 1) return `${secs}s`
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const tabs: { id: Tab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'chat', label: 'Chat' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'replay', label: 'Replay' },
]

onMounted(load)
</script>

<template>
  <section class="panel w-full p-6 sm:p-8 flex flex-col gap-4" data-testid="admin-records">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-heading">Meeting records</h2>
      <button
        class="icon-btn w-auto px-3 h-9 text-sm"
        :disabled="loading"
        data-testid="admin-records-refresh"
        @click="load"
      >
        <Loading v-if="loading" />
        Refresh
      </button>
    </div>

    <p v-if="loadError" class="text-sm text-danger" data-testid="admin-records-error">
      {{ loadError }}
    </p>
    <p
      v-else-if="!loading && !summaries.length"
      class="text-sm text-muted"
      data-testid="admin-records-empty"
    >
      No meeting records yet
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="summary in summaries"
        :key="summary.meetingNo"
        class="rounded-2xl bg-control ring-1 ring-line px-4 py-3"
        data-testid="admin-record-item"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">
              {{ formatStart(summary.startedAt) }}
              <span class="ml-2 font-mono text-xs text-muted">{{ summary.roomId }}</span>
              <span v-if="summary.roomTopic" class="ml-1 text-xs text-muted">· {{ summary.roomTopic }}</span>
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ formatDuration(summary) }} · {{ summary.participantCount }} participants · {{ summary.messageCount }} messages · {{ summary.captionCount }} transcript lines
              <span v-if="summary.recordingCount" class="ml-1 rounded bg-control px-1.5 py-0.5 text-accent">{{ summary.recordingCount }} rec</span>
              <span v-if="summary.hasMinutes" class="ml-1 rounded bg-control px-1.5 py-0.5 text-success">minutes</span>
              <span v-if="summary.hasPolishedTranscript" class="ml-1 rounded bg-control px-1.5 py-0.5 text-success">polished</span>
            </p>
          </div>
          <button
            class="icon-btn w-9 h-9 shrink-0"
            :aria-expanded="expanded === summary.meetingNo"
            aria-label="Toggle record detail"
            data-testid="admin-record-expand"
            @click="toggle(summary.meetingNo)"
          >
            <svg class="h-4 w-4 transition-transform" :class="{ 'rotate-180': expanded === summary.meetingNo }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>

        <div v-if="expanded === summary.meetingNo" class="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <p v-if="detailLoading" class="text-sm text-muted"><Loading /></p>
          <p v-else-if="detailError" class="text-sm text-danger" data-testid="admin-detail-error">{{ detailError }}</p>

          <template v-else-if="detail">
            <div class="flex flex-wrap gap-1">
              <button
                v-for="item in tabs"
                :key="item.id"
                class="rounded-lg px-3 py-1.5 text-sm transition-colors"
                :class="tab === item.id ? 'bg-indigo-600 text-white' : 'bg-control text-muted hover:bg-control-hover'"
                :data-testid="`admin-tab-${item.id}`"
                @click="tab = item.id"
              >
                {{ item.label }}
              </button>
            </div>

            <div v-if="tab === 'transcript'" class="rounded-xl bg-surface px-3 py-2 text-sm flex flex-col gap-1" data-testid="admin-transcript">
              <template v-if="detail.captions.length">
                <p v-for="caption in detail.captions" :key="caption.id" class="text-foreground break-words whitespace-pre-wrap">{{ caption.name }}: {{ caption.text }}</p>
              </template>
              <p v-else class="text-muted">No transcript</p>
            </div>

            <div v-else-if="tab === 'chat'" class="rounded-xl bg-surface px-3 py-2 text-sm flex flex-col gap-1" data-testid="admin-chat">
              <template v-if="detail.messages.length">
                <p v-for="message in detail.messages" :key="message.id" class="text-foreground break-words whitespace-pre-wrap">{{ message.name }}: {{ message.content }}</p>
              </template>
              <p v-else class="text-muted">No chat messages</p>
            </div>

            <div v-else-if="tab === 'minutes'" class="flex flex-col gap-3" data-testid="admin-minutes">
              <div class="flex flex-wrap gap-2">
                <button
                  class="btn-primary px-3 py-1.5 text-sm"
                  :disabled="minutesState(detail.meetingNo).loading"
                  data-testid="admin-record-minutes"
                  @click="generate('minutes')"
                >
                  <Loading v-if="minutesState(detail.meetingNo).loading" />
                  {{ detail.minutes ? 'Regenerate minutes' : 'Generate minutes' }}
                </button>
                <button
                  class="btn-primary px-3 py-1.5 text-sm"
                  :disabled="cleanupState(detail.meetingNo).loading"
                  data-testid="admin-record-cleanup"
                  @click="generate('cleanup')"
                >
                  <Loading v-if="cleanupState(detail.meetingNo).loading" />
                  {{ detail.polishedTranscript ? 'Re-polish transcript' : 'Polish transcript' }}
                </button>
              </div>

              <p v-if="minutesState(detail.meetingNo).hint === 'disabled'" class="text-xs text-muted" data-testid="admin-minutes-hint">
                Minutes are not enabled on this server
              </p>
              <p v-else-if="minutesState(detail.meetingNo).hint === 'no-transcript'" class="text-xs text-muted" data-testid="admin-minutes-hint">
                No transcript available for minutes
              </p>
              <p v-if="minutesState(detail.meetingNo).error" class="text-xs text-danger" data-testid="admin-minutes-error">
                {{ minutesState(detail.meetingNo).error }}
              </p>
              <p v-if="detail.minutes" class="rounded-xl bg-surface px-3 py-2 text-sm text-foreground break-words whitespace-pre-wrap" data-testid="admin-minutes-content">
                {{ detail.minutes }}
              </p>

              <p v-if="cleanupState(detail.meetingNo).hint === 'disabled'" class="text-xs text-muted" data-testid="admin-cleanup-hint">
                Transcript polishing is not enabled on this server
              </p>
              <p v-else-if="cleanupState(detail.meetingNo).hint === 'no-transcript'" class="text-xs text-muted" data-testid="admin-cleanup-hint">
                No transcript available for polishing
              </p>
              <p v-if="cleanupState(detail.meetingNo).error" class="text-xs text-danger" data-testid="admin-cleanup-error">
                {{ cleanupState(detail.meetingNo).error }}
              </p>
              <div v-if="detail.polishedTranscript">
                <p class="mb-1 text-xs font-medium text-muted">Polished transcript</p>
                <p class="rounded-xl bg-surface px-3 py-2 text-sm text-foreground break-words whitespace-pre-wrap" data-testid="admin-cleanup-content">
                  {{ detail.polishedTranscript }}
                </p>
              </div>
              <p v-if="!detail.minutes && !detail.polishedTranscript" class="text-sm text-muted">
                No minutes generated yet
              </p>
            </div>

            <div v-else-if="tab === 'recordings'" class="flex flex-col gap-2" data-testid="admin-recordings">
              <template v-if="detail.recordings.length">
                <div
                  v-for="recording in detail.recordings"
                  :key="recording.recordDir"
                  class="flex flex-wrap items-center gap-2 text-sm"
                  data-testid="admin-recording-item"
                >
                  <span class="text-foreground">{{ recording.name || 'Unknown' }}</span>
                  <span class="text-xs text-muted font-mono">{{ recording.userId.slice(0, 8) }}</span>
                  <span class="text-xs text-muted">{{ formatStart(recording.startedAt) }}</span>
                  <span class="ml-auto flex gap-2">
                    <button
                      class="btn-primary px-3 py-1 text-xs"
                      :disabled="!!playbackLoading"
                      data-testid="admin-recording-play"
                      @click="playRecording(recording)"
                    >
                      {{ playbackKey === recording.recordDir ? 'Stop' : 'Play' }}
                    </button>
                    <button
                      class="rounded-lg px-3 py-1 text-xs transition-colors"
                      :class="confirmDeleteRecording === recording.recordDir ? 'bg-rose-700 text-white' : 'bg-control text-danger hover:bg-control-hover'"
                      :disabled="deletingRecording"
                      data-testid="admin-recording-delete"
                      @click="removeRecording(recording)"
                    >
                      {{ confirmDeleteRecording === recording.recordDir ? 'Confirm' : 'Delete' }}
                    </button>
                  </span>
                </div>
                <p v-if="playbackError" class="text-xs text-danger" data-testid="admin-playback-error">{{ playbackError }}</p>
                <DashPlayer v-if="playbackSrc" :key="playbackKey" :src="playbackSrc" />
              </template>
              <p v-else class="text-sm text-muted">No recordings</p>
            </div>

            <AdminReplay v-else :record="detail" />

            <div class="flex justify-end border-t border-line pt-3">
              <button
                class="rounded-lg px-3 py-1.5 text-sm transition-colors"
                :class="confirmDelete === summary.meetingNo ? 'bg-rose-700 text-white' : 'bg-control text-danger hover:bg-control-hover'"
                :disabled="deleting"
                data-testid="admin-record-delete"
                @click="remove(summary.meetingNo)"
              >
                <Loading v-if="deleting && confirmDelete === summary.meetingNo" />
                {{ confirmDelete === summary.meetingNo ? 'Confirm delete' : 'Delete record' }}
              </button>
            </div>
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>
