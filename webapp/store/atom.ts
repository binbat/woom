import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { atomWithLocation } from 'jotai-location'

const locationAtom = atomWithLocation()
locationAtom.debugLabel = 'location'

interface UserStream {
  stream: MediaStream,
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
  stream: new MediaStream,
  name: "Me",
})
localStreamAtom.debugLabel = 'localStream'

const currentDeviceAudioAtom = atom<string>("none")
currentDeviceAudioAtom.debugLabel = 'currentDeviceAudio'
const currentDeviceVideoAtom = atom<string>("none")
currentDeviceVideoAtom.debugLabel = 'currentDeviceVideo'

export {
  localStreamIdAtom,
  remoteStreamIdsAtom,

  locationAtom,
  meetingIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
}

export type {
  UserStream,
}
