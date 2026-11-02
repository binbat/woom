<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { Stream, StreamState } from '../../lib/api'
import { presentationStream } from '../../store/atoms'
import useWhepClient from '../use/whep'
import Detail from './detail.vue'
import Player from './player.vue'

const props = defineProps<{
  streamId: string
  userStatus: Stream
  width: string
}>()

const whep = useWhepClient(props.streamId)

// Subscribing before the publisher's WHIP connection is fully established
// can bind to a publish session that gets replaced, leaving a connected
// but forever-muted track (seen with liveion 0.9). Subscribe only once the
// remote presence reports `connected`.
onMounted(() => {
  if (props.userStatus.state === StreamState.Connected) {
    whep.value.restart()
  }
})

watch(
  () => props.userStatus.state,
  (state, prev) => {
    if (state === StreamState.Connected && prev !== StreamState.Connected) {
      whep.value.restart()
    }
  }
)

// unsubscribe when the tile leaves the visible set: without this the
// module-level WHEPContext would keep receiving media forever
onUnmounted(() => {
  whep.value.stop()

  if (presentationStream.value.streamId === props.streamId) {
    presentationStream.value = {
      streamId: '',
      name: '',
      stream: new MediaStream(),
    }
  }
})

watch(
  () => props.userStatus,
  userStatus => {
    whep.value.setRemoteStatus(userStatus)
  },
  { immediate: true }
)

watch(
  [() => props.userStatus.screen, () => whep.value.stream],
  () => {
    const stream = whep.value.stream
    if (props.userStatus.screen) {
      presentationStream.value = {
        streamId: props.streamId,
        name: `${props.userStatus.name}_Presentation`,
        stream,
      }
    } else if (presentationStream.value.streamId === props.streamId) {
      presentationStream.value = {
        streamId: '',
        name: '',
        stream: new MediaStream(),
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="relative flex flex-col">
    <Player :stream="whep.stream" :muted="false" :width="width" :audio="userStatus.audio" :video="userStatus.video && !userStatus.screen" :self="false" :name="userStatus.name" />
    <Detail :stream-id="streamId" :conn-status="whep.connStatus" :user-status="userStatus" :restart="whep.restart" />
  </div>
</template>
