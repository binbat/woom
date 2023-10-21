import { useState } from 'react'
import WHIPClient from '../lib/whip'
import { useAtom } from 'jotai'
import { meAtom, usersAtom } from '../store/atom'

const deviceScreen = {
  deviceId: "screen",
  groupId: "",
  kind: "videoinput",
  label: "screen",
  toJSON: () => { },
}

export default function App() {
  const [me] = useAtom(meAtom)
  const [users, setUsers] = useAtom(usersAtom)
  const [permission, setPermission] = useState("unknow")
  const [currentDeviceAudio, setCurrentDeviceAudio] = useState()
  const [currentDeviceVideo, setCurrentDeviceVideo] = useState()
  const [deviceAudio, setDeviceAudio] = useState<MediaDeviceInfo[]>([])
  const [deviceVideo, setDeviceVideo] = useState<MediaDeviceInfo[]>([])

  const start = async () => {
    const deviceId = currentDeviceVideo
    let stream
    if (deviceId === "screen") {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    }

    setUsers([...users, {
      name: "me",
      stream: stream,
    }])

    const pc = new RTCPeerConnection();
    pc.addTransceiver(stream.getVideoTracks()[0], {
      direction: 'sendonly',
      sendEncodings: [
        { rid: 'a', scaleResolutionDownBy: 2.0 },
        { rid: 'b', scaleResolutionDownBy: 1.0, },
        { rid: 'c' }
      ]
    });
    const whip = new WHIPClient();
    const url = location.origin + `/whip/${me}`
    //const token = document.getElementById("token").value;
    const token = "xxx"
    whip.publish(pc, url, token);
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

    setDeviceAudio(audios)
    setDeviceVideo([...videos, deviceScreen])
  }

  return (
    <div className='flex justify-evenly' bg="green-400 hover:green-500 ">
      <label>Bar</label>
      <button onClick={() => { start() }}>start</button>

      <div>
        <label>{permission}</label>
        <button onClick={() => { refresh() }}>refresh</button>
        <label>Video Device:</label>
        <select
          value={currentDeviceVideo}
          onChange={e => setCurrentDeviceVideo(e.target.value)}
        >
          {deviceVideo.map(device =>
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          )}
        </select>
      </div>
    </div>
  )
}
