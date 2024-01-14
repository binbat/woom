import useWhipClient from "../use/whip"
import Player from './player'

export default function WhipPlayer(props: { streamId: string, width: string }) {
  const { stream, userStatus, restart } = useWhipClient(props.streamId)
  return (
    <div className='flex flex-col'>
      <center>
        <Player stream={stream} muted={true} width={props.width} display="auto" />
      </center>

      <details className='text-white mx-2 text-sm font-border' style={{
        position: 'absolute',
      }}>
        <summary className='text-center'>{userStatus.name}</summary>
        <center>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>name: <code>{userStatus.name}</code></p>
            <p>state: <code>{String(userStatus.state)}</code></p>
          </div>
          <div className='flex flex-row flex-wrap justify-around'>
            <p>audio: <code>{String(userStatus.audio)}</code></p>
            <p>video: <code>{String(userStatus.video)}</code></p>
            <p>screen: <code>{String(userStatus.screen)}</code></p>
          </div>

          <code>{props.streamId}</code>
        </center>

        <center className='text-white flex flex-row justify-around'>
          <p className='rounded-xl p-2 b-1 hover:border-orange-300'>{userStatus.state}</p>
          <button className='btn-primary' onClick={() => restart()}>restart</button>
        </center>
      </details>
    </div>
  )
}
