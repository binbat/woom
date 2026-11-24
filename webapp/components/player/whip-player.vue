<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { registerPresentation, unregisterPresentation } from '../../store/atoms'
import useWhipClient from '../use/whip'
import Detail from './detail.vue'
import Player from './player.vue'

const props = defineProps<{ streamId: string; width: string }>()

const whip = useWhipClient(props.streamId)

watch(
  [() => whip.value.userStatus.screen, () => whip.value.stream],
  () => {
    if (whip.value.userStatus.screen) {
      registerPresentation(props.streamId, {
        streamId: props.streamId,
        name: `${whip.value.userStatus.name}_Presentation`,
        stream: whip.value.stream,
      })
    } else {
      unregisterPresentation(props.streamId)
    }
  },
  { immediate: true }
)

onUnmounted(() => unregisterPresentation(props.streamId))
</script>

<template>
  <div class="relative flex flex-col" data-testid="video-tile">
    <Player :stream="whip.stream" :muted="true" :width="width" :audio="whip.userStatus.audio" :video="whip.userStatus.video && !whip.userStatus.screen" :self="true" :name="whip.userStatus.name" />
    <Detail :stream-id="streamId" :conn-status="whip.userStatus.state" :user-status="whip.userStatus" :restart="whip.restart" />
  </div>
</template>
