import { useEffect, useRef } from 'react'
import useWhepClient from "../use/whep"
import { useAtom } from 'jotai'
import Detail from './detail'
import Player from './player'
import { presentationStreamAtom } from '../../store/atom'

export default function WhepPlayer(props: { streamId: string, width: string }) {
  const refEnabled = useRef(false)
  const { stream, userStatus, restart, start } = useWhepClient(props.streamId)
  const [, setPresentationStream] = useAtom(presentationStreamAtom)

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
  }, [])

  useEffect(() => {
    setPresentationStream({
      name: userStatus.name + "Presentation",
      stream: userStatus.screen ? stream : new MediaStream(),
    })
  }, [userStatus.screen])

  return (
    <center className='flex flex-col'>
      <Player stream={stream} muted={false} width={props.width} display="auto" />
      <Detail streamId={props.streamId} userStatus={userStatus} restart={restart} />
    </center>
  )
}
