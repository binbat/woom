import { useAtom } from 'jotai'
import { meetingJoinedAtom } from '../store/atom'
import Layout from '../components/layout'
import Prepare from '../components/prepare'

export default function Meeting(props: { meetingId: string }) {
  const [meetingJoined] = useAtom(meetingJoinedAtom)
  return (
    <div className="flex flex-col justify-around min-h-screen">
      {meetingJoined
        ? <Layout meetingId={props.meetingId} />
        : <Prepare meetingId={props.meetingId} />
      }
    </div>
  )
}
