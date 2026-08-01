<script setup lang="ts">
import { computed, ref } from 'vue'
import { kickParticipant, muteAll, Participant, Stream } from '../lib/api'
import { roomInfo, roomParticipants } from '../store/atoms'
import { getStorageStream } from '../lib/storage'
import SvgAudio from './svg/audio.vue'
import SvgVideo from './svg/video.vue'

const props = defineProps<{
  meetingId: string
  streams: Record<string, Stream>
}>()

const emit = defineEmits<{
  close: []
}>()

const localUserId = getStorageStream()
const actionError = ref('')

const activeParticipants = computed(() =>
  roomParticipants.value
    .filter(p => !p.leaveAt)
    .slice()
    .sort((a, b) => (a.role === b.role ? a.joinAt - b.joinAt : a.role === 'owner' ? -1 : 1))
)

const isOwner = computed(() => roomInfo.value.owner === localUserId)

const presenceOf = (p: Participant): Stream | undefined => props.streams[p.userId]

const onMuteAll = async () => {
  actionError.value = ''
  try {
    await muteAll(props.meetingId)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
  }
}

const onKick = async (userId: string) => {
  actionError.value = ''
  try {
    await kickParticipant(props.meetingId, userId)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="flex flex-col w-full h-full bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <h3 class="text-sm font-semibold text-slate-200">Members ({{ activeParticipants.length }})</h3>
      <button class="text-slate-400 hover:text-white transition-colors" aria-label="Close members" data-testid="members-close" @click="emit('close')">
        ✕
      </button>
    </div>

    <div v-if="isOwner" class="px-3 py-2 border-b border-white/10">
      <button class="w-full px-3 py-1.5 rounded-lg bg-white/10 text-sm text-slate-200 transition-colors hover:bg-white/20" data-testid="mute-all" @click="onMuteAll">
        Mute All
      </button>
    </div>
    <p v-if="actionError" class="text-xs text-rose-400 px-3 py-1">{{ actionError }}</p>

    <div class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1" data-testid="members-list">
      <div
        v-for="p in activeParticipants"
        :key="p.userId"
        class="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/5"
        data-testid="member-row"
      >
        <span class="shrink-0 inline-grid place-items-center w-8 h-8 rounded-full bg-indigo-600/70 text-white text-sm font-semibold">
          {{ (p.name || '?').charAt(0).toUpperCase() }}
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-slate-200 truncate">
            {{ p.name }}<span v-if="p.userId === localUserId" class="text-slate-500"> (Me)</span>
          </p>
          <p v-if="p.role === 'owner'" class="text-[10px] text-amber-400" data-testid="member-owner-badge">Owner</p>
        </div>
        <span class="shrink-0" :class="presenceOf(p)?.audio ? 'text-emerald-400' : 'text-slate-600'" :data-testid="presenceOf(p)?.audio ? 'member-mic-on' : 'member-mic-off'">
          <SvgAudio />
        </span>
        <span class="shrink-0" :class="presenceOf(p)?.video ? 'text-emerald-400' : 'text-slate-600'">
          <SvgVideo />
        </span>
        <button
          v-if="isOwner && p.userId !== localUserId"
          class="shrink-0 px-2 py-1 rounded-lg text-xs text-rose-300 transition-colors hover:bg-rose-500/20"
          data-testid="member-kick"
          @click="onKick(p.userId)"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
</template>
