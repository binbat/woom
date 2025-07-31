import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import useWhipClient from './use/whip'
import DeviceBar from './device'
import Loading from './svg/loading'
import Player from './player/player'
import {
  meetingJoinedAtom,
} from '../store/atom'
import { getStorageName, setStorageName, getStorageStream } from '../lib/storage'
import { setStream } from '../lib/api'

export default function Prepare(_props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)

  const [displayName, setDisplayName] = useState<string>('')

  const localStreamId = getStorageStream()
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const { id, stream, setUserName, setSyncUserStatus, restart, userStatus } = useWhipClient(localStreamId)

  const join = async () => {
    setLoading(true)

    setUserName(displayName || localStreamId)

    setMeetingJoined(true)
    setStorageName(displayName)
    await restart()
    setSyncUserStatus((status) => setStream(id, status))
    setLoading(false)
  }

  useEffect(() => {
    setDisplayName(getStorageName() || '')
  }, [])

  return (
    <div className="flex flex-col justify-around">
      <center className="m-xs">
        <Player stream={stream} muted={false} width="320px" audio={userStatus.audio} video={userStatus.video} self={true} />
      </center>

      <center className="mb-xs">
        <label className="text-white">Your Name: </label>
        <input
          className="text-center"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </center>

      <div className="flex justify-evenly bg-gray-800/80">
        <DeviceBar streamId={localStreamId} />
      </div>

      <center className="m-xs">
        <button className="btn-primary flex flex-row justify-center" onClick={() => { join() }}>
          {loading
            ? <center className="m-2px mr-3"><Loading /></center>
            : null
          }
          Join
          {loading
            ? '...'
            : null
          }

        </button>
      </center>

    </div>
  )
}
