<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { joinMeeting, setPresence } from '../lib/api'
import { log, setLogMeeting } from '../lib/log'
import {
  getStorageName,
  getStorageStream,
  setStorageName,
} from '../lib/storage'
import { joinedMeetingNo, joinPassword, meetingJoined } from '../store/atoms'
import DeviceBar from './device.vue'
import Player from './player/player.vue'
import Loading from './svg/loading.vue'
import useWhipClient from './use/whip'

const props = defineProps<{ meetingId: string }>()

const loading = ref<boolean>(false)
const joinError = ref('')
const password = ref('')
const displayName = ref<string>('')

const localStreamId = getStorageStream()

const whip = useWhipClient(localStreamId)
let joinGeneration = 0
let handedOff = false

const join = async () => {
  if (loading.value) return
  const generation = ++joinGeneration
  loading.value = true
  joinError.value = ''

  const name = displayName.value || localStreamId
  try {
    const joined = await joinMeeting(
      props.meetingId,
      name,
      password.value || undefined
    )
    if (generation !== joinGeneration) return

    setLogMeeting(props.meetingId)
    log('info', 'joined_meeting', '', { meetingId: props.meetingId, name })
    joinedMeetingNo.value = joined.meetingNo
    joinPassword.value = password.value
    whip.value.setUserName(name)
    setStorageName(displayName.value)

    handedOff = true
    meetingJoined.value = true
    whip.value.setSyncUserStatus(status => {
      if (meetingJoined.value) void setPresence(props.meetingId, status)
    })
    void whip.value.restart()
  } catch (e) {
    if (generation !== joinGeneration) return
    joinError.value = e instanceof Error ? e.message : String(e)
    log('error', 'join_meeting_failed', joinError.value, {
      meetingId: props.meetingId,
    })
  } finally {
    if (generation === joinGeneration) loading.value = false
  }
}

onMounted(() => {
  displayName.value = getStorageName() || ''
})

onUnmounted(() => {
  if (!handedOff) joinGeneration++
})
</script>

<template>
  <div class="flex flex-col items-center gap-6 py-8 px-4">
    <Player :stream="whip.stream" :muted="false" width="min(360px, 92vw)" :audio="whip.userStatus.audio" :video="whip.userStatus.video" :self="true" :name="displayName" />

    <label class="flex items-center gap-3 text-slate-300">
      <span class="text-sm font-medium whitespace-nowrap">Your Name</span>
      <input
        v-model="displayName"
        class="input-dark w-56 text-center"
        data-testid="name-input"
      />
    </label>

    <label v-if="joinError" class="flex items-center gap-3 text-slate-300">
      <span class="text-sm font-medium whitespace-nowrap">Password</span>
      <input
        v-model="password"
        type="password"
        class="input-dark w-56 text-center"
        data-testid="password-input"
      />
    </label>

    <p v-if="joinError" class="text-sm text-rose-400" data-testid="join-error">{{ joinError }}</p>

    <div class="panel px-3 py-2">
      <DeviceBar :stream-id="localStreamId" />
    </div>

    <button class="btn-primary min-w-44 text-lg" data-testid="join-room" :disabled="loading" @click="join()">
      <Loading v-if="loading" />
      Join{{ loading ? '...' : '' }}
    </button>
  </div>
</template>
