import { useAtom } from 'jotai'
import { meetingAtom } from '../store/atom'
import Layout from '../components/layout'
import Prepare from '../components/prepare'

export default function Meeting(props: { meetingId: string }) {
  const [meeting] = useAtom(meetingAtom)
  return (
    <div className='flex flex-col justify-around' style={{
      height: '100%'
    }}>
      {meeting
        ? <Layout meetingId={props.meetingId} />
        : <Prepare meetingId={props.meetingId} />
      }
    </div>
  )
}
