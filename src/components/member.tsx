import { useAtom } from 'jotai'
import { localStreamIdAtom, remoteStreamsIdAtom, meetingIdAtom } from '../store/atom'

export default function Member() {
  const [me] = useAtom(localStreamIdAtom)
  const [_, setStream] = useAtom(remoteStreamsIdAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${meetingId}`)
    setStream((await res.json()).filter(i => i !== me))
  }

  return (
    <div>
      <button className='btn-primary' onClick={refresh}>Refresh Members</button>
    </div>
  )
}
