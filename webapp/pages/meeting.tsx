import { useAtom } from 'jotai'
import { meetingJoinedAtom } from '../store/atom'
import Layout from '../components/layout'
import Prepare from '../components/prepare'
import { useEffect } from 'react'
import WakeLock from '../components/use/wakeLock'

export default function Meeting(props: { meetingId: string }) {
  const [meetingJoined] = useAtom(meetingJoinedAtom)
  useEffect(() => {
    const lock = new WakeLock()
    if (meetingJoined) {
      lock.request()
    }
    return () => {
      lock.release()
    }
  }, [meetingJoined])
  return (
    <div className="flex flex-col justify-around min-h-screen">
      {meetingJoined
        ? <Layout meetingId={props.meetingId} />
        : <Prepare meetingId={props.meetingId} />
      }
    </div>
  )
}
