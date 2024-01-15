import { useEffect, useRef } from 'react'
import useWhepClient from "../use/whep"
import Detail from './detail'
import Player from './player'

export default function WhepPlayer(props: { streamId: string, width: string }) {
  const refEnabled = useRef(false)
  const { stream, userStatus, restart, start } = useWhepClient(props.streamId)

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
  }, [])

  return (
    <center className='flex flex-col'>
      <Player stream={stream} muted={false} width={props.width} display="auto" />
      <Detail streamId={props.streamId} userStatus={userStatus} restart={restart} />
    </center>
  )
}
