import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamAtom,
  presentationStreamAtom,

  localUserStatusAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../../store/atom'
import Player from './player'
import { WHIPClient } from '@binbat/whip-whep/whip'
import { deviceScreen } from '../../lib/device'
import SvgProgress from '../svg/progress'

export default function WhipPlayer(props: { streamId: string, width: string }) {
  const refEnabled = useRef(false)
  const refPC = useRef<RTCPeerConnection | null>(null)
  const refClient = useRef<WHIPClient | null>(null)
  const [localStream] = useAtom(localStreamAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)

  const [loading, setLoading] = useState(true)

  const [currentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const [presentationStream, setPresentationStream] = useAtom(presentationStreamAtom)

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
        await whip.publish(refPC.current, url)
        refClient.current = whip
      }
    }
    setLoading(false)
  }

  const restart = async (resource: string) => {
    setLoading(true)
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
    return () => {
      if (refEnabled.current && refClient.current) {
        refClient.current.stop()
        refClient.current = null
        refEnabled.current = false
      }
    }
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
    if (currentDeviceVideo === deviceScreen.deviceId) {
      setPresentationStream(localStream)
    } else {
      setPresentationStream({
        stream: new MediaStream,
        name: presentationStream.name
      })
    }

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
      <center>
        { loading
          ? <div className='m-xl'><SvgProgress/></div>
          : <Player user={localStream} muted={true} width={props.width} display="auto" />
        }
      </center>

      <details className='text-white mx-2 text-sm font-border' style={{
        position: 'absolute',
      }}>
        <summary className='text-center'>{localUserStatus.name}</summary>
        <center>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>name: <code>{localUserStatus.name}</code></p>
            <p>state: <code>{String(localUserStatus.state)}</code></p>
          </div>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>audio: <code>{String(localUserStatus.audio)}</code></p>
            <p>video: <code>{String(localUserStatus.video)}</code></p>
            <p>screen: <code>{String(localUserStatus.screen)}</code></p>
          </div>

          <code>{props.streamId}</code>
        </center>

        <center className='text-white flex flex-row justify-around'>
          <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{localUserStatus.state}</p>
          <button className='btn-primary' disabled={localUserStatus.state === 'connected'} onClick={() => restart(props.streamId)}>restart</button>
        </center>
      </details>
    </div>
  )
}
