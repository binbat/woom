import { useSyncExternalStore } from 'react'
import { event, Context } from './whxp'
import { WHIPClient } from '@binbat/whip-whep/whip'
import { UserStatus } from '../../store/atom'
import {
  deviceNone,
  deviceScreen,
  asyncGetAudioStream,
  asyncGetVideoStream,
} from '../../lib/device'

class WHIPContext extends Context {
  client: WHIPClient = new WHIPClient()

  syncUserStatus = (_: UserStatus) => {}
  setSyncUserStatus = (callback: (userStatus: UserStatus) => void) => {
    callback(this.userStatus)
    this.syncUserStatus = callback
  }

  setUserName = (name: string) => {
    this.userStatus.name = name
    this.sync()
    this.syncUserStatus(this.userStatus)
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

  async start() {
    const { id, pc, stream, client, userStatus } = this
    if (stream.getTracks().length === 0) return
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
      const url = location.origin + `/whip/${id}`
      await client.publish(pc, url)
    } catch (e) {
      console.log(e)
      userStatus.state = 'failed'
      this.syncUserStatus(userStatus)
      this.sync()
    }
  }

  async stop() {
    await this.client.stop()
  }

  async restart() {
    this.pc = new RTCPeerConnection()
    await this.start()
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
