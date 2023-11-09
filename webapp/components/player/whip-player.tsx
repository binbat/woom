import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamAtom,
  peerConnectionAtom,
} from '../../store/atom'
import Player from './player'
import WHIPClient from '../../lib/whip'

export default function WhipPlayer(props: { streamId: string }) {
  const refEnabled = useRef(false)
  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [connectionState, setConnectionState] = useState("unknown")
  const [peerConnection] = useAtom(peerConnectionAtom)

  const newPeerConnection = () => {
    const stream = localStream.stream
    if (stream) {
      const pc = peerConnection.current
      pc.onconnectionstatechange = () => setConnectionState(pc.connectionState)

      if (!stream.getAudioTracks().length) {
        pc.addTransceiver('audio', { 'direction': 'sendonly' })
      } else {
        stream.getAudioTracks().map(track => pc.addTrack(track))
      }

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

    }
  }

  const start = async (resource: string) => {
    const stream = localStream.stream
    if (stream) {
      const whip = new WHIPClient();
      const url = location.origin + `/whip/${resource}`
      const token = "xxx"
      await whip.publish(peerConnection.current, url, token);
    }
  }

  const restart = async (resource: string) => {
    if (peerConnection.current) {
      peerConnection.current.close()
      peerConnection.current = new RTCPeerConnection()
    }
    newPeerConnection()
    start(resource)
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      newPeerConnection()
      start(props.streamId)
    }
  }, [])

  return (
    <div className='flex flex-col'>
      <Player user={localStream} muted={true} />
      <center className='text-white flex flex-row justify-around'>
        <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{connectionState}</p>
        <button className='btn-primary' disabled={connectionState === 'connected'} onClick={() => restart(props.streamId)}>restart</button>
      </center>
    </div>
  )
}
