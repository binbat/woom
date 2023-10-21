import { useRef, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import {
  meAtom,
  usersAtom,
  meetingIdAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

import { deviceNone, deviceScreen, Device, asyncGetStream } from '../lib/device'

import WHIPClient from '../lib/whip'

export default function App() {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [me] = useAtom(meAtom)
  const [users, setUsers] = useAtom(usersAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)

  const [_, setMeetingId] = useAtom(meetingIdAtom)
  const [tmpId, setTmpId] = useState<string>("")

  const startMeeting = async () => {
    if (!tmpId) {
      let res = await fetch(location.origin + `/room/?uuid=${me}`, {
        method: "POST"
      })
      setMeetingId(await res.text())
    } else {
      let res = await fetch(location.origin + `/room/${tmpId}?uuid=${me}`, {
        method: "PATCH"
      })
      setMeetingId(tmpId)
    }
  }

  const start = async () => {
    const stream = await asyncGetStream(currentDeviceVideo)
    if (stream) {

      setUsers([...users, {
        name: "me",
        stream: stream,
      }])

      const pc = new RTCPeerConnection();
      pc.addTransceiver(stream.getVideoTracks()[0], {
        direction: 'sendonly',
        //sendEncodings: [
        //  { rid: 'a', scaleResolutionDownBy: 2.0 },
        //  { rid: 'b', scaleResolutionDownBy: 1.0, },
        //  { rid: 'c' }
        //]
      });
      const whip = new WHIPClient();
      const url = location.origin + `/whip/${me}`
      //const token = document.getElementById("token").value;
      const token = "xxx"
      await whip.publish(pc, url, token);
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
