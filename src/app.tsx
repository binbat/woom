import { useAtom } from 'jotai'
import Welcome from './pages/welcome'
import Meeting from './pages/meeting'
import { meetingIdAtom } from './store/atom'

function App() {
  const [meetingId] = useAtom(meetingIdAtom)

  return (
    <>
      {
        !meetingId
          ? <Welcome />
          : <Meeting meetingId={meetingId} />
      }
    </>
  )
}

export default App
