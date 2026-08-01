<script setup lang="ts">
import { onMounted, ref } from 'vue'
import useWhipClient from './use/whip'
import DeviceBar from './device.vue'
import Loading from './svg/loading.vue'
import Player from './player/player.vue'
import { meetingJoined } from '../store/atoms'
import { getStorageName, setStorageName, getStorageStream } from '../lib/storage'
import { joinMeeting, setPresence } from '../lib/api'
import { log, setLogMeeting } from '../lib/log'

const props = defineProps<{ meetingId: string }>()

const loading = ref<boolean>(false)
const joinError = ref('')
const password = ref('')
const displayName = ref<string>('')

const localStreamId = getStorageStream()

const whip = useWhipClient(localStreamId)

const join = async () => {
  loading.value = true
  joinError.value = ''

  const name = displayName.value || localStreamId
  try {
    await joinMeeting(props.meetingId, name, password.value || undefined)
  } catch (e) {
    joinError.value = e instanceof Error ? e.message : String(e)
    log('error', 'join_meeting_failed', joinError.value, { meetingId: props.meetingId })
    loading.value = false
    return
  }
  setLogMeeting(props.meetingId)
  log('info', 'joined_meeting', '', { meetingId: props.meetingId, name })

  whip.value.setUserName(name)

  meetingJoined.value = true
  setStorageName(displayName.value)
  await whip.value.restart()
  whip.value.setSyncUserStatus((status) => setPresence(props.meetingId, status))
  loading.value = false
}

onMounted(() => {
  displayName.value = getStorageName() || ''
})
</script>

<template>
  <div class="flex flex-col items-center gap-6 py-8 px-4">
    <Player :stream="whip.stream" :muted="false" width="360px" :audio="whip.userStatus.audio" :video="whip.userStatus.video" :self="true" />

    <label class="flex items-center gap-3 text-slate-300">
      <span class="text-sm font-medium whitespace-nowrap">Your Name</span>
      <input
        v-model="displayName"
        class="input-dark w-56 text-center"
        data-testid="name-input"
      />
    </label>

    <label v-if="joinError.includes('password')" class="flex items-center gap-3 text-slate-300">
      <span class="text-sm font-medium whitespace-nowrap">Password</span>
      <input
        v-model="password"
        type="password"
        class="input-dark w-56 text-center"
        data-testid="password-input"
      />
    </label>

    <p v-if="joinError" class="text-sm text-rose-400">{{ joinError }}</p>

    <div class="panel px-3 py-2">
      <DeviceBar :stream-id="localStreamId" />
    </div>

    <button class="btn-primary min-w-44 text-lg" data-testid="join-room" @click="join()">
      <Loading v-if="loading" />
      Join{{ loading ? '...' : '' }}
    </button>
  </div>
</template>
