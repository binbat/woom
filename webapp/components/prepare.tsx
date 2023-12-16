import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import Loading from "./loading"
import Player from './player/player'
import {
  displayNameAtom,
  localStreamIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  localUserStatusAtom,
} from '../store/atom'

import { asyncGetStreamId } from '../lib/storage'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)
  const refEnabled = useRef(false)

  const [displayName, setDisplayName] = useAtom(displayNameAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [localStreamId, setLocalStreamId] = useAtom(localStreamIdAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const start = async () => {
    setLoading(true)
    let tmpLocalStreamId
    if (!localStreamId) {
      tmpLocalStreamId = await asyncGetStreamId()
      setLocalStreamId(tmpLocalStreamId)
    }

    setLocalUserStatus({
      ...localUserStatus,
      name: displayName || localStreamId,
    })

    setLoading(false)
    setMeetingJoined(true)
  }

  const init = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320 }, audio: true })
      setLocalStream({
        stream: stream,
        name: "Me",
      })

      setLocalUserStatus({
        ...localUserStatus,
        audio: true,
        video: true,
      })

    } catch { }
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      init()
    }
  }, [])

  return (
    <div className='flex flex-col justify-around'>
      <center className='m-xs'>
        <Player user={localStream} muted={false} width="320px" />
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
        <button className='btn-primary flex flex-row justify-center' onClick={() => { start() }}>
          {loading
            ? <div className='m-2px'><Loading /></div>
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
