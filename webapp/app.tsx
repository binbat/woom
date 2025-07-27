import { useAtom } from 'jotai'
import Welcome from './pages/welcome'
import Meeting from './pages/meeting'
import { meetingIdAtom } from './store/atom'

export default function WOOM() {
  const [meetingId] = useAtom(meetingIdAtom)
  return (
    <div
      className="min-h-screen">
      {
        !meetingId
          ? <Welcome />
          : <Meeting meetingId={meetingId} />
      }
    </div>
  )
}
