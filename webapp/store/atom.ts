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
  name: string
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

const localUserStatusAtom = atom<UserStatus>({
  name: "",
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
  meetingIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
}

export type {
  UserStream,
}
