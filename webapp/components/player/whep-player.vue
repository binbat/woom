<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { Stream, StreamState } from '../../lib/api'
import { registerPresentation, unregisterPresentation } from '../../store/atoms'
import SvgVideo from '../svg/video.vue'
import useWhepClient from '../use/whep'
import Detail from './detail.vue'
import Player from './player.vue'

const props = defineProps<{
  streamId: string
  userStatus: Stream
  width: string
  videoEnabled: boolean
  videoOverridden: boolean
}>()
const emit = defineEmits<{ toggleVideo: [] }>()

const whep = useWhepClient(props.streamId)

watch(
  () => props.videoEnabled,
  enabled => {
    void whep.value.setVideoEnabled(enabled)
  },
  { immediate: true }
)

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
  unregisterPresentation(props.streamId)
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
    if (props.userStatus.screen) {
      registerPresentation(props.streamId, {
        streamId: props.streamId,
        name: `${props.userStatus.name}_Presentation`,
        stream: whep.value.stream,
      })
    } else {
      unregisterPresentation(props.streamId)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="relative flex flex-col" data-testid="video-tile">
    <Player :stream="whep.stream" :muted="false" :width="width" :audio="userStatus.audio" :video="videoEnabled && userStatus.video && !userStatus.screen" :self="false" :name="userStatus.name" :show-avatar-name="videoEnabled" :disabled-tip="!videoEnabled && userStatus.video ? 'Audio only' : undefined" />
    <Detail :stream-id="streamId" :conn-status="whep.connStatus" :user-status="userStatus" :restart="whep.restart" />
    <button
      v-if="userStatus.video && !userStatus.screen && (!videoEnabled || videoOverridden)"
      type="button"
      class="absolute bottom-2 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs whitespace-nowrap text-white shadow-md transition-colors hover:bg-slate-800"
      :aria-label="`${videoEnabled ? 'Disable' : 'Enable'} video for ${userStatus.name}`"
      :title="`${videoEnabled ? 'Disable' : 'Enable'} video`"
      data-testid="remote-video-toggle"
      :data-stream-id="streamId"
      :data-video-enabled="videoEnabled ? 'true' : 'false'"
      @click="emit('toggleVideo')"
    >
      <SvgVideo class="h-4 w-4" />
      <span>{{ videoEnabled ? 'Disable' : 'Enable' }}</span>
    </button>
  </div>
</template>
