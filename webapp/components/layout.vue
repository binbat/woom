<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
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

const props = defineProps<{ meetingId: string }>()

const copyStatus = ref(false)

const localStreamId = getStorageStream()
const remoteUserStatus = ref<Record<string, UserStatus>>({})

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
  <div class="flex flex-col justify-between" style="height: 100vh">
    <div></div>

    <Player
      v-if="enabledPresentation"
      :stream="presentationStream.stream"
      :muted="true"
      :video="true"
      :audio="false"
      width="auto"
      :self="false"
    />

    <div class="flex flex-row flex-wrap justify-evenly">
      <WhipPlayer :stream-id="localStreamId" width="320px" />
      <WhepPlayer v-for="i in Object.keys(remoteUserStatus)" :key="i" :stream-id="i" :user-status="remoteUserStatus[i]" width="320px" />
    </div>

    <center>
      <div class="flex justify-evenly bg-gray-800/80">
        <section class="hidden md:flex md:flex-col md:justify-center">
          <button class="flex flex-row text-rose-400 rounded-md bg-inherit p-2" @click="copyMeetingLink">
            <code class="mx-sm my-1px" data-testid="meeting-id">{{ meetingId }}</code>
            <center class="text-rose-400 rounded-md" :style="{ visibility: copyStatus ? 'visible' : 'hidden' }">
              <SvgDone />
            </center>
          </button>
        </section>

        <DeviceBar :stream-id="localStreamId" />

        <section class="flex flex-col justify-center">
          <button class="text-white bg-rose-600 hover:bg-rose-700 duration-1000 shadow-xl rounded-3xl w-18 h-10" data-testid="hang-up" @click="callEnd()">
            <center>
              <SvgEnd />
            </center>
          </button>
        </section>
      </div>
    </center>
  </div>
</template>
