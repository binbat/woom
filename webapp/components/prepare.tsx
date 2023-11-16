import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import Loading from "./loading"
import {
  displayNameAtom,
  localStreamIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  currentDeviceAudioAtom,
  localUserStatusAtom,
} from '../store/atom'

import { asyncGetStreamId } from '../lib/storage'

import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)
  const refWave = useRef<HTMLDivElement>(null)

  const refVideo = useRef<HTMLVideoElement>(null)
  const [displayName, setDisplayName] = useAtom(displayNameAtom)

  const [localStreamId, setLocalStreamId] = useAtom(localStreamIdAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)

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

  const onChangeVideo = async () => {
    if (refVideo.current) {
      refVideo.current.srcObject = localStream.stream
    }
  }

  useEffect(() => {
    onChangeVideo()
  }, [localStream])

  useEffect(() => {
    if (!!refWave.current) {
      const wavesurfer = WaveSurfer.create({
        container: refWave.current,
        waveColor: 'rgb(200, 100, 0)',
        progressColor: 'rgb(100, 50, 0)',
      })

      if (currentDeviceAudio !== "none") {
        const record = wavesurfer.registerPlugin(RecordPlugin.create())
        record.startRecording({ deviceId: currentDeviceAudio })
      }

      return () => {
        wavesurfer.destroy()
      }
    }
  }, [currentDeviceAudio])

  return (
    <div className='flex flex-col justify-around'>
      <center className='m-xs'>
        <video className='rounded-xl' playsInline={true} autoPlay={true} controls={false} ref={refVideo} style={{ width: '320px' }}></video>

        <div className='rounded-xl' ref={refWave}></div>
      </center>

      <center className='mb-xs'>
        <label className='text-white'>Your Name: </label>
        <input
          className='text-center'
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </center>

      <div className='flex justify-evenly bg-gray-800'>
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
