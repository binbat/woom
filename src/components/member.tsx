import { useAtom } from 'jotai'
import { streamAtom, meetingIdAtom, meAtom } from '../store/atom'

export default function App() {
  const [me] = useAtom(meAtom)
  const [_, setStream] = useAtom(streamAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${meetingId}`)
    setStream((await res.json()).filter(i => i !== me))
  }

  return (
    <div>
      <button onClick={refresh}>Refresh</button>
    </div>
  )
}
