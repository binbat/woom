import { useEffect, useRef, useState } from 'react'
import Player from './player'
import WHEPClient from '../../lib/whep'
import { UserStream } from '../../store/atom'

export default function WhepPlayer(props: { stream: string }) {
  const refEnabled = useRef(false)
  const refPC = useRef<RTCPeerConnection | null>(null)
  const [connectionState, setConnectionState] = useState("unknown")
  const [userStream, setUserStream] = useState<UserStream>({
    stream: null,
    name: props.stream,
  })

  const newPeerConnection = () => {
    const pc = new RTCPeerConnection()
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState)

    pc.ontrack = (event) => {
      if (event.track.kind == "video") {
        setUserStream({
          name: props.stream,
          stream: event.streams[0]
        })
      }
      if (event.track.kind == "audio") {
      }
    }
    refPC.current = pc
  }

  const start = async (resource: string) => {
    if (refPC.current) {
      const whep = new WHEPClient();
      const url = location.origin + "/whep/" + resource;
      const token = "xxx"
      await whep.view(refPC.current, url, token);
      //await whep.stop()
    }
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      newPeerConnection()
      start(props.stream)
    }
  }, [])

  return (
    <div className='flex flex-col'>
      <Player user={userStream} muted={false} />
      <center className='text-white flex flex-row justify-around'>
        <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{connectionState}</p>
        <button className='btn-primary' onClick={() => start(props.stream)}>restart</button>
      </center>
    </div>
  )
}
