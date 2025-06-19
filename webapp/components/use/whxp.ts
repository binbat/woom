import { Stream, StreamState } from '../../lib/api'

const event = new Event('sync')

interface Data {
  id: string,
  stream: MediaStream,
  userStatus: Stream,

  stop: () => Promise<void>
  start: () => Promise<void>
  restart: () => Promise<void>
}

class Context extends EventTarget {
  id: string = ''
  pc: RTCPeerConnection = new RTCPeerConnection()
  stream: MediaStream = new MediaStream()
  userStatus: Stream = {
    name: '',
    state: StreamState.New,
    audio: false,
    video: false,
    screen: false,
  }

  timer?: number

  constructor(id: string) {
    super()
    this.id = id
  }

  async stop() {}
  async start() {}
  async restart() {
    await this.stop()
    this.pc = new RTCPeerConnection()
    await this.start()
  }
}

export {
  Context,
  event,
}

export type {
  Data,
}
