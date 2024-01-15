import { useSyncExternalStore } from 'react'
import { UserStatus } from '../../store/atom'
import { WHEPClient } from '@binbat/whip-whep/whep'

const event = new Event('sync')

class Context extends EventTarget {
  id: string = ""
  pc: RTCPeerConnection = new RTCPeerConnection()
  client: WHEPClient = new WHEPClient()
  stream: MediaStream = new MediaStream()
  userStatus: UserStatus = {
    name: "",
    state: "",
    audio: true,
    video: true,
    screen: false,
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  syncUserStatus = (_: UserStatus) => {}
  setSyncUserStatus = (callback: (userStatus: UserStatus) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  sync = () => {
    ctx = Object.assign({}, this)
    this.dispatchEvent(event)
  }
  start = start
  restart = restart
}

function newPeerConnection() {
  const { pc, setStream } = getContext()
  pc.addTransceiver('video', { 'direction': 'recvonly' })
  pc.addTransceiver('audio', { 'direction': 'recvonly' })

  pc.ontrack = ev => setStream(ev.streams[0])
}

const context = new Context()
let ctx = Object.assign({}, context)

function getContext() {
  return ctx
}

async function start() {
  const { id, pc, client, userStatus, sync, syncUserStatus } = context
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
    const url = location.origin + `/whep/${id}`
    await client.view(pc, url)
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

function subscribe(callback: () => void) {
  context.addEventListener(event.type, callback)
  return () => {
    context.removeEventListener(event.type, callback)
  }
}

export default function useWhipClient(streamId: string) {
  context.id = streamId
  return useSyncExternalStore(subscribe, getContext)
}
