<script setup lang="ts">
import { onMounted, ref } from 'vue'
import useWhipClient from './use/whip'
import DeviceBar from './device.vue'
import Loading from './svg/loading.vue'
import Player from './player/player.vue'
import { meetingJoined } from '../store/atoms'
import { getStorageName, setStorageName, getStorageStream } from '../lib/storage'
import { setStream } from '../lib/api'

defineProps<{ meetingId: string }>()

const loading = ref<boolean>(false)
const displayName = ref<string>('')

const localStreamId = getStorageStream()

const whip = useWhipClient(localStreamId)

const join = async () => {
  loading.value = true

  whip.value.setUserName(displayName.value || localStreamId)

  meetingJoined.value = true
  setStorageName(displayName.value)
  await whip.value.restart()
  whip.value.setSyncUserStatus((status) => setStream(whip.value.id, status))
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

    <div class="panel px-3 py-2">
      <DeviceBar :stream-id="localStreamId" />
    </div>

    <button class="btn-primary min-w-44 text-lg" data-testid="join-room" @click="join()">
      <Loading v-if="loading" />
      Join{{ loading ? '...' : '' }}
    </button>
  </div>
</template>
