import { useEffect } from 'react'
import useWhipClient from '../use/whip'
import { useAtom } from 'jotai'
import Detail from './detail'
import Player from './player'
import { presentationStreamAtom } from '../../store/atom'

export default function WhipPlayer(props: { streamId: string, width: string }) {
  const { stream, userStatus, restart } = useWhipClient(props.streamId)
  const [, setPresentationStream] = useAtom(presentationStreamAtom)

  useEffect(() => {
    setPresentationStream({
      name: userStatus.name + 'Presentation',
      stream: userStatus.screen ? stream : new MediaStream(),
    })
  }, [userStatus.screen])

  return (
    <center className="flex flex-col">
      <Player stream={stream} muted={true} width={props.width} audio={false} video={userStatus.video} />
      <Detail streamId={props.streamId} connStatus={userStatus.state} userStatus={userStatus} restart={restart} />
    </center>
  )
}
