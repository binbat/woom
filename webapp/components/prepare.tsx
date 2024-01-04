import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import Loading from "./svg/loading"
import Player from './player/player'
import {
  displayNameAtom,
  localStreamIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  localUserStatusAtom,
} from '../store/atom'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)
  const refEnabled = useRef(false)

  const [displayName, setDisplayName] = useAtom(displayNameAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [localStreamId] = useAtom(localStreamIdAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const start = async () => {
    setLoading(true)

    setLocalUserStatus({
      ...localUserStatus,
      name: displayName || localStreamId,
    })

    setLoading(false)
    setMeetingJoined(true)
    localStorage.setItem("name", displayName)
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
      setDisplayName(localStorage.getItem("name") || "")
      init()
    }
  }, [])

  return (
    <div className='flex flex-col justify-around'>
      <center className='m-xs'>
        <Player user={localStream} muted={false} width="320px" display="full" />
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
