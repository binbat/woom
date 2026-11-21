import { computed, ref, shallowRef } from 'vue'
import type { Participant, StreamState } from '../lib/api'

interface UserStream {
  streamId: string
  stream: MediaStream
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
const joinedMeetingNo = ref('')
const joinPassword = ref('')

const presentationStream = shallowRef<UserStream>({
  streamId: '',
  stream: new MediaStream(),
  name: 'Presentation',
})

const enabledPresentation = computed(
  () => presentationStream.value.stream.getVideoTracks().length !== 0
)

const deviceSpeaker = ref<string>('')
const speakerStatus = ref<boolean>(false)

/** live room flags from the SSE snapshot (presenter/lock can change anytime) */
const roomInfo = ref<{ owner: string; presenter: string; locked: boolean }>({
  owner: '',
  presenter: '',
  locked: false,
})
const roomParticipants = ref<Participant[]>([])

export type { UserStatus, UserStream }
export {
  deviceSpeaker,
  enabledPresentation,
  joinedMeetingNo,
  joinPassword,
  meetingId,
  meetingJoined,
  presentationStream,
  roomInfo,
  roomParticipants,
  speakerStatus,
}
