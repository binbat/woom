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

  cache: any

  constructor(id: string) {
    super()
    this.id = id
    this.clone()
  }

  clone() {
    this.cache = {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      start: () => this.start(),
      restart:  () => this.restart(),
    }
  }

  export = () => this.cache

  private newPeerConnection() {
    const { pc, setStream } = this
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = ev => setStream(ev.streams[0])
  }

  syncUserStatus = (_: UserStatus) => {}
  setSyncUserStatus = (callback: (userStatus: UserStatus) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  sync() {
    this.clone()
    this.dispatchEvent(event)
  }
  async start() {
    const { id, pc, client, userStatus } = this
    pc.onconnectionstatechange = () => {
      userStatus.state = pc.connectionState
      this.sync()
      this.syncUserStatus(userStatus)
    }
    userStatus.state = 'signaled'
    this.sync()
    this.syncUserStatus(userStatus)
    this.newPeerConnection()

    try {
      const url = location.origin + `/whep/${id}`
      await client.view(pc, url)
    } catch (e) {
      console.log(e)
      userStatus.state = 'failed'
      this.syncUserStatus(userStatus)
      this.sync()
    }
  }
  async restart() {
    await this.client.stop()
    this.pc = new RTCPeerConnection()
    await this.start()
    this.sync()
  }
}

const contexts: Context[] = []
function run() {
  console.log("=== RUN ===")
  //const { userStatus } = context
  //if (userStatus.state === "") start()

  //if (userStatus.state !== "connected" && userStatus.state !== "signaled") restart()
}

export default function useWhipClient(id: string) {
  const newContext = (id: string) => {
    const context = new Context(id)
    contexts.push(context)
    return context
  }

  const context = contexts.find(ctx => ctx.id === id) || newContext(id)
  return useSyncExternalStore((callback: () => void) => {
    context.addEventListener(event.type, callback)
    return () => {
      context.removeEventListener(event.type, callback)
    }
  }, () => context.export())
}
