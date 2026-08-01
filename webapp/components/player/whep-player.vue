<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import useWhepClient from '../use/whep'
import Detail from './detail.vue'
import Player from './player.vue'
import { presentationStream } from '../../store/atoms'
import { Stream } from '../../lib/api'

const props = defineProps<{ streamId: string, userStatus: Stream, width: string }>()

const whep = useWhepClient(props.streamId)

onMounted(() => {
  // restart() rather than start(): the shared WHEPContext for this streamId
  // may have been stopped by a previous unmount, and start() would reuse
  // its closed RTCPeerConnection
  whep.value.restart()
})

// unsubscribe when the tile leaves the visible set: without this the
// module-level WHEPContext would keep receiving media forever
onUnmounted(() => {
  whep.value.stop()

  // remove "presentation stream" when sharing user exits
  // TODO: manage users entering/exiting globally
  const selfStreamName = `${props.userStatus.name}_Presentation`
  if (presentationStream.value.name === selfStreamName) {
    presentationStream.value = {
      name: '',
      stream: new MediaStream(),
    }
  }
})

watch(() => props.userStatus, (userStatus) => {
  whep.value.setRemoteStatus(userStatus)
}, { immediate: true })

watch([() => props.userStatus.screen, () => whep.value.stream], () => {
  // set/clear "presentation stream" when remote user starts/stops sharing
  const stream = whep.value.stream
  const selfStreamName = `${props.userStatus.name}_Presentation`
  if (props.userStatus.screen && presentationStream.value.stream !== stream) {
    presentationStream.value = {
      name: selfStreamName,
      stream: stream,
    }
  } else if (!props.userStatus.screen && presentationStream.value.name === selfStreamName) {
    presentationStream.value = {
      name: '',
      stream: new MediaStream(),
    }
  }
})
</script>

<template>
  <div class="relative flex flex-col">
    <Player :stream="whep.stream" :muted="false" :width="width" :audio="userStatus.audio" :video="userStatus.video && !userStatus.screen" :self="false" />
    <Detail :stream-id="streamId" :conn-status="whep.connStatus" :user-status="userStatus" :restart="whep.restart" />
  </div>
</template>
