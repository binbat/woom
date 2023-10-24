import { useAtom } from 'jotai'
import { localStreamAtom, remoteStreamsAtom } from '../store/atom'
import Player from './player'

export default function App() {
  const [localStream] = useAtom(localStreamAtom)
  const [remoteStreams] = useAtom(remoteStreamsAtom)

  return (
    <div className='flex flex-wrap justify-evenly'>
      <Player user={localStream} />
      {remoteStreams.map(user => <Player key={user.name} user={user} />)}
    </div>
  )
}