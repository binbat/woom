import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { deviceNone, deviceScreen, Device, getStream, asyncGetStream } from '../lib/device'
import {
  streamAtom,
  peerConnectionAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

export default function App() {
  const [permission, setPermission] = useState("unknow")

  const [streams, setStreams] = useAtom(streamAtom)
  const [peerConnection] = useAtom(peerConnectionAtom)

  //const [streamAudio, setStreamAudio] = useState<MediaStream | null>(null)
  //const [streamVideo, setStreamVideo] = useState<MediaStream | null>(null)
  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)
  const [deviceAudio, setDeviceAudio] = useState<Device[]>([deviceNone])
  const [deviceVideo, setDeviceVideo] = useState<Device[]>([deviceNone])

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

  useEffect(() => {
    console.log('Running effect once on mount')

    refresh()

    return () => {
      console.log('Running clean-up of effect on unmount')
    }
  }, [])

  const onChangePublish = async () => {
    console.log("onChangePublish")
    const senders = peerConnection.current.getSenders()
    if (senders[0]) {

      const mediaStream = await asyncGetStream(currentDeviceVideo)
      if (mediaStream) {

        setStreams([{
          stream: mediaStream,
          name: "me",
        }, ...streams.slice(1, -1)])

        const tracks = mediaStream.getVideoTracks()

        if (tracks) {
          if (tracks[0]) {
            senders[0].replaceTrack(tracks[0])
          }
        }
      }
    }
  }
  useEffect(() => {
    onChangePublish()
  }, [currentDeviceAudio, currentDeviceVideo])

  return (
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

  )
}
