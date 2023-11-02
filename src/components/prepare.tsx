import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import {
  localStreamIdAtom,
  meetingAtom,
  localStreamAtom,
  remoteStreamsAtom,
  peerConnectionAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

import { asyncGetStream } from '../lib/device'

import WHIPClient from '../lib/whip'

export default function App(props: { meetingId: string }) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [localStreamId, setLocalStreamId] = useAtom(localStreamIdAtom)
  const [meeting, setMeeting] = useAtom(meetingAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [remoteStreams, setRemoteStreams] = useAtom(remoteStreamsAtom)

  const [peerConnection] = useAtom(peerConnectionAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const getStreamId = async (): Promise<string> => {
    let res = await fetch(`/room/${props.meetingId}/stream`, {
      method: "POST"
    })
    return res.text()
  }

  const start = async () => {
    if (!localStreamId) {
      const localStreamId = await getStreamId()
      setLocalStreamId(localStreamId)
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
      const url = location.origin + `/whip/${localStreamId}`
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
        <button className='btn-primary' onClick={() => { start() }}>start</button>
      </center>

    </div>
  )
}
