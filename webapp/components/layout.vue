<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Player from './player/player.vue'
import WhipPlayer from './player/whip-player.vue'
import WhepPlayer from './player/whep-player.vue'
import DeviceBar from './device.vue'
import {
  UserStatus,
  enabledPresentation,
  meetingJoined,
  presentationStream,
} from '../store/atoms'
import copy from 'copy-to-clipboard'
import SvgDone from './svg/done.vue'
import SvgEnd from './svg/end.vue'
import { getRoom, delStream, Stream } from '../lib/api'
import { getStorageStream } from '../lib/storage'
import useWhipClient from './use/whip'

// at most 9 video tiles on screen (self + up to 8 remotes); remote users
// outside the visible set are not subscribed at all (no WhepPlayer is
// mounted for them, so no WHEP connection is created)
const MAX_VISIBLE_TILES = 9

const props = defineProps<{ meetingId: string }>()

const copyStatus = ref(false)

const localStreamId = getStorageStream()
const remoteUserStatus = ref<Record<string, UserStatus>>({})

const visibleRemoteIds = computed(() =>
  Object.keys(remoteUserStatus.value).slice(0, MAX_VISIBLE_TILES - 1)
)
const hiddenRemoteIds = computed(() =>
  Object.keys(remoteUserStatus.value).slice(MAX_VISIBLE_TILES - 1)
)

const whip = useWhipClient(localStreamId)

const refresh = async () => {
  const data = (await getRoom(props.meetingId)).streams
  if (data) {
    const r = Object.keys(data)
      .filter(i => i !== localStreamId)
      .filter(i => !!i)
      .reduce((map, i) => {
        map[i] = data[i]
        return map
      }, {} as { [_: string]: Stream })
    remoteUserStatus.value = r
  }
}

const callEnd = async () => {
  delStream(props.meetingId, localStreamId)

  meetingJoined.value = false
  whip.value.stop()
  whip.value.setSyncUserStatus(() => {})
}

const copyMeetingLink = () => {
  copy(window.location.href)
  copyStatus.value = true
  setTimeout(() => copyStatus.value = false, 3000)
}

// NOTE:
// https://github.com/binbat/woom/pull/27
// https://developer.mozilla.org/en-US/docs/Web/API/Window/unload_event
// `unload` event is Deprecated, But Firefox need `unload`
const cleanup = () => {
  delStream(props.meetingId, localStreamId)
}

let refreshTimer: number | undefined

onMounted(() => {
  window.addEventListener('beforeunload', cleanup)
  window.addEventListener('unload', cleanup)
  refreshTimer = window.setInterval(refresh, 3000)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', cleanup)
  window.removeEventListener('unload', cleanup)
  window.clearInterval(refreshTimer)
})
</script>

<template>
  <div class="flex flex-col h-screen">
    <div class="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden" :class="enabledPresentation ? 'flex-col lg:flex-row' : 'flex-col'">
      <!-- presenter mode: shared screen takes the main stage -->
      <div v-if="enabledPresentation" class="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <Player
          :stream="presentationStream.stream"
          :muted="true"
          :video="true"
          :audio="false"
          width="100%"
          :self="false"
          class="h-full max-w-full"
        />
      </div>

      <!-- the tiles never change parent across layout switches: remounting
           a WhepPlayer would clear the presentation stream and restart the
           WHEP connection, which flips the layout back and loops -->
      <div :class="enabledPresentation
        ? 'flex lg:flex-col flex-row gap-3 shrink-0 overflow-auto lg:w-48'
        : 'flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 place-items-center content-center overflow-y-auto'">
        <WhipPlayer :stream-id="localStreamId" :width="enabledPresentation ? '160px' : '320px'" />
        <WhepPlayer v-for="i in visibleRemoteIds" :key="i" :stream-id="i" :user-status="remoteUserStatus[i]" :width="enabledPresentation ? '160px' : '320px'" />

        <div v-if="hiddenRemoteIds.length" class="flex flex-col justify-center items-center rounded-2xl bg-white/5 ring-1 ring-white/10" :class="enabledPresentation ? 'min-h-30' : 'min-h-60'" :style="{ width: enabledPresentation ? '160px' : '320px' }" :title="hiddenRemoteIds.map(i => remoteUserStatus[i].name).join(', ')">
          <p class="text-3xl font-bold text-slate-300">+{{ hiddenRemoteIds.length }}</p>
          <p class="mt-1 text-sm text-slate-400">{{ hiddenRemoteIds.length === 1 ? 'other' : 'others' }}</p>
        </div>
      </div>
    </div>

    <div class="flex justify-center px-4 pb-4">
      <div class="panel flex items-center gap-3 px-4 py-2">
        <button class="hidden md:flex items-center gap-2 rounded-xl px-3 py-2 text-indigo-300 transition-colors hover:bg-white/10" @click="copyMeetingLink">
          <code class="font-mono text-sm tracking-wider" data-testid="meeting-id">{{ meetingId }}</code>
          <span class="inline-grid place-items-center text-emerald-400" :style="{ visibility: copyStatus ? 'visible' : 'hidden' }">
            <SvgDone />
          </span>
        </button>

        <DeviceBar :stream-id="localStreamId" />

        <button class="inline-grid place-items-center w-14 h-10 rounded-full text-white bg-rose-600 shadow-lg shadow-rose-950/40 transition-colors hover:bg-rose-500" data-testid="hang-up" aria-label="Hang up" @click="callEnd()">
          <SvgEnd />
        </button>
      </div>
    </div>
  </div>
</template>
