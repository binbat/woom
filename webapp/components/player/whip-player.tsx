import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamAtom,
  localUserStatusAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../../store/atom'
import Player from './player'
import WHIPClient from '../../lib/whip'

export default function WhipPlayer(props: { streamId: string }) {
  const refEnabled = useRef(false)
  const refPC = useRef<RTCPeerConnection | null>(null)
  const refClient = useRef<WHIPClient | null>(null)
  const [localStream] = useAtom(localStreamAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)

  const [currentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const newPeerConnection = () => {
    const stream = localStream.stream
    if (stream) {
      const pc = new RTCPeerConnection()
      pc.onconnectionstatechange = () => setLocalUserStatus({
        ...localUserStatus,
        state: pc.connectionState
      })

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

      //pc.addTransceiver(stream.getVideoTracks()[0], {
      //  direction: 'sendonly',
      //  //sendEncodings: [
      //  //  { rid: 'a', scaleResolutionDownBy: 2.0 },
      //  //  { rid: 'b', scaleResolutionDownBy: 1.0, },
      //  //  { rid: 'c' }
      //  //]
      //})

      refPC.current = pc
    }
  }

  const start = async (resource: string) => {
    const stream = localStream.stream
    if (stream) {
      if (refPC.current) {
        const whip = new WHIPClient();
        const url = location.origin + `/whip/${resource}`
        const token = "xxx"
        await whip.publish(refPC.current, url, token)
        refClient.current = whip
      }
    }
  }

  const restart = async (resource: string) => {
    if (refPC.current) {
      refPC.current.close()
    }
    newPeerConnection()
    start(resource)
  }

  const init = () => {
    if (!!localStream.stream.getTracks().length) {
      if (!refEnabled.current) {
        refEnabled.current = true
        newPeerConnection()
        start(props.streamId)
      }
    } else {
      if (refEnabled.current) {
        // TODO: live777 need remove `If-Match`
        //refClient.current?.stop()
        //console.log("should closed whip")
      }
    }
  }
  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    const mediaStream = localStream.stream
    // If WebRTC is connected, switch track
    // NOTE: array audio index is: 0
    refPC.current?.getSenders().filter((_, i) => i === 0).map(sender => {
      if (mediaStream) {
        mediaStream.getAudioTracks().map(track => sender.replaceTrack(track))
      }
    })
    init()
  }, [currentDeviceAudio])

  useEffect(() => {
    const mediaStream = localStream.stream
    // If WebRTC is connected, switch track
    // NOTE: array video index is: 1
    refPC.current?.getSenders().filter((_, i) => i === 1).map(sender => {
      if (mediaStream) {
        mediaStream.getVideoTracks().map(track => sender.replaceTrack(track))
      }
    })
    init()
  }, [currentDeviceVideo])

  return (
    <div className='flex flex-col'>
      <Player user={localStream} muted={true} />

      <center className='text-white my-sm'>
        <p>name: <code>{localUserStatus.name}</code></p>
        <p>state: <code>{String(localUserStatus.state)}</code></p>
        <div className='flex flex-row justify-around'>
          <p>audio: <code>{String(localUserStatus.audio)}</code></p>
          <p>video: <code>{String(localUserStatus.video)}</code></p>
          <p>screen: <code>{String(localUserStatus.screen)}</code></p>
        </div>
      </center>

      <center className='text-white flex flex-row justify-around'>
        <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{localUserStatus.state}</p>
        <button className='btn-primary' disabled={localUserStatus.state === 'connected'} onClick={() => restart(props.streamId)}>restart</button>
      </center>
    </div>
  )
}
