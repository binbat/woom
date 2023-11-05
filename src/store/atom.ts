import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { atomWithLocation } from 'jotai-location'

const locationAtom = atomWithLocation()

interface UserStream {
  stream: MediaStream | null,
  name: string
}

const localStreamIdAtom = atomWithStorage('stream', '')
localStreamIdAtom.debugLabel = 'localStreamId'

const remoteStreamIdsAtom = atom<string[]>([])
remoteStreamIdsAtom.debugLabel = 'remoteStreamIds'

const meetingIdAtom = atom("")
meetingIdAtom.debugLabel = 'meetingIdAtom'
const meetingJoinedAtom = atom(false)
meetingJoinedAtom.debugLabel = 'meetingJoined'

const localStreamAtom = atom<UserStream>({
  stream: null,
  name: "me",
})

localStreamAtom.debugLabel = 'localStream'

const remoteStreamsAtom = atom<UserStream[]>([])
remoteStreamsAtom.debugLabel = 'remoteStreams'

const currentDeviceAudioAtom = atom<string>("none")
currentDeviceAudioAtom.debugLabel = 'currentDeviceAudio'
const currentDeviceVideoAtom = atom<string>("none")
currentDeviceVideoAtom.debugLabel = 'currentDeviceVideo'

const peerConnectionAtom = atom<{ current: RTCPeerConnection }>({ current: new RTCPeerConnection() })
peerConnectionAtom.debugLabel = 'peerConnection'

export {
  localStreamIdAtom,
  remoteStreamIdsAtom,

  locationAtom,
  meetingIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  remoteStreamsAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
  peerConnectionAtom,
}

export type {
  UserStream,
}
