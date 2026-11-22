<script setup lang="ts">
import copy from 'copy-to-clipboard'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ApiError,
  getRoom,
  leaveMeeting,
  leaveMeetingKeepalive,
  type Message,
  openRoomEvents,
  type RoomEvent,
  type RoomSnapshot,
  type Stream,
  StreamState,
  setPresence,
} from '../lib/api'
import { log, setLogMeeting } from '../lib/log'
import { getStorageStream } from '../lib/storage'
import {
  enabledPresentation,
  joinedMeetingNo,
  joinPassword,
  meetingJoined,
  presentationStream,
  roomInfo,
  roomParticipants,
  type UserStatus,
} from '../store/atoms'
import Chat from './chat.vue'
import DeviceBar from './device.vue'
import Members from './members.vue'
import Player from './player/player.vue'
import WhepPlayer from './player/whep-player.vue'
import WhipPlayer from './player/whip-player.vue'
import SvgChat from './svg/chat.vue'
import SvgDone from './svg/done.vue'
import SvgEnd from './svg/end.vue'
import SvgMembers from './svg/members.vue'
import useWhipClient from './use/whip'

const MAX_VISIBLE_TILES = 9
const MAX_DEFAULT_VIDEO_TILES = 6

const props = defineProps<{ meetingId: string }>()

const copyStatus = ref(false)

const localStreamId = getStorageStream()
const remoteUserStatus = ref<Record<string, UserStatus>>({})

const whip = useWhipClient(localStreamId)

const orderedRemoteIds = computed(() =>
  Object.keys(remoteUserStatus.value)
    .map(id => ({
      id,
      joinAt:
        roomParticipants.value.find(p => p.userId === id)?.joinAt ??
        Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => {
      const rank = (id: string) => {
        if (roomInfo.value.presenter === id) return 0
        if (remoteUserStatus.value[id].screen) return 1
        return 2
      }
      return (
        rank(a.id) - rank(b.id) ||
        a.joinAt - b.joinAt ||
        a.id.localeCompare(b.id)
      )
    })
    .map(({ id }) => id)
)
const visibleRemoteIds = computed(() =>
  orderedRemoteIds.value.slice(0, MAX_VISIBLE_TILES - 1)
)
const hiddenRemoteIds = computed(() =>
  orderedRemoteIds.value.slice(MAX_VISIBLE_TILES - 1)
)

const videoGrid = ref<HTMLDivElement>()
const videoGridSize = ref({ width: 0, height: 0 })
const galleryLayout = computed(() => {
  const { width, height } = videoGridSize.value
  if (!width || !height) return { width: 'min(320px, 100%)', maxWidth: '100%' }

  const count =
    visibleRemoteIds.value.length + 1 + (hiddenRemoteIds.value.length ? 1 : 0)
  const minColumns = width < 640 && count > 3 ? 2 : 1
  const maxColumns = Math.min(count, width < 640 ? 2 : 5)
  const gap = 16
  let bestWidth = 0
  let bestColumns = 1
  for (let columns = minColumns; columns <= maxColumns; columns++) {
    const rows = Math.ceil(count / columns)
    const cellWidth = (width - gap * (columns - 1)) / columns
    const cellHeight = (height - gap * (rows - 1)) / rows
    if (cellWidth <= 0 || cellHeight <= 0) continue
    const fittedWidth = Math.min(cellWidth, (cellHeight * 4) / 3)
    const candidateWidth =
      fittedWidth < 160 ? Math.min(cellWidth, 160) : fittedWidth
    if (candidateWidth > bestWidth + 0.01) {
      bestWidth = candidateWidth
      bestColumns = columns
    }
  }
  const tileWidth = Math.floor(bestWidth || Math.min(width, 320))
  return {
    width: `min(${tileWidth}px, 100%)`,
    maxWidth: `${tileWidth * bestColumns + gap * (bestColumns - 1)}px`,
  }
})
const tileWidth = computed(() =>
  enabledPresentation.value ? '160px' : galleryLayout.value.width
)

watch(
  videoGrid,
  (grid, _previousGrid, onCleanup) => {
    const container = grid?.parentElement
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      videoGridSize.value = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }
    })
    observer.observe(container)
    onCleanup(() => observer.disconnect())
  },
  { immediate: true, flush: 'post' }
)

const chatOpen = ref(false)
const membersOpen = ref(false)
const unread = ref(0)
const messages = ref<Message[]>([])
const streamsAll = ref<Record<string, Stream>>({})

const activeCount = computed(
  () => roomParticipants.value.filter(p => !p.leaveAt).length
)

const videoOverrides = ref<Record<string, boolean>>({})
const isRemoteVideoEnabled = (id: string) => {
  if (remoteUserStatus.value[id]?.screen) return true
  const override = videoOverrides.value[id]
  if (override !== undefined) return override
  return (
    activeCount.value <= MAX_DEFAULT_VIDEO_TILES ||
    orderedRemoteIds.value.slice(0, MAX_DEFAULT_VIDEO_TILES - 1).includes(id)
  )
}
const isRemoteVideoOverridden = (id: string) =>
  videoOverrides.value[id] !== undefined
const toggleRemoteVideo = (id: string) => {
  videoOverrides.value = {
    ...videoOverrides.value,
    [id]: !isRemoteVideoEnabled(id),
  }
}

const toggleChat = () => {
  chatOpen.value = !chatOpen.value
  if (chatOpen.value) {
    unread.value = 0
    membersOpen.value = false
  }
}

const toggleMembers = () => {
  membersOpen.value = !membersOpen.value
  if (membersOpen.value) chatOpen.value = false
}

let active = true
let lifecycle = 0
let events: EventSource | undefined
let eventsGeneration = 0
let eventsRetry: number | undefined
let heartbeat: number | undefined
let restorePromise: Promise<void> | undefined
let sseOpenedOnce = false
let lastMuteAllAt: number | null = null

const isCurrent = (generation: number) => active && generation === lifecycle

const invalidate = () => {
  active = false
  lifecycle++
  eventsGeneration++
  events?.close()
  events = undefined
  window.clearTimeout(eventsRetry)
  window.clearInterval(heartbeat)
  window.removeEventListener('beforeunload', cleanup)
  window.removeEventListener('unload', cleanup)
  window.removeEventListener('offline', handleOffline)
  window.removeEventListener('online', handleOnline)
  joinedMeetingNo.value = ''
  joinPassword.value = ''
}

const callEnd = () => {
  if (!active) return
  log('info', 'leave_meeting', '', { meetingId: props.meetingId })
  invalidate()
  meetingJoined.value = false
  whip.value.setSyncUserStatus(() => {})
  void whip.value.stop()
  void leaveMeeting(props.meetingId).catch(e => {
    log('warn', 'leave_meeting_failed', String(e), {
      meetingId: props.meetingId,
    })
  })
}

const applySnapshot = (data: RoomSnapshot) => {
  if (joinedMeetingNo.value && data.meetingNo !== joinedMeetingNo.value) {
    callEnd()
    return
  }

  roomInfo.value = {
    owner: roomInfo.value.owner,
    presenter: data.presenter,
    locked: data.locked,
  }
  roomParticipants.value = data.participants
  messages.value = data.messages
  const me = data.participants.find(p => p.userId === localStreamId)
  if (data.meetingNo && me?.leaveAt) {
    callEnd()
    return
  }
  if (lastMuteAllAt === null) {
    lastMuteAllAt = data.muteAllAt
  } else if (data.muteAllAt > lastMuteAllAt) {
    lastMuteAllAt = data.muteAllAt
    if (roomInfo.value.owner !== localStreamId && whip.value.userStatus.audio) {
      void whip.value.toggleEnableAudio()
    }
  }
  streamsAll.value = data.streams || {}
  remoteUserStatus.value = Object.keys(data.streams || {})
    .filter(i => i !== localStreamId && !!i)
    .reduce(
      (map, i) => {
        map[i] = data.streams[i]
        return map
      },
      {} as Record<string, Stream>
    )
}

const copyMeetingLink = () => {
  copy(window.location.href)
  copyStatus.value = true
  setTimeout(() => (copyStatus.value = false), 3000)
}

const cleanup = () => {
  if (active) leaveMeetingKeepalive(props.meetingId)
}

const handleOffline = () => {
  if (!active) return
  eventsGeneration++
  events?.close()
  events = undefined
  window.clearTimeout(eventsRetry)
  eventsRetry = undefined
}

const handleOnline = () => {
  if (!active) return
  eventsGeneration++
  events?.close()
  events = undefined
  void restoreMeeting()
  void connectEvents()
}

const isTerminalApiError = (e: unknown) =>
  e instanceof ApiError && [401, 403, 404].includes(e.status)

const restoreMeeting = (): Promise<void> => {
  if (restorePromise) return restorePromise
  const generation = lifecycle
  const run = (async () => {
    log('warn', 'sse_reconnected_restore', '', { meetingId: props.meetingId })
    try {
      const detail = await getRoom(props.meetingId)
      if (!isCurrent(generation)) return
      const me = detail.participants.find(
        p => p.userId === localStreamId && !p.leaveAt
      )
      if (detail.meeting?.meetingNo !== joinedMeetingNo.value || !me) {
        callEnd()
        return
      }
      if (!(await setPresence(props.meetingId, whip.value.userStatus))) {
        throw new Error('presence rejected')
      }
      if (!isCurrent(generation)) return
      const dead = [
        StreamState.Failed,
        StreamState.Closed,
        StreamState.Disconnected,
      ]
      if (dead.includes(whip.value.userStatus.state)) await whip.value.restart()
    } catch (e) {
      if (!isCurrent(generation)) return
      if (isTerminalApiError(e)) {
        callEnd()
        return
      }
      log('error', 'restore_failed', String(e), { meetingId: props.meetingId })
    }
  })()
  restorePromise = run
  void run.then(() => {
    if (restorePromise === run) restorePromise = undefined
  })
  return run
}

const heartbeatPresence = async () => {
  if (!navigator.onLine) return
  const generation = lifecycle
  const present = await setPresence(props.meetingId, whip.value.userStatus)
  if (isCurrent(generation) && !present) await restoreMeeting()
}

const scheduleEventsReconnect = () => {
  if (eventsRetry !== undefined || !active) return
  const generation = lifecycle
  eventsRetry = window.setTimeout(() => {
    eventsRetry = undefined
    if (isCurrent(generation)) void connectEvents()
  }, 500)
}

const connectEvents = async () => {
  const generation = lifecycle
  const connection = ++eventsGeneration
  const previous = events
  events = undefined
  previous?.close()
  window.clearTimeout(eventsRetry)
  eventsRetry = undefined
  try {
    const source = await openRoomEvents(props.meetingId)
    if (!isCurrent(generation) || connection !== eventsGeneration) {
      source.close()
      return
    }
    events = source
    let lastRevision = -1
    source.onmessage = e => {
      if (
        !isCurrent(generation) ||
        connection !== eventsGeneration ||
        events !== source
      )
        return
      try {
        const data = JSON.parse(e.data) as RoomEvent
        if (typeof data.revision === 'number') {
          if (data.revision <= lastRevision) return
          lastRevision = data.revision
        }
        if (data.type === 'message') {
          messages.value.push(data.message)
          if (!chatOpen.value) unread.value++
        } else {
          applySnapshot(data)
        }
      } catch (e) {
        log('warn', 'sse_event_invalid', String(e), {
          meetingId: props.meetingId,
        })
      }
    }
    source.onopen = () => {
      if (
        !isCurrent(generation) ||
        connection !== eventsGeneration ||
        events !== source
      )
        return
      if (sseOpenedOnce) void restoreMeeting()
      sseOpenedOnce = true
    }
    source.onerror = () => {
      if (!isCurrent(generation) || connection !== eventsGeneration) return
      log('warn', 'sse_error', '', { meetingId: props.meetingId })
      if (source.readyState === EventSource.CLOSED) {
        source.close()
        if (events === source) events = undefined
        scheduleEventsReconnect()
      }
    }
  } catch (e) {
    if (!isCurrent(generation) || connection !== eventsGeneration) return
    log('warn', 'sse_ticket_failed', String(e), { meetingId: props.meetingId })
    if (isTerminalApiError(e)) {
      callEnd()
      return
    }
    scheduleEventsReconnect()
  }
}

onMounted(async () => {
  window.addEventListener('beforeunload', cleanup)
  window.addEventListener('unload', cleanup)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('online', handleOnline)
  setLogMeeting(props.meetingId)

  const generation = lifecycle
  try {
    const detail = await getRoom(props.meetingId)
    if (isCurrent(generation))
      roomInfo.value = { ...roomInfo.value, owner: detail.owner }
  } catch {
    /* room may be gone */
  }

  if (isCurrent(generation)) {
    await connectEvents()
    if (isCurrent(generation)) {
      heartbeat = window.setInterval(() => {
        void heartbeatPresence()
      }, 15000)
    }
  }
})

onUnmounted(() => {
  invalidate()
  whip.value.setSyncUserStatus(() => {})
  void whip.value.stop()
})
</script>

<template>
  <div class="flex flex-col h-screen">
    <div class="flex-1 min-h-0 flex overflow-hidden">
      <div class="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden" :class="enabledPresentation ? 'flex-col lg:flex-row justify-center-safe' : 'flex-col'" data-testid="video-stage">
        <!-- presenter mode: shared screen takes the main stage -->
        <div v-if="enabledPresentation" class="flex-none lg:flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
          <Player
            data-testid="presentation-player"
            :stream="presentationStream.stream"
            :muted="true"
            :video="true"
            :audio="false"
            width="100%"
            :self="false"
            class="h-auto lg:h-full max-w-full"
          />
        </div>

        <!-- the tiles never change parent across layout switches: remounting
             a WhepPlayer would clear the presentation stream and restart the
             WHEP connection, which flips the layout back and loops -->
        <div ref="videoGrid" :class="enabledPresentation
          ? 'flex lg:flex-col flex-row gap-3 shrink-0 overflow-auto lg:w-40'
          : 'flex-1 min-h-0 w-full self-center flex flex-wrap items-center justify-center content-center-safe gap-4 overflow-y-auto'" :style="{ maxWidth: enabledPresentation ? undefined : galleryLayout.maxWidth }" data-testid="video-grid">
          <WhipPlayer class="shrink-0" :style="{ width: tileWidth }" :stream-id="localStreamId" width="100%" />
          <WhepPlayer v-for="i in visibleRemoteIds" :key="i" class="shrink-0" :style="{ width: tileWidth }" :stream-id="i" :user-status="remoteUserStatus[i]" width="100%" :video-enabled="isRemoteVideoEnabled(i)" :video-overridden="isRemoteVideoOverridden(i)" @toggle-video="toggleRemoteVideo(i)" />

          <div v-if="hiddenRemoteIds.length" class="aspect-ratio-[4/3] shrink-0 flex flex-col justify-center items-center rounded-2xl bg-control ring-1 ring-line" :style="{ width: tileWidth }" :title="hiddenRemoteIds.map(i => remoteUserStatus[i].name).join(', ')" data-testid="overflow-tile">
            <p class="text-3xl font-bold text-foreground">+{{ hiddenRemoteIds.length }}</p>
            <p class="mt-1 text-sm text-muted">{{ hiddenRemoteIds.length === 1 ? 'other' : 'others' }}</p>
          </div>
        </div>
      </div>

      <div v-if="chatOpen" class="shrink-0 py-4 pr-4 w-[85vw] max-w-xs sm:w-auto" data-testid="chat-panel">
        <Chat :meeting-id="meetingId" :messages="messages" @close="chatOpen = false" />
      </div>
      <div v-if="membersOpen" class="shrink-0 py-4 pr-4 w-[85vw] max-w-xs sm:w-auto" data-testid="members-panel">
        <Members :meeting-id="meetingId" :streams="streamsAll" @close="membersOpen = false" />
      </div>
    </div>

    <div class="flex justify-center px-4 pb-4">
      <div class="panel flex flex-wrap md:flex-nowrap items-center justify-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 max-w-[calc(100vw-1rem)] md:overflow-x-auto" data-testid="meeting-controls">
        <button class="hidden md:flex items-center gap-2 rounded-xl bg-transparent px-3 py-2 text-accent transition-colors hover:bg-control-hover" data-testid="meeting-id-copy" @click="copyMeetingLink">
          <code class="font-mono text-sm tracking-wider" data-testid="meeting-id">{{ meetingId }}</code>
          <span class="inline-grid place-items-center text-success" :style="{ visibility: copyStatus ? 'visible' : 'hidden' }">
            <SvgDone />
          </span>
        </button>

        <DeviceBar class="max-md:contents" :stream-id="localStreamId" />

        <button class="icon-btn" aria-label="Members" data-testid="members-toggle" @click="toggleMembers">
          <SvgMembers />
          <span class="absolute -top-1 -right-1 inline-grid place-items-center min-w-4 h-4 px-0.5 rounded-full bg-indigo-500 text-white text-[10px] font-bold" data-testid="members-count">{{ activeCount }}</span>
        </button>

        <button class="icon-btn" aria-label="Chat" data-testid="chat-toggle" @click="toggleChat">
          <SvgChat />
          <span v-if="unread" class="absolute -top-1 -right-1 inline-grid place-items-center min-w-4 h-4 px-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold" data-testid="chat-unread">{{ unread }}</span>
        </button>

        <button class="inline-grid place-items-center w-14 h-10 rounded-full text-white bg-rose-600 shadow-lg shadow-rose-950/40 transition-colors hover:bg-rose-500" data-testid="hang-up" aria-label="Hang up" @click="callEnd()">
          <SvgEnd />
        </button>
      </div>
    </div>
  </div>
</template>
