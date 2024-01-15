import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import useWhipClient from "./use/whip"
import DeviceBar from './device'
import Loading from "./svg/loading"
import Player from './player/player'
import {
  localStreamIdAtom,
  meetingJoinedAtom,
} from '../store/atom'
import { getStorageName, setStorageName } from '../lib/storage'
import { setStream } from '../lib/api'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)

  const [displayName, setDisplayName] = useState<string>("")

  const [localStreamId] = useAtom(localStreamIdAtom)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const { id, stream, setUserName, setSyncUserStatus, start} = useWhipClient(localStreamId)

  const join = async () => {
    setLoading(true)

    setUserName(displayName || localStreamId)

    setLoading(false)
    setMeetingJoined(true)
    setStorageName(displayName)
    start()
    setSyncUserStatus((status) => setStream(id, status))
  }

  useEffect(() => {
    setDisplayName(getStorageName() || "")
  }, [])

  return (
    <div className='flex flex-col justify-around'>
      <center className='m-xs'>
        <Player stream={stream} muted={true} width="320px" display="full" />
      </center>

      <center className='mb-xs'>
        <label className='text-white'>Your Name: </label>
        <input
          className='text-center'
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </center>

      <div className='flex justify-evenly bg-gray-800/80'>
        <DeviceBar />
      </div>

      <center className='m-xs'>
        <button className='btn-primary flex flex-row justify-center' onClick={() => { join() }}>
          {loading
            ? <center className='m-2px mr-3'><Loading /></center>
            : null
          }
          Join
          {loading
            ? "..."
            : null
          }

        </button>
      </center>

    </div>
  )
}
