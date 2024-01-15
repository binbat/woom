import { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamIdAtom,
  remoteStreamIdsAtom,
  meetingIdAtom,
} from '../store/atom'
import { getRoom } from '../lib/api'

export default function Member() {
  const [localStreamId] = useAtom(localStreamIdAtom)
  const [_, setRemoteStreamIds] = useAtom(remoteStreamIdsAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const refresh = async () => {
    setRemoteStreamIds(Object.keys((await getRoom(meetingId)).streams).filter(i => i !== localStreamId))
  }

  useEffect(() => {
    const handle = setInterval(refresh, 3000)
    return () => clearInterval(handle)
  }, [])

  return <></>
}
