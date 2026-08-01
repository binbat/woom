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
  whep.value.start()
})

// remove "presentation stream" when sharing user exits
// TODO: manage users entering/exiting globally
onUnmounted(() => {
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
  <center class="relative flex flex-col">
    <Player :stream="whep.stream" :muted="false" :width="width" :audio="userStatus.audio" :video="userStatus.video && !userStatus.screen" :self="false" />
    <Detail :stream-id="streamId" :conn-status="whep.connStatus" :user-status="userStatus" :restart="whep.restart" />
  </center>
</template>
