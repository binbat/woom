import { onScopeDispose, type ShallowRef, shallowRef } from 'vue'
import { WHEPClient } from 'whip-whep/whep'
import { type Stream, StreamState, token } from '../../lib/api'
import { log } from '../../lib/log'
import { Context, type Data, event } from './whxp'

interface WHEPData extends Data {
  connStatus: string
  setRemoteStatus: (userStatus: Stream) => void
}

interface ViewSession {
  generation: number
  client: WHEPClient
  pc: RTCPeerConnection
  onStateChange: () => void
  view?: Promise<void>
  cleanup?: Promise<void>
}

class WHEPContext extends Context {
  cache: WHEPData
  remoteStatus: Stream
  connStatus: string = StreamState.New

  private session: ViewSession | undefined
  private generation = 0
  private wantsRunning = false
  private startOperation:
    | { generation: number; promise: Promise<void> }
    | undefined
  private mutedTicks = 0

  constructor(id: string) {
    super(id)
    this.cache = this.clone()
    this.remoteStatus = { ...this.userStatus }
  }

  setRemoteStatus = (userStatus: Stream) => {
    this.remoteStatus = userStatus
  }

  clone(): WHEPData {
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

  private isRunningGeneration(generation: number) {
    return this.wantsRunning && generation === this.generation
  }

  private clearStream() {
    this.stream.getTracks().forEach(track => {
      track.stop()
    })
    this.stream = new MediaStream()
    this.sync()
  }

  private createSession(generation: number): ViewSession {
    const pc = new RTCPeerConnection()
    const session: ViewSession = {
      generation,
      client: new WHEPClient(),
      pc,
      onStateChange: () => {},
    }
    session.onStateChange = () => {
      if (
        this.session !== session ||
        !this.isRunningGeneration(session.generation)
      )
        return
      this.userStatus.state = pc.connectionState as StreamState
      this.connStatus = pc.connectionState
      this.mutedTicks = 0
      if (
        this.userStatus.state === StreamState.Failed ||
        this.userStatus.state === StreamState.Disconnected
      ) {
        log('warn', 'whep_state', pc.connectionState, { id: this.id })
      }
      this.sync()
    }
    pc.addEventListener('connectionstatechange', session.onStateChange)
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = ev => {
      if (
        this.session !== session ||
        !this.isRunningGeneration(session.generation)
      )
        return
      if (!this.stream.getTracks().includes(ev.track)) {
        this.stream = new MediaStream([...this.stream.getTracks(), ev.track])
        this.sync()
      }
    }
    return session
  }

  private cleanupSession(session: ViewSession): Promise<void> {
    if (session.cleanup) return session.cleanup
    session.cleanup = (async () => {
      const { client, pc } = session
      pc.removeEventListener('connectionstatechange', session.onStateChange)
      pc.onconnectionstatechange = null
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
      try {
        if (session.view) await session.view.catch(() => {})
        await client.stop()
      } catch {
        // Signaling can fail before an upstream resource exists.
      } finally {
        pc.close()
      }
    })()
    return session.cleanup
  }

  private armWatchdog() {
    if (this.timer === undefined) {
      this.timer = window.setInterval(() => this.run(), 5000)
    }
  }

  private setFailedState() {
    this.userStatus.state = StreamState.Failed
    this.connStatus = StreamState.Failed
    this.sync()
  }

  start(force = false): Promise<void> {
    if (!force && this.wantsRunning && (this.session || this.startOperation)) {
      return this.startOperation?.promise || Promise.resolve()
    }
    this.wantsRunning = true
    const generation = ++this.generation
    const previous = this.session
    this.session = undefined
    this.mutedTicks = 0
    this.clearStream()
    const cleanup = previous ? this.cleanupSession(previous) : Promise.resolve()

    const operation = (async () => {
      try {
        await cleanup
        if (!this.isRunningGeneration(generation)) return
        log('info', 'whep_start', '', { id: this.id })
        const session = this.createSession(generation)
        this.session = session
        this.userStatus.state = StreamState.Signaled
        this.connStatus = StreamState.Signaled
        this.sync()
        try {
          session.view = session.client.view(
            session.pc,
            `${location.origin}/whep/${this.id}`,
            token
          )
          await session.view
        } catch (e) {
          if (
            this.session === session &&
            this.isRunningGeneration(generation)
          ) {
            log('error', 'whep_view_failed', String(e), { id: this.id })
            this.setFailedState()
          }
        }
        if (this.session !== session || !this.isRunningGeneration(generation)) {
          await this.cleanupSession(session)
          return
        }
        this.armWatchdog()
      } catch (e) {
        if (this.isRunningGeneration(generation)) {
          log('error', 'whep_start_failed', String(e), { id: this.id })
          this.setFailedState()
          this.armWatchdog()
        }
      } finally {
        if (this.startOperation?.generation === generation)
          this.startOperation = undefined
      }
    })()
    this.startOperation = { generation, promise: operation }
    return operation
  }

  async stop() {
    this.wantsRunning = false
    this.generation++
    this.mutedTicks = 0
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    const session = this.session
    this.session = undefined
    this.startOperation = undefined
    this.clearStream()
    this.userStatus.state = StreamState.Closed
    this.connStatus = StreamState.Closed
    this.sync()
    if (session) await this.cleanupSession(session)
  }

  restart(): Promise<void> {
    return this.start(true)
  }

  run() {
    if (!this.wantsRunning || this.startOperation) return
    const restartStates = [
      StreamState.Disconnected,
      StreamState.Closed,
      StreamState.Failed,
    ]
    if (
      restartStates.includes(this.userStatus.state) &&
      this.remoteStatus.state === StreamState.Connected
    ) {
      log('warn', 'whep_watchdog_restart', this.userStatus.state, {
        id: this.id,
      })
      void this.restart()
      return
    }

    if (this.userStatus.state !== StreamState.Connected) {
      this.mutedTicks = 0
      return
    }
    const expectsVideo =
      this.remoteStatus.state === StreamState.Connected &&
      this.remoteStatus.video
    const videoMuted = this.stream.getVideoTracks().some(track => track.muted)
    const noVideoTrack = this.stream.getVideoTracks().length === 0
    if (expectsVideo && (videoMuted || noVideoTrack)) {
      this.mutedTicks++
      if (this.mutedTicks >= 2) {
        log('warn', 'whep_watchdog_muted_restart', this.userStatus.state, {
          id: this.id,
        })
        this.mutedTicks = 0
        void this.restart()
      }
    } else {
      this.mutedTicks = 0
    }
  }
}

interface ContextEntry {
  context: WHEPContext
  references: number
}

const contexts: ContextEntry[] = []

export default function useWhepClient(id: string): ShallowRef<WHEPData> {
  let entry = contexts.find(item => item.context.id === id)
  if (!entry) {
    entry = { context: new WHEPContext(id), references: 0 }
    contexts.push(entry)
  }
  entry.references++
  const context = entry.context
  const data = shallowRef(context.export())
  const update = () => {
    data.value = context.export()
  }
  context.addEventListener(event.type, update)
  onScopeDispose(() => {
    context.removeEventListener(event.type, update)
    entry.references--
    if (entry.references === 0) {
      void context.stop()
      const index = contexts.indexOf(entry)
      if (index >= 0) contexts.splice(index, 1)
    }
  })
  return data
}
