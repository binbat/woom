import { computed, ref, shallowRef } from 'vue'
import type { Participant, StreamState } from '../lib/api'

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

/** live room flags from the SSE snapshot (presenter/lock can change anytime) */
const roomInfo = ref<{ owner: string, presenter: string, locked: boolean }>({ owner: '', presenter: '', locked: false })
const roomParticipants = ref<Participant[]>([])

export {
  presentationStream,

  meetingId,
  meetingJoined,
  enabledPresentation,
  deviceSpeaker,
  speakerStatus,
  roomInfo,
  roomParticipants,
}

export type {
  UserStream,
  UserStatus,
}
