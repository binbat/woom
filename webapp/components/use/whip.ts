import { useSyncExternalStore } from 'react'
import { UserStatus } from '../../store/atom'
import { WHIPClient } from '@binbat/whip-whep/whip'
import {
  deviceNone,
  asyncGetAudioStream,
  asyncGetVideoStream,
} from '../../lib/device'

const event = new Event('sync')

class Context extends EventTarget {
  id: string = ""
  pc: RTCPeerConnection = new RTCPeerConnection()
  client: WHIPClient = new WHIPClient()
  stream: MediaStream = new MediaStream()
  userStatus: UserStatus = {
    name: "",
    state: "",
    audio: true,
    video: true,
    screen: false,
  }

  currentDeviceAudio = deviceNone.deviceId
  currentDeviceVideo = deviceNone.deviceId

  syncUserStatus = (_: UserStatus) => {}
  setSyncUserStatus = (callback: (userStatus: UserStatus) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  setCurrentDeviceAudio = setCurrentDeviceAudio
  setCurrentDeviceVideo = setCurrentDeviceVideo

  toggleEnableAudio = async () => setCurrentDeviceAudio(this.userStatus.audio ? deviceNone.deviceId : this.currentDeviceAudio)
  toggleEnableVideo = async () => setCurrentDeviceVideo(this.userStatus.video ? deviceNone.deviceId : this.currentDeviceVideo)

  setUserName = (name: string) => {
    this.userStatus.name = name
    this.sync()
    this.syncUserStatus(this.userStatus)
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  sync = () => {
    ctx = Object.assign({}, this)
    this.dispatchEvent(event)
  }
  start = start
  restart = restart
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

const context = new Context()
let ctx = Object.assign({}, context)

function getContext() {
  return ctx
}

function onChangedDeviceAudio() {
  const { pc, stream } = context
  // If WebRTC is connected, switch track
  // NOTE: array audio index is: 0
  pc.getSenders().filter((_, i) => i === 0).map(sender => {
    if (stream) {
      stream.getAudioTracks().map(track => sender.replaceTrack(track))
    }
  })
}

async function setCurrentDeviceAudio(current: string) {
  const { stream, userStatus, currentDeviceAudio, sync, syncUserStatus } = context

  if (current !== currentDeviceAudio || !userStatus.audio) {
    // Closed old tracks
    stream.getAudioTracks().map(track => {
      track.stop()
      stream.removeTrack(track)
    })

    const mediaStream = await asyncGetAudioStream(current)

    const videoTracks = stream.getVideoTracks()
    const audioTracks = mediaStream.getAudioTracks()

    context.stream = new MediaStream([...audioTracks, ...videoTracks])
    context.userStatus.audio = current === deviceNone.deviceId ? false : true
    context.currentDeviceAudio = current === deviceNone.deviceId ? context.currentDeviceAudio : current

    sync()
    syncUserStatus(userStatus)
    onChangedDeviceAudio()
  }
}

function onChangedDeviceVideo() {
  const { pc, stream } = context
  // If WebRTC is connected, switch track
  // NOTE: array video index is: 1
  pc.getSenders().filter((_, i) => i === 1).map(sender => {
    if (stream) {
      stream.getVideoTracks().map(track => sender.replaceTrack(track))
    }
  })
}

async function setCurrentDeviceVideo(current: string) {
  const { stream, userStatus, currentDeviceVideo, sync, syncUserStatus } = context

  if (current !== currentDeviceVideo || !userStatus.video) {
    // Closed old tracks
    stream.getVideoTracks().map(track => {
      track.stop()
      stream.removeTrack(track)
    })

    const mediaStream = await asyncGetVideoStream(current)
    const audioTracks = stream.getAudioTracks()
    const videoTracks = mediaStream.getVideoTracks()

    context.stream = new MediaStream([...audioTracks, ...videoTracks])
    context.userStatus.video = current === deviceNone.deviceId ? false : true
    context.currentDeviceVideo = current === deviceNone.deviceId ? context.currentDeviceVideo : current

    sync()
    syncUserStatus(userStatus)
    onChangedDeviceVideo()
  }
}

async function start() {
  const { id, pc, stream, client, userStatus, sync, syncUserStatus } = context
  if (stream.getTracks().length === 0) return
  pc.onconnectionstatechange = () => {
    userStatus.state = pc.connectionState
    sync()
    syncUserStatus(userStatus)
  }
  userStatus.state = 'signaled'
  sync()
  syncUserStatus(userStatus)
  newPeerConnection()

  try {
    const url = location.origin + `/whip/${id}`
    await client.publish(pc, url)
  } catch (e) {
    console.log(e)
    userStatus.state = 'failed'
    syncUserStatus(userStatus)
    sync()
  }
}

async function restart() {
  await context.client.stop()
  context.pc = new RTCPeerConnection()
  start()
}

function run() {
  console.log("=== RUN ===")
  const { userStatus } = context
  if (userStatus.state === "") start()

  //if (userStatus.state !== "connected" && userStatus.state !== "signaled") restart()
}

//let timer: ReturnType<typeof setInterval> | null
//let timerSum = 0

function subscribe(callback: () => void) {
  context.addEventListener(event.type, callback)
  //if (timer === null) timer = setInterval(run, 3000)
  //timerSum++
  return () => {
    //timerSum--
    //if (timerSum === 0 && timer !== null) {
    //  clearInterval(timer)
    //  timer = null
    //}
    context.removeEventListener(event.type, callback)
  }
}

export default function useWhipClient(streamId: string) {
  context.id = streamId
  return useSyncExternalStore(subscribe, getContext)
}
