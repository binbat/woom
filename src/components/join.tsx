import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import {
  meAtom,
  locationAtom,
  localStreamAtom,
  remoteStreamsAtom,
  meetingIdAtom,
  peerConnectionAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

import { deviceNone, deviceScreen, Device, asyncGetStream } from '../lib/device'

import WHIPClient from '../lib/whip'

export default function App() {
  const [loc, setLoc] = useAtom(locationAtom)
  const refVideo = useRef<HTMLVideoElement>(null)
  const [me] = useAtom(meAtom)

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [remoteStreams, setRemoteStreams] = useAtom(remoteStreamsAtom)

  const [peerConnection] = useAtom(peerConnectionAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const [_, setMeetingId] = useAtom(meetingIdAtom)
  const [tmpId, setTmpId] = useState<string>("")

  const startMeeting = async () => {
    let meetingId: string
    if (!tmpId) {
      let res = await fetch(`/room/?uuid=${me}`, {
        method: "POST"
      })
      meetingId = await res.text()
    } else {
      let res = await fetch(`/room/${tmpId}?uuid=${me}`, {
        method: "PATCH"
      })
      meetingId = tmpId
    }
    setMeetingId(meetingId)
    setLoc(prev => ({ ...prev, pathname: `/${meetingId}` }))
  }

  const start = async () => {
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
      const url = location.origin + `/whip/${me}`
      //const token = document.getElementById("token").value;
      const token = "xxx"
      await whip.publish(peerConnection.current, url, token);
      await startMeeting()
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

  useEffect(() => {
    const id = loc.pathname?.replace("/", "")
    if (id) {
      setTmpId(id)
    }
  }, [location])

  return (
    <div className='flex flex-col justify-around' bg="red-400 hover:red-500">
      <center>
        <video autoPlay={true} controls={true} ref={refVideo} style={{ width: '640px', height: '480px' }}></video>

        <div>
          <label>meeting id: </label>
          <input
            value={tmpId}
            onChange={e => setTmpId(e.target.value)}
          />
        </div>

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
