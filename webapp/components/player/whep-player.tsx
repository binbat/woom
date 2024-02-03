import { useEffect, useRef } from 'react'
import useWhepClient from "../use/whep"
import { useAtom } from 'jotai'
import Detail from './detail'
import Player from './player'
import { presentationStreamAtom } from '../../store/atom'
import { Stream } from '../../lib/api'

export default function WhepPlayer(props: { streamId: string, userStatus: Stream, width: string }) {
  const refEnabled = useRef(false)
  const { stream, restart, start, setRemoteStatus } = useWhepClient(props.streamId)
  const [, setPresentationStream] = useAtom(presentationStreamAtom)

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
  }, [])

  useEffect(() => {
    setRemoteStatus(props.userStatus)
  }, [props.userStatus])

  useEffect(() => {
    setPresentationStream({
      name: props.userStatus.name + "Presentation",
      stream: props.userStatus.screen ? stream : new MediaStream(),
    })
  }, [props.userStatus.screen])

  return (
    <center className='flex flex-col'>
      <Player stream={stream} muted={false} width={props.width} audio={false} video={props.userStatus.video} />
      <Detail streamId={props.streamId} userStatus={props.userStatus} restart={restart} />
    </center>
  )
}
