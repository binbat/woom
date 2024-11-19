import { useSyncExternalStore } from 'react'
import { event, Context, Data } from './whxp'
import { Stream, StreamState } from '../../lib/api'
import { WHIPClient } from 'whip-whep/whip'
import {
  deviceNone,
  deviceScreen,
  asyncGetAudioStream,
  asyncGetVideoStream,
} from '../../lib/device'

interface WHIPData extends Data {
  setUserName: (name: string) => void,
  setSyncUserStatus: (callback: (userStatus: Stream) => void) => void,

  currentDeviceSpeaker: string,
  currentDeviceAudio: string,
  currentDeviceVideo: string,
  setCurrentDeviceSpeaker: (current: string) => Promise<void>,
  setCurrentDeviceAudio: (current: string) => Promise<void>,
  setCurrentDeviceVideo: (current: string) => Promise<void>,
  toggleEnableSpeaker: () => Promise<void>,
  toggleEnableAudio: () => Promise<void>,
  toggleEnableVideo: () => Promise<void>,
}

class WHIPContext extends Context {
  private audioElement: HTMLAudioElement
  client: WHIPClient = new WHIPClient()
  cache: WHIPData

  currentDeviceSpeaker = deviceNone.deviceId
  currentDeviceAudio = deviceNone.deviceId
  currentDeviceVideo = deviceNone.deviceId
  toggleEnableSpeaker = async () => this.setCurrentDeviceSpeaker(this.userStatus.speaker ? deviceNone.deviceId : this.currentDeviceSpeaker)
  toggleEnableAudio = async () => this.setCurrentDeviceAudio(this.userStatus.audio ? deviceNone.deviceId : this.currentDeviceAudio)
  toggleEnableVideo = async () => this.setCurrentDeviceVideo(this.userStatus.video ? deviceNone.deviceId : this.currentDeviceVideo)

  constructor(id: string) {
    super(id)
    this.audioElement = document.createElement("audio")
    this.cache = this.clone()
  }

  syncUserStatus = (_: Stream) => {}
  setSyncUserStatus = (callback: (userStatus: Stream) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  setUserName = (name: string) => {
    this.userStatus.name = name
    this.sync()
    this.syncUserStatus(this.userStatus)
  }

  clone() {
    return {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart: () => this.restart(),

      setUserName: (name: string) => this.setUserName(name),
      setSyncUserStatus: (callback: (userStatus: Stream) => void) => this.setSyncUserStatus(callback),

      currentDeviceSpeaker: this.currentDeviceSpeaker,
      currentDeviceAudio: this.currentDeviceAudio,
      currentDeviceVideo: this.currentDeviceVideo,
      setCurrentDeviceSpeaker: (current: string) => this.setCurrentDeviceSpeaker(current),
      setCurrentDeviceAudio: (current: string) => this.setCurrentDeviceAudio(current),
      setCurrentDeviceVideo: (current: string) => this.setCurrentDeviceVideo(current),
      toggleEnableSpeaker: () => this.toggleEnableSpeaker(),
      toggleEnableAudio: () => this.toggleEnableAudio(),
      toggleEnableVideo: () => this.toggleEnableVideo(),
    }
  }

  export = () => this.cache

  sync() {
    this.cache = this.clone()
    this.dispatchEvent(event)
  }

  private newPeerConnection() {
    const { pc, stream } = this

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

  async setCurrentDeviceSpeaker(current: string) {
    const { userStatus, currentDeviceSpeaker } = this;

      // 检查是否需要切换设备
      if (current !== currentDeviceSpeaker || !userStatus.speaker) {
        if (!this.audioElement) {
          // 使用全局或共享的 audioElement
          this.audioElement = document.createElement("audio");
          document.body.appendChild(this.audioElement);
        }
  
    // 设置新的扬声器设备
      if (this.audioElement.setSinkId) {
        try {
          await this.audioElement.setSinkId(current);
          console.log(`扬声器切换到设备: ${current}`);
        } catch (error) {
          console.error("切换音频输出设备失败:", error);
        }
      } else {
        console.error("当前浏览器不支持 setSinkId");
      }
  
        // 更新状态
        userStatus.speaker = current === deviceNone.deviceId ? false : true
        this.currentDeviceSpeaker = current === deviceNone.deviceId ? this.currentDeviceSpeaker : current
  
        // 同步状态并触发相关回调
        this.sync();
        this.syncUserStatus(userStatus);
      }
  }

  onChangedDeviceAudio() {
    const { pc, stream } = this
    // If WebRTC is connected, switch track
    // NOTE: array audio index is: 0
    pc.getSenders().filter((_, i) => i === 0).map(sender => {
      if (stream) {
        stream.getAudioTracks().map(track => sender.replaceTrack(track))
      }
    })
  }

  async setCurrentDeviceAudio(current: string) {
    const { stream, setStream, userStatus, currentDeviceAudio } = this

    if (current !== currentDeviceAudio || !userStatus.audio) {
      // Closed old tracks
      stream.getAudioTracks().map(track => {
        track.stop()
        stream.removeTrack(track)
      })

      const mediaStream = await asyncGetAudioStream(current)

      const videoTracks = stream.getVideoTracks()
      const audioTracks = mediaStream.getAudioTracks()

      setStream(new MediaStream([...audioTracks, ...videoTracks]))
      userStatus.audio = current === deviceNone.deviceId ? false : true
      this.currentDeviceAudio = current === deviceNone.deviceId ? this.currentDeviceAudio : current

      this.sync()
      this.syncUserStatus(userStatus)
      this.onChangedDeviceAudio()
    }
  }

  onChangedDeviceVideo() {
    const { pc, stream } = this
    // If WebRTC is connected, switch track
    // NOTE: array video index is: 1
    pc.getSenders().filter((_, i) => i === 1).map(sender => {
      if (stream) {
        stream.getVideoTracks().map(track => sender.replaceTrack(track))
      }
    })
  }

  async setCurrentDeviceVideo(current: string) {
    const { stream, setStream, userStatus, currentDeviceVideo } = this

    if (current !== currentDeviceVideo || !userStatus.video) {
      // Closed old tracks
      stream.getVideoTracks().map(track => {
        track.stop()
        stream.removeTrack(track)
      })

      const mediaStream = await asyncGetVideoStream(current)
      const audioTracks = stream.getAudioTracks()
      const videoTracks = mediaStream.getVideoTracks()

      setStream(new MediaStream([...audioTracks, ...videoTracks]))
      userStatus.video = current === deviceNone.deviceId ? false : true
      // NOTE: screen share
      userStatus.screen = current !== deviceScreen.deviceId ? false : true
      this.currentDeviceVideo = current === deviceNone.deviceId ? this.currentDeviceVideo : current

      this.sync()
      this.syncUserStatus(userStatus)
      this.onChangedDeviceVideo()
    }
  }

  onconnectionstatechange = () => {
    this.userStatus.state = this.pc.connectionState as StreamState
    this.sync()
    this.syncUserStatus(this.userStatus)
  }

  async start() {
    const { id, pc, stream, client, userStatus } = this
    if (stream.getTracks().length === 0) return
    pc.addEventListener('connectionstatechange', this.onconnectionstatechange)
    userStatus.state = StreamState.Signaled
    this.sync()
    this.syncUserStatus(userStatus)
    this.newPeerConnection()

    try {
      const url = location.origin + `/whip/${id}`
      await client.publish(pc, url)
    } catch (e) {
      console.log(e)
      userStatus.state = StreamState.Failed
      this.syncUserStatus(userStatus)
      this.sync()
    }

    if (!this.timer) this.timer = setInterval(() => this.run(), 5000)
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
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
    this.pc = new RTCPeerConnection()
    await this.start()
  }

  run() {
    // WatchDog, Auto Restart
    const restartStates = [StreamState.Disconnected, StreamState.Closed, StreamState.Failed]
    if (restartStates.find(i => i === this.userStatus.state)) this.restart()
  }
}

const contexts: WHIPContext[] = []

export default function useWhipClient(id: string) {
  const newContext = (id: string) => {
    const context = new WHIPContext(id)
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
