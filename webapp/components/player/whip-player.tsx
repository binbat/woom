import useWhipClient from "../use/whip"
import Detail from './detail'
import Player from './player'

export default function WhipPlayer(props: { streamId: string, width: string }) {
  const { stream, userStatus, restart } = useWhipClient(props.streamId)
  return (
    <center className='flex flex-col'>
      <Player stream={stream} muted={true} width={props.width} display="auto" />
      <Detail streamId={props.streamId} userStatus={userStatus} restart={restart} />
    </center>
  )
}
