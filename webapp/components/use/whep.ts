import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import { event, Context, Data } from './whxp'
import { StreamState, Stream } from '../../lib/api'
import { log } from '../../lib/log'
import { WHEPClient } from 'whip-whep/whep'

interface WHIPData extends Data {
  connStatus: string
  setRemoteStatus: (userStatus: Stream) => void,
}

class WHEPContext extends Context {
  client: WHEPClient = new WHEPClient()
  cache: WHIPData
  remoteStatus: Stream
  connStatus: string = 'new'
  constructor(id: string) {
    super(id)
    this.cache = this.clone()
    this.remoteStatus = Object.assign({}, this.userStatus)
  }

  private newPeerConnection() {
    const { pc, setStream } = this
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = ev => setStream(new MediaStream([...this.stream.getTracks(), ev.track]))
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  setRemoteStatus = (userStatus: Stream) => this.remoteStatus = userStatus

  clone(): WHIPData {
    return {
      id: this.id,
      stream: this.stream,
      connStatus: this.connStatus,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart: () => this.restart(),
      setRemoteStatus: (userStatus: Stream) => this.setRemoteStatus(userStatus),
    }
  }

  export = () => this.cache

  sync() {
    this.cache = this.clone()
    this.dispatchEvent(event)
  }

  onconnectionstatechange = () => {
    this.userStatus.state = this.pc.connectionState as StreamState
    this.connStatus = this.pc.connectionState
    if (this.userStatus.state === StreamState.Failed || this.userStatus.state === StreamState.Disconnected) {
      log('warn', 'whep_state', this.pc.connectionState, { id: this.id })
    }
    this.sync()
  }

  async start() {
    const { id, pc, client, userStatus } = this
    log('info', 'whep_start', '', { id })
    pc.addEventListener('connectionstatechange', this.onconnectionstatechange)
    userStatus.state = StreamState.Signaled
    this.sync()
    this.newPeerConnection()

    try {
      const url = location.origin + `/whep/${id}`
      await client.view(pc, url)
    } catch (e) {
      log('error', 'whep_view_failed', String(e), { id })
      console.log(e)
      userStatus.state = StreamState.Failed
      this.sync()
    }

    if (!this.timer) this.timer = setInterval(() => this.run(), 5000)
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    try {
      await this.client.stop()
      this.pc.removeEventListener('connectionstatechange', this.onconnectionstatechange)
    } catch (e) {
      console.log(e)
    }
  }

  async restart() {
    await this.stop()
    this.stream = new MediaStream()
    this.pc = new RTCPeerConnection()
    await this.start()
  }

  mutedTicks = 0

  run() {
    // WatchDog, Auto Restart
    const restartStates = [StreamState.Disconnected, StreamState.Closed, StreamState.Failed]
    if (restartStates.find(i => i === this.userStatus.state) && this.remoteStatus.state === StreamState.Connected) {
      log('warn', 'whep_watchdog_restart', this.userStatus.state, { id: this.id })
      this.restart()
      return
    }
    // Connected but muted: the remote should be sending video yet the
    // track never unmutes (seen with liveion 0.9 mid-GOP subscribes).
    // Re-subscribing triggers a fresh keyframe request.
    const expectsVideo = this.remoteStatus.state === StreamState.Connected && this.remoteStatus.video
    const videoMuted = this.stream.getVideoTracks().some(t => t.muted)
    const noVideoTrack = this.stream.getVideoTracks().length === 0
    if (expectsVideo && (videoMuted || noVideoTrack)) {
      this.mutedTicks++
      if (this.mutedTicks >= 2) {
        log('warn', 'whep_watchdog_muted_restart', this.userStatus.state, { id: this.id })
        this.mutedTicks = 0
        this.restart()
      }
    } else {
      this.mutedTicks = 0
    }
  }
}

const contexts: WHEPContext[] = []

export default function useWhepClient(id: string): ShallowRef<WHIPData> {
  const newContext = (id: string) => {
    const context = new WHEPContext(id)
    contexts.push(context)
    return context
  }

  const context = contexts.find(ctx => ctx.id === id) || newContext(id)
  const data = shallowRef(context.export())
  const update = () => {
    data.value = context.export()
  }
  context.addEventListener(event.type, update)
  onScopeDispose(() => {
    context.removeEventListener(event.type, update)
  })
  return data
}
