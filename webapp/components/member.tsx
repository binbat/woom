import { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamIdAtom,
  localUserStatusAtom,
  remoteStreamIdsAtom,
  meetingIdAtom,
} from '../store/atom'
import { getRoom, setStream } from '../lib/api'

export default function Member() {
  const [localStreamId] = useAtom(localStreamIdAtom)
  const [_, setRemoteStreamIds] = useAtom(remoteStreamIdsAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  const [localUserStatus] = useAtom(localUserStatusAtom)

  const refresh = async () => {
    setRemoteStreamIds(Object.keys((await getRoom(meetingId)).streams).filter(i => i !== localStreamId))
  }

  useEffect(() => {
    const handle = setInterval(refresh, 3000)
    return () => clearInterval(handle)
  }, [])

  useEffect(() => {
    setStream(meetingId, localStreamId, localUserStatus)
  }, [localUserStatus])

  return <></>
}
