import { useSyncExternalStore } from 'react'
import { UserStatus } from '../../store/atom'
import { WHIPClient } from '@binbat/whip-whep/whip'
import { deviceNone } from '../../lib/device'

interface Context {
  id: string
  pc: RTCPeerConnection
  client: WHIPClient
  stream: MediaStream
  userStatus: UserStatus

  currentDeviceAudio: string
  currentDeviceVideo: string

  setCurrentDeviceAudio: (_: string) => void
  setCurrentDeviceVideo: (_: string) => void

  sync: () => void
  restart: () => void
}

const userStatus: UserStatus = {
  name: "",
  state: "",
  audio: true,
  video: true,
  screen: false,
}

function newPeerConnection() {
  const { pc, stream } = getContext()

  // NOTE: array audio index is: 0
  if (!stream.getAudioTracks().length) {
    pc.addTransceiver('audio', { 'direction': 'sendonly' })
  } else {
    stream.getAudioTracks().map(track => pc.addTrack(track))
  }

  // NOTE: array video index is: 1
  if (!stream.getVideoTracks().length) {
    pc.addTransceiver('video', { 'direction': 'sendonly' })
  } else {
    stream.getVideoTracks().map(track => pc.addTrack(track))
  }
}

const context: Context = {
  id: "",
  pc: new RTCPeerConnection(),
  client: new WHIPClient(),
  stream: new MediaStream(),
  userStatus: userStatus,

  currentDeviceAudio: deviceNone.deviceId,
  currentDeviceVideo: deviceNone.deviceId,

  setCurrentDeviceAudio: setCurrentDeviceAudio,
  setCurrentDeviceVideo: setCurrentDeviceVideo,

  sync: () => {},
  restart: restart,
}

function getContext() {
  return context
}

function setCurrentDeviceAudio(deviceId: string) {
  const { pc, stream } = context
  // If WebRTC is connected, switch track
  // NOTE: array audio index is: 0
  pc.getSenders().filter((_, i) => i === 0).map(sender => {
    if (stream) {
      stream.getAudioTracks().map(track => sender.replaceTrack(track))
    }
  })
}

function setCurrentDeviceVideo(deviceId: string) {
  const { pc, stream } = context
  // If WebRTC is connected, switch track
  // NOTE: array video index is: 1
  pc.getSenders().filter((_, i) => i === 1).map(sender => {
    if (stream) {
      stream.getVideoTracks().map(track => sender.replaceTrack(track))
    }
  })
}

async function start() {
  const { id, pc, client, userStatus, sync } = context
  pc.onconnectionstatechange = () => {
    userStatus.state = pc.connectionState
    sync()
  }
  userStatus.state = 'signaled'
  newPeerConnection()

  try {
    const url = location.origin + `/whip/${id}`
    await client.publish(pc, url)
  } catch (e) {
    console.log(e)
    userStatus.state = 'failed'
  }
}

async function restart() {
  context.client.stop()
  context.pc = new RTCPeerConnection()
  start()
}

function run() {
  console.log("=== RUN ===")
  const { userStatus } = context
  if (userStatus.state === "") start()
}

function subscribe(callback: () => void) {
  context.sync = callback
  console.log("subscribe")
  const timer = setInterval(run, 3000)
  return () => {
    clearInterval(timer)
    console.log("subscribe end")
  }
}

export default function useWhipClient(name: string, streamId: string, stream: MediaStream) {
  context.id = streamId
  context.stream = stream
  context.userStatus.name = name
  return useSyncExternalStore(subscribe, getContext)
}
