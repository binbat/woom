import { useEffect } from 'react'
import useWhipClient from '../use/whip'
import { useAtom } from 'jotai'
import Detail from './detail'
import Player from './player'
import { presentationStreamAtom } from '../../store/atom'

export default function WhipPlayer(props: { streamId: string, width: string }) {
  const { stream, userStatus, restart } = useWhipClient(props.streamId)
  // TODO: refactor "presentation stream" handling for more precise control
  const [presentationStream, setPresentationStream] = useAtom(presentationStreamAtom)

  useEffect(() => {
    // set/clear "presentation stream" when self starts/stops sharing
    const selfStreamName = `${userStatus.name}_Presentation`
    if (userStatus.screen && presentationStream.stream !== stream) {
      setPresentationStream({
        name: selfStreamName,
        stream: stream,
      })
    } else if (!userStatus.screen && presentationStream.name === selfStreamName) {
      setPresentationStream({
        name: '',
        stream: new MediaStream(),
      })
    }
  }, [userStatus.screen, stream])

  return (
    <center className="flex flex-col">
      <Player stream={stream} muted={true} width={props.width} audio={false} video={userStatus.video && !userStatus.screen} />
      <Detail streamId={props.streamId} connStatus={userStatus.state} userStatus={userStatus} restart={restart} />
    </center>
  )
}
