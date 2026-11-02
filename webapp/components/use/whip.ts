import { onScopeDispose, type ShallowRef, shallowRef } from 'vue'
import { WHIPClient } from 'whip-whep/whip'
import { type Stream, StreamState, token } from '../../lib/api'
import {
  asyncGetAudioStream,
  asyncGetVideoStream,
  deviceNone,
  deviceScreen,
  deviceSegmenter,
} from '../../lib/device'
import { log } from '../../lib/log'
import { VirtualBackgroundStream } from './imageSegmentation'
import { Context, type Data, event } from './whxp'

interface WHIPData extends Data {
  setUserName: (name: string) => void
  setSyncUserStatus: (callback: (userStatus: Stream) => void) => void

  currentDeviceAudio: string
  currentDeviceVideo: string
  virtualBackgroundEnabled: boolean
  setCurrentDeviceAudio: (current: string) => Promise<void>
  setCurrentDeviceVideo: (
    current: string,
    constraints?: MediaTrackConstraints
  ) => Promise<void>
  toggleEnableAudio: () => Promise<void>
  toggleEnableVideo: () => Promise<void>
  stopScreenSharing: () => Promise<void>
  revokeScreenSharing: () => Promise<void>

  toggleEnableVirtualBackground: () => Promise<void>
}

interface PublishSession {
  generation: number
  client: WHIPClient
  pc: RTCPeerConnection
  onStateChange: () => void
  publish?: Promise<void>
  cleanup?: Promise<void>
}

const stopTracks = (stream: MediaStream, kind?: 'audio' | 'video') => {
  const tracks =
    kind === 'audio'
      ? stream.getAudioTracks()
      : kind === 'video'
        ? stream.getVideoTracks()
        : stream.getTracks()
  tracks.forEach(track => {
    track.stop()
  })
}

class WHIPContext extends Context {
  cache: WHIPData

  currentDeviceAudio = deviceNone.deviceId
  currentDeviceVideo = deviceNone.deviceId
  currentVideoConstraints: MediaTrackConstraints | undefined = undefined
  virtualBackgroundEnabled = false
  segmentation: VirtualBackgroundStream | null = null

  private session: PublishSession | undefined
  private generation = 0
  private wantsRunning = false
  private startOperation:
    | { generation: number; promise: Promise<void> }
    | undefined
  private cancelTrackWait: (() => void) | undefined
  private audioGeneration = 0
  private videoGeneration = 0
  private pendingScreenGeneration: number | undefined

  toggleEnableAudio = async () =>
    this.setCurrentDeviceAudio(
      this.userStatus.audio ? deviceNone.deviceId : this.currentDeviceAudio
    )
  toggleEnableVideo = async () =>
    this.setCurrentDeviceVideo(
      this.userStatus.video ? deviceNone.deviceId : this.currentDeviceVideo
    )
  toggleEnableVirtualBackground = async () =>
    this.setCurrentDeviceVideo(
      this.virtualBackgroundEnabled
        ? this.currentDeviceVideo
        : deviceSegmenter.deviceId
    )
  stopScreenSharing = async () =>
    this.updateVideo(deviceNone.deviceId, undefined, true)
  revokeScreenSharing = async () => {
    const pending = this.pendingScreenGeneration
    if (pending !== undefined) {
      this.pendingScreenGeneration = undefined
      if (pending === this.videoGeneration) this.videoGeneration++
    }
    if (this.userStatus.screen) await this.stopScreenSharing()
  }

  constructor(id: string) {
    super(id)
    this.cache = this.clone()
  }

  syncUserStatus = (_: Stream) => {}
  setSyncUserStatus = (callback: (userStatus: Stream) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  setUserName = (name: string) => {
    this.userStatus.name = name
    this.sync()
    this.syncUserStatus(this.userStatus)
  }

  clone(): WHIPData {
    return {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart: () => this.restart(),

      setUserName: (name: string) => this.setUserName(name),
      setSyncUserStatus: (callback: (userStatus: Stream) => void) =>
        this.setSyncUserStatus(callback),

      currentDeviceAudio: this.currentDeviceAudio,
      currentDeviceVideo: this.currentDeviceVideo,
      virtualBackgroundEnabled: this.virtualBackgroundEnabled,
      setCurrentDeviceAudio: (current: string) =>
        this.setCurrentDeviceAudio(current),
      setCurrentDeviceVideo: (
        current: string,
        constraints?: MediaTrackConstraints
      ) => this.setCurrentDeviceVideo(current, constraints),
      toggleEnableAudio: () => this.toggleEnableAudio(),
      toggleEnableVideo: () => this.toggleEnableVideo(),
      stopScreenSharing: () => this.stopScreenSharing(),
      revokeScreenSharing: () => this.revokeScreenSharing(),

      toggleEnableVirtualBackground: () => this.toggleEnableVirtualBackground(),
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

  private addPublishTracks(pc: RTCPeerConnection) {
    const audioTracks = this.stream.getAudioTracks()
    const videoTracks = this.stream.getVideoTracks()
    if (audioTracks.length) {
      audioTracks.forEach(track => {
        pc.addTrack(track)
      })
    } else {
      pc.addTransceiver('audio', { direction: 'sendonly' })
    }
    if (videoTracks.length) {
      videoTracks.forEach(track => {
        pc.addTrack(track)
      })
    } else {
      pc.addTransceiver('video', { direction: 'sendonly' })
    }
  }

  private createSession(generation: number): PublishSession {
    const pc = new RTCPeerConnection()
    const session: PublishSession = {
      generation,
      client: new WHIPClient(),
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
      if (
        this.userStatus.state === StreamState.Failed ||
        this.userStatus.state === StreamState.Disconnected
      ) {
        log('warn', 'whip_state', pc.connectionState, { id: this.id })
      }
      this.sync()
      this.syncUserStatus(this.userStatus)
    }
    pc.addEventListener('connectionstatechange', session.onStateChange)
    this.addPublishTracks(pc)
    return session
  }

  private cleanupSession(session: PublishSession): Promise<void> {
    if (session.cleanup) return session.cleanup
    session.cleanup = (async () => {
      const { client, pc } = session
      pc.removeEventListener('connectionstatechange', session.onStateChange)
      pc.onconnectionstatechange = null
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
      try {
        if (session.publish) await session.publish.catch(() => {})
        await client.stop()
      } catch {
        // Signaling can fail before an upstream resource exists.
      } finally {
        pc.close()
      }
    })()
    return session.cleanup
  }

  private async replaceTrack(
    kind: 'audio' | 'video',
    track: MediaStreamTrack | null
  ) {
    const session = this.session
    if (!session || !this.isRunningGeneration(session.generation)) return
    const transceiver = session.pc
      .getTransceivers()
      .find(item => item.receiver.track.kind === kind)
    if (transceiver) await transceiver.sender.replaceTrack(track)
  }

  async setCurrentDeviceAudio(current: string) {
    const generation = ++this.audioGeneration
    if (current === this.currentDeviceAudio && this.userStatus.audio) return

    const mediaStream = await asyncGetAudioStream(current)
    if (generation !== this.audioGeneration) {
      stopTracks(mediaStream)
      return
    }

    const currentStream = this.stream
    const audioTracks = mediaStream.getAudioTracks()
    this.stream = new MediaStream([
      ...audioTracks,
      ...currentStream.getVideoTracks(),
    ])
    stopTracks(currentStream, 'audio')
    this.userStatus.audio = current !== deviceNone.deviceId
    if (current !== deviceNone.deviceId) this.currentDeviceAudio = current
    this.sync()
    this.syncUserStatus(this.userStatus)
    await this.replaceTrack('audio', audioTracks[0] || null)
    if (generation !== this.audioGeneration) return
  }

  private async updateVideo(
    current: string,
    constraints?: MediaTrackConstraints,
    force = false
  ) {
    const generation = ++this.videoGeneration
    this.pendingScreenGeneration =
      current === deviceScreen.deviceId ? generation : undefined
    if (
      !force &&
      current === this.currentDeviceVideo &&
      this.currentVideoConstraints === constraints &&
      this.userStatus.video &&
      !this.virtualBackgroundEnabled
    )
      return

    const previousSegmentation = this.segmentation
    let mediaStream: MediaStream
    let segmentation: VirtualBackgroundStream | null = null
    try {
      if (current === deviceSegmenter.deviceId) {
        if (this.currentDeviceVideo === deviceNone.deviceId) {
          throw new Error('No camera available for virtual background')
        }
        segmentation = new VirtualBackgroundStream(this.currentDeviceVideo)
        mediaStream = await segmentation.startStream()
      } else {
        mediaStream = await asyncGetVideoStream(current, constraints)
      }
    } catch (e) {
      if (this.pendingScreenGeneration === generation)
        this.pendingScreenGeneration = undefined
      segmentation?.destroyStream()
      throw e
    }

    if (this.pendingScreenGeneration === generation)
      this.pendingScreenGeneration = undefined
    if (generation !== this.videoGeneration) {
      stopTracks(mediaStream)
      segmentation?.destroyStream()
      return
    }
    const videoTracks = mediaStream.getVideoTracks()
    if (current !== deviceNone.deviceId && videoTracks.length === 0) {
      stopTracks(mediaStream)
      segmentation?.destroyStream()
      throw new Error('No video track available')
    }

    const currentStream = this.stream
    currentStream.getVideoTracks().forEach(track => {
      track.onended = null
    })
    this.stream = new MediaStream([
      ...currentStream.getAudioTracks(),
      ...videoTracks,
    ])
    if (current === deviceScreen.deviceId) {
      videoTracks.forEach(track => {
        track.onended = () => {
          if (
            this.userStatus.screen &&
            this.stream.getVideoTracks().includes(track)
          ) {
            void this.stopScreenSharing()
          }
        }
      })
    }

    stopTracks(currentStream, 'video')
    if (previousSegmentation !== segmentation)
      previousSegmentation?.destroyStream()
    this.segmentation = segmentation
    this.virtualBackgroundEnabled = current === deviceSegmenter.deviceId
    this.userStatus.video = current !== deviceNone.deviceId
    this.userStatus.screen = current === deviceScreen.deviceId
    if (
      ![
        deviceNone.deviceId,
        deviceSegmenter.deviceId,
        deviceScreen.deviceId,
      ].includes(current)
    ) {
      this.currentDeviceVideo = current
    }
    this.currentVideoConstraints = constraints
    this.sync()
    this.syncUserStatus(this.userStatus)
    await this.replaceTrack('video', videoTracks[0] || null)
    if (generation !== this.videoGeneration) return
  }

  async setCurrentDeviceVideo(
    current: string,
    constraints?: MediaTrackConstraints
  ) {
    await this.updateVideo(current, constraints)
  }

  private waitForTracks(generation: number): Promise<boolean> {
    if (this.stream.getTracks().length) return Promise.resolve(true)
    return new Promise(resolve => {
      let settled = false
      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.removeEventListener(event.type, onSync)
        if (this.cancelTrackWait === cancel) this.cancelTrackWait = undefined
        resolve(result)
      }
      const onSync = () => {
        if (this.stream.getTracks().length) finish(true)
      }
      const cancel = () => finish(false)
      const timer = setTimeout(() => finish(false), 10000)
      this.cancelTrackWait = cancel
      this.addEventListener(event.type, onSync)
      if (!this.isRunningGeneration(generation)) finish(false)
      else onSync()
    })
  }

  private armWatchdog() {
    if (this.timer === undefined) {
      this.timer = window.setInterval(() => this.run(), 5000)
    }
  }

  private setFailedState() {
    this.userStatus.state = StreamState.Failed
    this.syncUserStatus(this.userStatus)
    this.sync()
  }

  start(force = false): Promise<void> {
    if (!force && this.wantsRunning && (this.session || this.startOperation)) {
      return this.startOperation?.promise || Promise.resolve()
    }
    this.wantsRunning = true
    const generation = ++this.generation
    this.cancelTrackWait?.()
    const previous = this.session
    this.session = undefined
    const cleanup = previous ? this.cleanupSession(previous) : Promise.resolve()

    const operation = (async () => {
      try {
        await cleanup
        if (!this.isRunningGeneration(generation)) return
        if (this.stream.getTracks().length === 0) {
          log('info', 'whip_start_wait_tracks', '', { id: this.id })
          const gotTracks = await this.waitForTracks(generation)
          if (!this.isRunningGeneration(generation)) return
          if (!gotTracks) {
            log(
              'warn',
              'whip_start_no_tracks',
              'timed out waiting for media tracks',
              { id: this.id }
            )
            this.setFailedState()
            this.armWatchdog()
            return
          }
        }
        if (!this.isRunningGeneration(generation)) return

        log('info', 'whip_start', '', { id: this.id })
        const session = this.createSession(generation)
        this.session = session
        this.userStatus.state = StreamState.Signaled
        this.sync()
        this.syncUserStatus(this.userStatus)
        try {
          session.publish = session.client.publish(
            session.pc,
            `${location.origin}/whip/${this.id}`,
            token
          )
          await session.publish
        } catch (e) {
          if (
            this.session === session &&
            this.isRunningGeneration(generation)
          ) {
            log('error', 'whip_publish_failed', String(e), { id: this.id })
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
          log('error', 'whip_start_failed', String(e), { id: this.id })
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
    this.cancelTrackWait?.()
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    const session = this.session
    this.session = undefined
    this.startOperation = undefined
    this.userStatus.state = StreamState.Closed
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
    if (restartStates.includes(this.userStatus.state)) {
      log('warn', 'whip_watchdog_restart', this.userStatus.state, {
        id: this.id,
      })
      void this.restart()
    }
  }
}

const contexts: WHIPContext[] = []

export default function useWhipClient(id: string): ShallowRef<WHIPData> {
  const newContext = (id: string) => {
    const context = new WHIPContext(id)
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
