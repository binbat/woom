import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
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

const displayNameAtom = atomWithStorage('name', '')
displayNameAtom.debugLabel = 'displayName'

const localStreamIdAtom = atomWithStorage('stream', '')
localStreamIdAtom.debugLabel = 'localStreamId'

const remoteStreamIdsAtom = atom<string[]>([])
remoteStreamIdsAtom.debugLabel = 'remoteStreamIds'

const meetingIdAtom = atom("")
meetingIdAtom.debugLabel = 'meetingIdAtom'
const meetingJoinedAtom = atom(false)
meetingJoinedAtom.debugLabel = 'meetingJoined'

const localStreamAtom = atom<UserStream>({
  stream: new MediaStream,
  name: "Me",
})
localStreamAtom.debugLabel = 'localStream'

const presentationStreamAtom = atom<UserStream>({
  stream: new MediaStream,
  name: "Presentation",
})
presentationStreamAtom.debugLabel = 'presentationStream'

const enabledPresentationAtom = atom(get => get(presentationStreamAtom).stream.getVideoTracks().length !== 0)
enabledPresentationAtom.debugLabel = 'enabledPresentation'

const enabledAudioAtom = atom(get => get(localStreamAtom).stream.getAudioTracks().length !== 0)
enabledAudioAtom.debugLabel = 'enabledAudio'
const enabledVideoAtom = atom(get => get(localStreamAtom).stream.getVideoTracks().length !== 0)
enabledVideoAtom.debugLabel = 'enabledVideo'

const localUserStatusAtom = atom<UserStatus>({
  name: "",
  state: "new",
  audio: false,
  video: false,
  screen: false,
})
localUserStatusAtom.debugLabel = 'localUserStatus'

const remoteUsersStatusAtom = atom<UserStatus[]>([])
remoteUsersStatusAtom.debugLabel = 'remoteUsersStatus'

const currentDeviceAudioAtom = atom<string>("none")
currentDeviceAudioAtom.debugLabel = 'currentDeviceAudio'
const currentDeviceVideoAtom = atom<string>("none")
currentDeviceVideoAtom.debugLabel = 'currentDeviceVideo'

export {
  displayNameAtom,

  localStreamIdAtom,
  remoteStreamIdsAtom,

  localUserStatusAtom,
  remoteUsersStatusAtom,

  locationAtom,
  presentationStreamAtom,

  meetingIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  enabledAudioAtom,
  enabledVideoAtom,
  enabledPresentationAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
}

export type {
  UserStream,
  UserStatus,
}
