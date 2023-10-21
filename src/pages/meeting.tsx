import useSWR from 'swr'
import Member from '../components/member'
import User from '../components/user'
import Card from '../components/card'

const fetcher = (args: any) => fetch(args).then(res => res.json())

export default function App(props: { meetingId: string }) {
  const { data, error, isLoading } = useSWR(`/room/${props.meetingId}`, fetcher)

  if (error) return <div>failed to load</div>
  if (isLoading) return <div>loading...</div>

  return <>
    {data.map(stream => <Card key={stream} stream={stream} />)}
    <User />
    <Member />
  </>
}
