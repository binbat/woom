import { useRef, useState } from 'react'
import WHIPClient from './lib/whip'
import { useAtom } from 'jotai'
import { meAtom, usersAtom, meetingIdAtom } from './atom'

interface Device {
  deviceId: string,
  label: string,
}

const deviceNone = {
  deviceId: "none",
  label: "none",
}

const deviceScreen = {
  deviceId: "screen",
  label: "screen",
}

export default function App() {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [me] = useAtom(meAtom)
  const [users, setUsers] = useAtom(usersAtom)
  const [permission, setPermission] = useState("unknow")
  const [streamAudio, setStreamAudio] = useState<MediaStream | null>(null)
  const [streamVideo, setStreamVideo] = useState<MediaStream | null>(null)
  const [currentDeviceAudio, setCurrentDeviceAudio] = useState<string>("none")
  const [currentDeviceVideo, setCurrentDeviceVideo] = useState<string>("none")
  const [deviceAudio, setDeviceAudio] = useState<Device[]>([deviceNone])
  const [deviceVideo, setDeviceVideo] = useState<Device[]>([deviceNone])

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
    const stream = streamVideo
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

  const refresh = async () => {
    navigator.getUserMedia({
      video: true,
      audio: true
    }, () => setPermission("success"), () => setPermission("error"))

    const devices = await navigator.mediaDevices.enumerateDevices()
    const audios = []
    const videos = []
    for (const device of devices) {
      switch (device.kind) {
        case 'videoinput':
          videos.push(device)
          break;

        case 'audioinput':
          audios.push(device)
          break;
      }
    }

    setDeviceAudio([deviceNone, ...audios])
    setDeviceVideo([deviceNone, ...videos, deviceScreen])
  }

  const onChangeVideo = async (deviceId: string) => {
    setCurrentDeviceVideo(deviceId)

    let stream
    if (deviceId === "none") {
      stream = null
    } else if (deviceId === "screen") {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    }

    if (refVideo.current) {
      refVideo.current.srcObject = stream
    }

    setStreamVideo(stream)
  }

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
        <div>
          <label>{permission}</label>
          <button onClick={() => { refresh() }}>refresh</button>
          <label>Video Device:</label>
          <select
            value={currentDeviceVideo}
            onChange={e => onChangeVideo(e.target.value)}
          >
            {deviceVideo.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>

          <label>Audio Device:</label>
          <select
            value={currentDeviceAudio}
            onChange={e => setCurrentDeviceAudio(e.target.value)}
          >
            {deviceAudio.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>
        </div>
      </div>

      <button onClick={() => { start() }}>start</button>

    </div>
  )
}
