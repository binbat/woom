import { useSyncExternalStore } from 'react'
import { event, Context } from './whxp'
import { StreamState } from '../../lib/api'
import { WHEPClient } from '@binbat/whip-whep/whep'

class WHEPContext extends Context {
  client: WHEPClient = new WHEPClient()

  private newPeerConnection() {
    const { pc, setStream } = this
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = ev => setStream(ev.streams[0])
  }
  async start() {
    const { id, pc, client, userStatus } = this
    pc.onconnectionstatechange = () => {
      userStatus.state = pc.connectionState as StreamState
      this.sync()
      this.syncUserStatus(userStatus)
    }
    userStatus.state = StreamState.Signaled
    this.sync()
    this.syncUserStatus(userStatus)
    this.newPeerConnection()

    try {
      const url = location.origin + `/whep/${id}`
      await client.view(pc, url)
    } catch (e) {
      console.log(e)
      userStatus.state = StreamState.Failed
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
