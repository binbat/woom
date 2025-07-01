import { atom } from 'jotai'
import { atomWithLocation } from 'jotai-location'
import { StreamState } from '../lib/api'

const locationAtom = atomWithLocation()
locationAtom.debugLabel = 'location'

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

const meetingIdAtom = atom('')
meetingIdAtom.debugLabel = 'meetingIdAtom'
const meetingJoinedAtom = atom(false)
meetingJoinedAtom.debugLabel = 'meetingJoined'

const presentationStreamAtom = atom<UserStream>({
  stream: new MediaStream(),
  name: 'Presentation',
})
presentationStreamAtom.debugLabel = 'presentationStream'

const enabledPresentationAtom = atom(get => get(presentationStreamAtom).stream.getVideoTracks().length !== 0)
enabledPresentationAtom.debugLabel = 'enabledPresentation'

const deviceSpeakerAtom = atom<string>('')
deviceSpeakerAtom.debugLabel = 'deviceSpeaker'
const speakerStatusAtom = atom<boolean>(false)
speakerStatusAtom.debugLabel = 'speakerStatus'

export {
  locationAtom,
  presentationStreamAtom,

  meetingIdAtom,
  meetingJoinedAtom,
  enabledPresentationAtom,
  deviceSpeakerAtom,
  speakerStatusAtom,
}

export type {
  UserStream,
  UserStatus,
}
