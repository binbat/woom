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
  <div class="flex flex-col justify-around">
    <center class="m-xs">
      <Player :stream="whip.stream" :muted="false" width="320px" :audio="whip.userStatus.audio" :video="whip.userStatus.video" :self="true" />
    </center>

    <center class="mb-xs">
      <label class="text-white">Your Name: </label>
      <input
        v-model="displayName"
        class="text-center"
        data-testid="name-input"
      />
    </center>

    <div class="flex justify-evenly bg-gray-800/80">
      <DeviceBar :stream-id="localStreamId" />
    </div>

    <center class="m-xs">
      <button class="btn-primary flex flex-row justify-center" data-testid="join-room" @click="join()">
        <center v-if="loading" class="m-2px mr-3"><Loading /></center>
        Join
        <template v-if="loading">...</template>
      </button>
    </center>
  </div>
</template>
