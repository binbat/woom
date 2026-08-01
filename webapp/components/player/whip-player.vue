<script setup lang="ts">
import { watch } from 'vue'
import useWhipClient from '../use/whip'
import Detail from './detail.vue'
import Player from './player.vue'
import { presentationStream } from '../../store/atoms'

const props = defineProps<{ streamId: string, width: string }>()

const whip = useWhipClient(props.streamId)

// TODO: refactor "presentation stream" handling for more precise control
watch([() => whip.value.userStatus.screen, () => whip.value.stream], () => {
  // set/clear "presentation stream" when self starts/stops sharing
  const stream = whip.value.stream
  const selfStreamName = `${whip.value.userStatus.name}_Presentation`
  if (whip.value.userStatus.screen && presentationStream.value.stream !== stream) {
    presentationStream.value = {
      name: selfStreamName,
      stream: stream,
    }
  } else if (!whip.value.userStatus.screen && presentationStream.value.name === selfStreamName) {
    presentationStream.value = {
      name: '',
      stream: new MediaStream(),
    }
  }
})
</script>

<template>
  <div class="relative flex flex-col">
    <Player :stream="whip.stream" :muted="true" :width="width" :audio="whip.userStatus.audio" :video="whip.userStatus.video && !whip.userStatus.screen" :self="true" :name="whip.userStatus.name" />
    <Detail :stream-id="streamId" :conn-status="whip.userStatus.state" :user-status="whip.userStatus" :restart="whip.restart" />
  </div>
</template>
