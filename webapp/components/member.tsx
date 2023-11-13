import { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamIdAtom,
  localUserStatusAtom,
  remoteStreamIdsAtom,
  meetingIdAtom,
} from '../store/atom'

export default function Member() {
  const [localStreamId] = useAtom(localStreamIdAtom)
  const [_, setStream] = useAtom(remoteStreamIdsAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const [localUserStatus] = useAtom(localUserStatusAtom)

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${meetingId}`)
    setStream(Object.keys(await res.json()).filter(i => i !== localStreamId))
  }

  useEffect(() => {
    fetch(location.origin + `/room/${meetingId}/stream/${localStreamId}`, {
      method: 'PATCH',
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(localUserStatus),
    })
  }, [localUserStatus])

  return (
    <div>
      <button className='btn-primary' onClick={refresh}>Refresh Members</button>
    </div>
  )
}
