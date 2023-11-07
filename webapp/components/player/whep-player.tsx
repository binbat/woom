import { useEffect, useRef, useState } from 'react'
import Player from './player'
import { UserStream } from '../../store/atom'
import WHEPClient from '../../lib/whep'

export default function WhepPlayer(props: { streamId: string }) {
  const refEnabled = useRef(false)
  const refPC = useRef<RTCPeerConnection | null>(null)
  const [connectionState, setConnectionState] = useState("unknown")
  const [userStream, setUserStream] = useState<UserStream>({
    stream: null,
    name: props.streamId,
  })

  const newPeerConnection = () => {
    const pc = new RTCPeerConnection()
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState)

    pc.ontrack = ev => {
      setUserStream({
        name: props.streamId,
        stream: ev.streams[0],
      })
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

  const restart = async (resource: string) => {
    if (refPC.current) {
      refPC.current.close()
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
      <Player user={userStream} muted={false} />
      <center className='text-white flex flex-row justify-around'>
        <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{connectionState}</p>
        <button className='btn-primary' onClick={() => restart(props.streamId)}>restart</button>
      </center>
    </div>
  )
}
