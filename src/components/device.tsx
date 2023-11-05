import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { deviceNone, deviceScreen, Device, asyncGetStream } from '../lib/device'
import {
  localStreamAtom,
  peerConnectionAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

export default function DeviceBar() {
  const [permission, setPermission] = useState("unknow")

  const [peerConnection] = useAtom(peerConnectionAtom)
  const [localStream, setLocalStream] = useAtom(localStreamAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)
  const [deviceAudio, setDeviceAudio] = useState<Device[]>([deviceNone])
  const [deviceVideo, setDeviceVideo] = useState<Device[]>([deviceNone])

  const refresh = async () => {
    const result = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    })

    result instanceof MediaStream ? setPermission("success") : setPermission("error")

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
    refresh()
  }, [])

  const onChangedDeviceAudio = async (current: string) => {
    setCurrentDeviceAudio(current)
  }

  const onChangedDeviceVideo = async (current: string) => {
    console.log("onChangedDeviceVideo: ", current)
    setCurrentDeviceVideo(current)

    // Closed old tracks
    const stream = localStream.stream
    if (stream) {
      stream.getVideoTracks().map(track => {
        track.stop()
        stream.removeTrack(track)
      })
    }

    const mediaStream = await asyncGetStream(current)
    setLocalStream({
      stream: mediaStream,
      name: "Me",
    })

    // If WebRTC is connected, switch track
    peerConnection.current.getSenders().filter((_, i) => i === 0).map(sender => {
      if (mediaStream) {
        mediaStream.getVideoTracks().filter((_, i) => i === 0).map(track => {
          sender.replaceTrack(track)
        })
      }
    })
  }

  return (
    <div className='flex flex-row flex-wrap justify-around p-4 m-4 container'>
      <center className='basis-full m-xl'>
        <label className='m-xl text-white'>User device status: <code className={permission === "success" ? "text-green" : "text-red"}>{permission}</code></label>
        <button className='btn-primary' onClick={() => { refresh() }}>refresh</button>
      </center>

      <section className='md:basis-1/2 sm:basis-full'>
        <label className='w-1/3 m-sm text-white'>Video Device:</label>
        <select
          className='w-2/3'
          value={currentDeviceVideo}
          onChange={e => onChangedDeviceVideo(e.target.value)}
        >
          {deviceVideo.map(device =>
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          )}
        </select>
      </section>

      <section className='md:basis-1/2 sm:basis-full'>
        <label className='w-1/3 m-sm text-white'>Audio Device:</label>
        <select
          className='w-2/3'
          value={currentDeviceAudio}
          onChange={e => onChangedDeviceAudio(e.target.value)}
        >
          {deviceAudio.map(device =>
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          )}
        </select>
      </section>
    </div>
  )
}
