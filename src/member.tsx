import { useAtom } from 'jotai'
import { streamAtom, meetingIdAtom } from './atom'

export default function App() {
  const [_, setStream] = useAtom(streamAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${meetingId}`)
    setStream(await res.json())
  }

  return (
    <div>
      <button onClick={refresh}>Refresh</button>
    </div>
  )
}
