import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import Loading from "./loading"
import {
  localStreamIdAtom,
  meetingJoinedAtom,
  localStreamAtom,
  remoteStreamsAtom,
  peerConnectionAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

import { asyncGetStreamId } from '../lib/storage'
import { asyncGetStream } from '../lib/device'

import WHIPClient from '../lib/whip'

export default function Prepare(props: { meetingId: string }) {
  const [loading, setLoading] = useState<boolean>(false)

  const refVideo = useRef<HTMLVideoElement>(null)
  const [localStreamId, setLocalStreamId] = useAtom(localStreamIdAtom)
  const [meeting, setMeeting] = useAtom(meetingJoinedAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [remoteStreams, setRemoteStreams] = useAtom(remoteStreamsAtom)

  const [peerConnection] = useAtom(peerConnectionAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const start = async () => {
    setLoading(true)
    let tmpLocalStreamId
    if (!localStreamId) {
      tmpLocalStreamId = await asyncGetStreamId()
      setLocalStreamId(tmpLocalStreamId)
    }

    const stream = await asyncGetStream(currentDeviceVideo)
    if (stream) {

      setLocalStream({
        name: "me",
        stream: stream,
      })

      //const pc = new RTCPeerConnection();
      const trans = peerConnection.current.addTransceiver(stream.getVideoTracks()[0], {
        direction: 'sendonly',
        //sendEncodings: [
        //  { rid: 'a', scaleResolutionDownBy: 2.0 },
        //  { rid: 'b', scaleResolutionDownBy: 1.0, },
        //  { rid: 'c' }
        //]
      });

      //trans.sender.replaceTrack(withTrack)
      const whip = new WHIPClient();
      const url = location.origin + `/whip/${localStreamId || tmpLocalStreamId}`
      //const token = document.getElementById("token").value;
      const token = "xxx"
      await whip.publish(peerConnection.current, url, token);
      //await startMeeting()
      setMeeting(true)
    }
  }

  const onChangeVideo = async () => {
    if (refVideo.current) {
      refVideo.current.srcObject = await asyncGetStream(currentDeviceVideo)
    }
  }
  useEffect(() => {
    onChangeVideo()
  }, [currentDeviceVideo])

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
