import { atom } from 'jotai'
import { atomWithLocation } from 'jotai-location'

const locationAtom = atomWithLocation()
locationAtom.debugLabel = 'location'

interface UserStream {
  stream: MediaStream,
  name: string
}

interface UserStatus {
  // Nick Name
  name: string

  // Reference: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState#value
  state: string
  audio: boolean
  video: boolean
  screen: boolean
}

const remoteStreamIdsAtom = atom<string[]>([])
remoteStreamIdsAtom.debugLabel = 'remoteStreamIds'

const meetingIdAtom = atom("")
meetingIdAtom.debugLabel = 'meetingIdAtom'
const meetingJoinedAtom = atom(false)
meetingJoinedAtom.debugLabel = 'meetingJoined'

const presentationStreamAtom = atom<UserStream>({
  stream: new MediaStream,
  name: "Presentation",
})
presentationStreamAtom.debugLabel = 'presentationStream'

const enabledPresentationAtom = atom(get => get(presentationStreamAtom).stream.getVideoTracks().length !== 0)
enabledPresentationAtom.debugLabel = 'enabledPresentation'

const remoteUsersStatusAtom = atom<UserStatus[]>([])
remoteUsersStatusAtom.debugLabel = 'remoteUsersStatus'

export {
  remoteStreamIdsAtom,
  remoteUsersStatusAtom,

  locationAtom,
  presentationStreamAtom,

  meetingIdAtom,
  meetingJoinedAtom,
  enabledPresentationAtom,
}

export type {
  UserStream,
  UserStatus,
}
