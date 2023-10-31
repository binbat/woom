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
    <div className='flex flex-col justify-around' bg="red-400 hover:red-500">
      <center>
        <video autoPlay={true} controls={true} ref={refVideo} style={{ width: '640px', height: '480px' }}></video>
      </center>

      <div className='flex justify-evenly' bg="green-400 hover:green-500 ">
        <DeviceBar />
      </div>

      <center>
        <button className="bg-blue-400 hover:bg-blue-500 text-sm text-white font-mono font-light py-2 px-4 rounded border-2 border-blue-200 dark:bg-blue-500 dark:hover:bg-blue-600" onClick={() => { start() }}>start</button>
      </center>

    </div>
  )
}
