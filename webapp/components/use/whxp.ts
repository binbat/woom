import { Stream, StreamState } from '../../lib/api'
import { deviceNone } from '../../lib/device'

const event = new Event('sync')

interface Data {
  id: string,
  stream: MediaStream,
  userStatus: Stream,

  stop: () => Promise<void>
  start: () => Promise<void>
  restart: () => Promise<void>

  setUserName: (name: string) => void,
  setSyncUserStatus: (callback: (userStatus: Stream) => void) => void,

  currentDeviceAudio: string,
  currentDeviceVideo: string,
  setCurrentDeviceAudio: (current: string) => Promise<void>,
  setCurrentDeviceVideo: (current: string) => Promise<void>,
  toggleEnableAudio: () => Promise<void>,
  toggleEnableVideo: () => Promise<void>,
}

class Context extends EventTarget {
  id: string = ""
  pc: RTCPeerConnection = new RTCPeerConnection()
  stream: MediaStream = new MediaStream()
  userStatus: Stream = {
    name: "",
    state: StreamState.New,
    audio: true,
    video: true,
    screen: false,
  }

  setStream = (stream: MediaStream) => {
    this.stream = stream
    this.sync()
  }

  cache: Data

  constructor(id: string) {
    super()
    this.id = id
    this.cache = this.clone()
  }

  setUserName: (name: string) => void = (_: string) => {}

  currentDeviceAudio = deviceNone.deviceId
  currentDeviceVideo = deviceNone.deviceId
  toggleEnableAudio = async () => this.setCurrentDeviceAudio(this.userStatus.audio ? deviceNone.deviceId : this.currentDeviceAudio)
  toggleEnableVideo = async () => this.setCurrentDeviceVideo(this.userStatus.video ? deviceNone.deviceId : this.currentDeviceVideo)

  async setCurrentDeviceAudio(_: string) {}
  async setCurrentDeviceVideo(_: string) {}
  clone() {
    return {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart:  () => this.restart(),

      setUserName: (name: string) => this.setUserName(name),
      setSyncUserStatus: (callback: (userStatus: Stream) => void) => this.setSyncUserStatus(callback),

      currentDeviceAudio: this.currentDeviceAudio,
      currentDeviceVideo: this.currentDeviceVideo,
      setCurrentDeviceAudio: (current: string) => this.setCurrentDeviceAudio(current),
      setCurrentDeviceVideo: (current: string) => this.setCurrentDeviceVideo(current),
      toggleEnableAudio: () => this.toggleEnableAudio(),
      toggleEnableVideo: () => this.toggleEnableVideo(),
    }
  }

  export = () => this.cache
  syncUserStatus = (_: Stream) => {}
  setSyncUserStatus = (callback: (userStatus: Stream) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  sync() {
    this.cache = this.clone()
    this.dispatchEvent(event)
  }

  async stop() {}
  async start() {}
  async restart() {
    await this.stop()
    this.pc = new RTCPeerConnection()
    await this.start()
    this.sync()
  }
}

export {
  Context,
  event,
}
