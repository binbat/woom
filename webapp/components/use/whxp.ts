import { UserStatus } from '../../store/atom'

const event = new Event('sync')

interface Data {
  id: string,
  stream: MediaStream,
  userStatus: UserStatus,

  stop: () => void,
  start: () => void,
  restart: () => void,
}

class Context extends EventTarget {
  id: string = ""
  pc: RTCPeerConnection = new RTCPeerConnection()
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

  cache: Data

  constructor(id: string) {
    super()
    this.id = id
    this.cache = this.clone()
  }

  clone() {
    return {
      id: this.id,
      stream: this.stream,
      userStatus: this.userStatus,
      stop: () => this.stop(),
      start: () => this.start(),
      restart:  () => this.restart(),
    }
  }

  export = () => this.cache
  syncUserStatus = (_: UserStatus) => {}
  setSyncUserStatus = (callback: (userStatus: UserStatus) => void) => {
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
