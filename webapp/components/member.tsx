import { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  remoteStreamIdsAtom,
} from '../store/atom'
import { getStorageStream, getStorageMeeting } from '../lib/storage'
import { getRoom } from '../lib/api'

export default function Member() {
  const [_, setRemoteStreamIds] = useAtom(remoteStreamIdsAtom)

  const refresh = async () => {
    setRemoteStreamIds(Object.keys((await getRoom(getStorageMeeting())).streams).filter(i => i !== getStorageStream()))
  }

  useEffect(() => {
    const handle = setInterval(refresh, 3000)
    return () => clearInterval(handle)
  }, [])

  return <></>
}
