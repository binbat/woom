import useSWR from 'swr'
import { useAtom } from 'jotai'
import Member from '../components/member'
import User from '../components/user'
import Card from '../components/card'
import Bar from '../components/bar'
import { localStreamIdAtom } from '../store/atom'

const fetcher = (args: any) => fetch(args).then(res => res.json())

export default function App(props: { meetingId: string }) {
  const { data, error, isLoading } = useSWR(`/room/${props.meetingId}`, fetcher)
  const [me] = useAtom(localStreamIdAtom)

  if (error) return <div>failed to load</div>
  if (isLoading) return <div>loading...</div>

  return (
    <div className='flex flex-col justify-around' style={{ height: '100vh' }}>

      <center className='text-white'>
        <label>meeting Id: </label><code>{props.meetingId}</code>
        <br />
        <label>Me Id: </label><code>{me}</code>
      </center>

      <div className='flex justify-evenly'>
        {data.map(stream => <Card key={stream} stream={stream} />)}
      </div>

      <User />

      <center>
        <Member />
        <Bar />
      </center>

    </div>
  )
}
