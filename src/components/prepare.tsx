import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import Loading from "./loading"
import {
  localStreamIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
} from '../store/atom'

import { asyncGetStreamId } from '../lib/storage'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)

  const refVideo = useRef<HTMLVideoElement>(null)
  const [localStreamId, setLocalStreamId] = useAtom(localStreamIdAtom)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)

  const start = async () => {
    setLoading(true)
    let tmpLocalStreamId
    if (!localStreamId) {
      tmpLocalStreamId = await asyncGetStreamId()
      setLocalStreamId(tmpLocalStreamId)
    }
    setLoading(false)
    setMeetingJoined(true)
  }

  const onChangeVideo = async () => {
    if (refVideo.current) {
      refVideo.current.srcObject = localStream.stream
    }
  }
  useEffect(() => {
    onChangeVideo()
  }, [localStream])

  return (
    <div className='flex flex-col justify-around'>
      <center className='m-5xl'>
        <video className='rounded-xl' autoPlay={true} controls={false} ref={refVideo} style={{ width: '640px' }}></video>
      </center>

      <div className='flex justify-evenly bg-gray-800'>
        <DeviceBar />
      </div>

      <center className='m-5'>
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
