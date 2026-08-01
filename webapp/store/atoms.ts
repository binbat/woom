import { computed, ref, shallowRef } from 'vue'
import type { StreamState } from '../lib/api'

interface UserStream {
  stream: MediaStream,
  name: string
}

interface UserStatus {
  /**
   * nick name
   */
  name: string
  state: StreamState
  audio: boolean
  video: boolean
  screen: boolean
}

const meetingId = ref('')
const meetingJoined = ref(false)

const presentationStream = shallowRef<UserStream>({
  stream: new MediaStream(),
  name: 'Presentation',
})

const enabledPresentation = computed(() => presentationStream.value.stream.getVideoTracks().length !== 0)

const deviceSpeaker = ref<string>('')
const speakerStatus = ref<boolean>(false)

export {
  presentationStream,

  meetingId,
  meetingJoined,
  enabledPresentation,
  deviceSpeaker,
  speakerStatus,
}

export type {
  UserStream,
  UserStatus,
}
