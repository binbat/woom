import { useSyncExternalStore } from 'react'
import { event, Context, Data } from './whxp'
import { StreamState, Stream } from '../../lib/api'
import { WHEPClient } from '@binbat/whip-whep/whep'

interface WHIPData extends Data {
  setRemoteStatus: (userStatus: Stream) => void,
}

class WHEPContext extends Context {
  client: WHEPClient = new WHEPClient()
  cache: WHIPData
  remoteStatus: Stream
  constructor(id: string) {
    super(id)
    this.cache = this.clone()
    this.remoteStatus = Object.assign({}, this.userStatus)
  }

  private newPeerConnection() {
    const { pc, setStream } = this
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = ev => setStream(ev.streams[0])
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  setRemoteStatus = (userStatus: Stream) => this.remoteStatus = userStatus

  clone() {
    return {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart:  () => this.restart(),

      setRemoteStatus: (userStatus: Stream) => this.setRemoteStatus(userStatus),
    }
  }

  export = () => this.cache

  sync() {
    this.cache = this.clone()
    this.dispatchEvent(event)
  }

  async start() {
    const { id, pc, client, userStatus } = this
    pc.onconnectionstatechange = () => {
      userStatus.state = pc.connectionState as StreamState
      this.sync()
    }
    userStatus.state = StreamState.Signaled
    this.sync()
    this.newPeerConnection()

    try {
      const url = location.origin + `/whep/${id}`
      await client.view(pc, url)
    } catch (e) {
      console.log(e)
      userStatus.state = StreamState.Failed
      this.sync()
    }

    if (!this.timer) this.timer = setInterval(() => this.run(), 5000)
  }

  async stop() {
    if (!!this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    try {
      await this.client.stop()
    } catch (e) {
      console.log(e)
    }
  }

  async restart() {
    await this.stop()
    this.pc = new RTCPeerConnection()
    await this.start()
  }

  run() {
    // WatchDog, Auto Restart
    const restartStates = [StreamState.Disconnected, StreamState.Closed, StreamState.Failed]
    if (restartStates.find(i => i === this.userStatus.state) && this.remoteStatus.state === StreamState.Connected) this.restart()
  }
}

const contexts: WHEPContext[] = []

export default function useWhepClient(id: string) {
  const newContext = (id: string) => {
    const context = new WHEPContext(id)
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
