import { useAtom } from 'jotai'
import Welcome from './pages/welcome'
import Meeting from './pages/meeting'
import { meetingIdAtom } from './store/atom'
import backgroundImage from './assets/background.jpg'

function App() {
  const [meetingId] = useAtom(meetingIdAtom)

  return (
    <div style={{
      height: '100vh',
      backgroundImage: `url(${backgroundImage})`,
    }}>
      {
        !meetingId
          ? <Welcome />
          : <Meeting meetingId={meetingId} />
      }
    </div>
  )
}

export default App
