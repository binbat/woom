import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { remoteStreamsAtom } from '../../store/atom'
import Player from './player'
import WHEPClient from '../../lib/whep'

import { UserStream, localStreamIdAtom } from '../../store/atom'

function newPeerConnection(): RTCPeerConnection {
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video', { 'direction': 'recvonly' })
  pc.addTransceiver('audio', { 'direction': 'recvonly' })
  return pc
}

export default function WhepPlayer(props: { stream: string }) {
  const refEnabled = useRef(false)
  //const currentPC = useRef<RTCPeerConnection>(newPeerConnection())
  //const [remoteStreams, setRemoteStreams] = useAtom(remoteStreamsAtom)
  const [userStream, setUserStream] = useState<UserStream>({
    stream: null,
    name: props.stream,
  })

  //const pc = currentPC.current

  const start = async () => {
    const resource = props.stream
    const pc = new RTCPeerConnection();
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = (event) => {
      if (event.track.kind == "video") {
        //setRemoteStreams([...remoteStreams, {
        //  name: props.stream,
        //  stream: event.streams[0]
        //}])
        console.log("on track")

        setUserStream({
          name: props.stream,
          stream: event.streams[0]
        })
      }
      if (event.track.kind == "audio") {
      }
    }
    const whep = new WHEPClient();
    const url = location.origin + "/whep/" + resource;
    const token = "xxx"
    whep.view(pc, url, token);
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
  }, [])

  return (
    <Player user={userStream} />
  )
}
