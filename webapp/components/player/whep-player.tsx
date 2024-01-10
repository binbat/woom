import { useEffect, useRef, useState } from 'react'
import Player from './player'
import {
  UserStream,
  UserStatus,
  presentationStreamAtom,
} from '../../store/atom'
import { WHEPClient } from '@binbat/whip-whep/whep'
import { useAtom } from 'jotai'
import SvgProgress from '../svg/progress'

export default function WhepPlayer(props: { streamId: string, status: UserStatus, width: string }) {
  const refEnabled = useRef(false)
  const refTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const refPC = useRef<RTCPeerConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectionState, setConnectionState] = useState("unknown")
  const [userStream, setUserStream] = useState<UserStream>({
    stream: new MediaStream,
    name: props.streamId,
  })
  const [presentationStream, setPresentationStream] = useAtom(presentationStreamAtom)
  const refUserStatus = useRef(props.status)
  refUserStatus.current = props.status

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

  const run = () => refUserStatus.current.state !== "connected" ? restart(props.streamId) : null

  const start = async (resource: string) => {
    setLoading(false)
    if (refPC.current) {
      const whep = new WHEPClient()
      const url = location.origin + "/whep/" + resource
      await whep.view(refPC.current, url)
      //await whep.stop()
    }
  }

  const restart = async (resource: string) => {
    setLoading(true)
    if (refPC.current) {
      refPC.current.close()
    }
    newPeerConnection()
    start(resource)
  }

  useEffect(() => {
    if (!refEnabled.current && props.status.state === "connected") {
      refEnabled.current = true
      refTimer.current = setInterval(run, 5000)
      newPeerConnection()
      start(props.streamId)
    }
  }, [props.status.state])

  useEffect(() => {
    if (props.status.state === "connected") {
      restart(props.streamId)
    }
  }, [props.status.state, props.status.audio, props.status.video])

  useEffect(() => {
    if (props.status.screen) {
      setPresentationStream(userStream)
    } else {
      setPresentationStream({
        stream: new MediaStream,
        name: presentationStream.name
      })
    }
  },  [props.status.screen])

  return (
    <div className='flex flex-col'>
      <center>
        { loading
          ? <div className='m-xl'><SvgProgress/></div>
          : <Player user={userStream} muted={false} width={props.width} display="auto" />
        }
      </center>

      <details className='text-white mx-2 text-sm font-border' style={{
        position: 'absolute',
      }}>
        <summary className='text-center'>{props.status.name}</summary>
        <center>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>name: <code>{props.status.name}</code></p>
            <p>state: <code>{String(props.status.state)}</code></p>
          </div>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>audio: <code>{String(props.status.audio)}</code></p>
            <p>video: <code>{String(props.status.video)}</code></p>
            <p>screen: <code>{String(props.status.screen)}</code></p>
          </div>

          <code>{props.streamId}</code>
        </center>

        <center className='text-white flex flex-row justify-around'>
          <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{connectionState}</p>
          <button className='btn-primary' onClick={() => restart(props.streamId)}>restart</button>
        </center>
      </details>
    </div>
  )
}
