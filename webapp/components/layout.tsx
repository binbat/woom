import useSWR from 'swr'
import { useAtom } from 'jotai'
import Member from './member'
import WhipPlayer from './player/whip-player'
import WhepPlayer from './player/whep-player'
import DeviceBar from './device'
import { localStreamIdAtom } from '../store/atom'

const fetcher = (args: any) => fetch(args).then(res => res.json())

export default function Layout(props: { meetingId: string }) {
  const { data, error, isLoading } = useSWR(`/room/${props.meetingId}`, fetcher)

  const [localStreamId] = useAtom(localStreamIdAtom)

  if (error) return <div>failed to load</div>
  if (isLoading) return <div>loading...</div>

  return (
    <div className='flex flex-col justify-around' style={{ height: '100vh' }}>

      <center className='text-white'>
        <label>meeting Id: </label><code>{props.meetingId}</code>
        <br />
        <label>Me Id: </label><code>{localStreamId}</code>
      </center>

      <div className='flex flex-row flex-wrap justify-evenly'>
        <WhipPlayer streamId={localStreamId} />
        {Object.keys(data).filter(i => i !== localStreamId).filter(i => !!i).map(stream => <WhepPlayer key={stream} streamId={stream} />)}
      </div>

      <center>
        <Member />
        <DeviceBar />
      </center>

    </div>
  )
}
