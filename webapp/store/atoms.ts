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
/** true when the app was opened on the /admin console path */
const adminMode = ref(false)
/** non-null while the current meeting is being recorded (server snapshot) */
const recordingAt = ref<number | null>(null)

// Streams currently sharing their screen register here; the presentation
// slot is derived from the registry instead of players pushing/clearing a
// single global stream, so one sharer stopping can never clear another
// sharer's presentation (https://github.com/binbat/woom/issues/47).
// Map order is insertion order: the newest registrant takes the stage, and
// earlier ones resume when it unregisters. Re-registering an existing id
// keeps its position, so media refreshes never steal the stage.
const presentationCandidates = shallowRef(new Map<string, UserStream>())

const registerPresentation = (streamId: string, candidate: UserStream) => {
  const next = new Map(presentationCandidates.value)
  next.set(streamId, candidate)
  presentationCandidates.value = next
}

const unregisterPresentation = (streamId: string) => {
  if (!presentationCandidates.value.has(streamId)) return
  const next = new Map(presentationCandidates.value)
  next.delete(streamId)
  presentationCandidates.value = next
}

const emptyPresentation: UserStream = {
  streamId: '',
  stream: new MediaStream(),
  name: 'Presentation',
}

const presentationStream = computed<UserStream>(() => {
  const candidates = [...presentationCandidates.value.values()]
  return candidates[candidates.length - 1] ?? emptyPresentation
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
  adminMode,
  deviceSpeaker,
  enabledPresentation,
  joinedMeetingNo,
  joinPassword,
  meetingId,
  meetingJoined,
  presentationStream,
  recordingAt,
  registerPresentation,
  roomInfo,
  roomParticipants,
  speakerStatus,
  unregisterPresentation,
}
