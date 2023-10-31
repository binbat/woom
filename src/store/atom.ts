import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { atomWithLocation } from 'jotai-location'

const locationAtom = atomWithLocation()

//function guidGenerator() {
//  var S4 = function() {
//    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
//  }
//  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4())
//}

interface UserStream {
  stream: MediaStream | null,
  name: string
}

const localStreamIdAtom = atomWithStorage('stream', '')
const remoteStreamsIdAtom = atom<string[]>([])

//const uuid = guidGenerator()

//const streamAtom = atom<string[]>([uuid])
//const meAtom = atom<string | null>(null)
const meetingIdAtom = atom("")
const meetingAtom = atom(false)

const localStreamAtom = atom<UserStream>({
  stream: null,
  name: "me",
})
const remoteStreamsAtom = atom<UserStream[]>([])

const currentDeviceAudioAtom = atom<string>("none")
const currentDeviceVideoAtom = atom<string>("none")

const peerConnectionAtom = atom<{ current: RTCPeerConnection }>({ current: new RTCPeerConnection() })

export {
  localStreamIdAtom,
  remoteStreamsIdAtom,

  locationAtom,
  meetingAtom,
  meetingIdAtom,
  localStreamAtom,
  remoteStreamsAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
  peerConnectionAtom,
}

export type {
  UserStream,
}
