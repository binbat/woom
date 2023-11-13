import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import {
  Device,
  deviceNone,
  deviceScreen,
  asyncGetAudioStream,
  asyncGetVideoStream,
} from '../lib/device'
import {
  localStreamAtom,
  localUserStatusAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

export default function DeviceBar() {
  const refEnabled = useRef(false)

  const [permission, setPermission] = useState("...")
  const [permissionAudio, setPermissionAudio] = useState("...")
  const [permissionVideo, setPermissionVideo] = useState("...")

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)
  const [deviceAudio, setDeviceAudio] = useState<Device[]>([deviceNone])
  const [deviceVideo, setDeviceVideo] = useState<Device[]>([deviceNone])

  const permissionsQuery = async () =>
    (await Promise.all(["camera", "microphone"].map(
      //@ts-ignore
      name => navigator.permissions.query({ name })
    ))).map(status => {
      if (status.name === "audio_capture") {
        setPermissionAudio(status.state)
      }
      if (status.name === "video_capture") {
        setPermissionVideo(status.state)
      }
    })

  const requestPermission = async () => {
    try {
      permissionsQuery()
      const result = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      result instanceof MediaStream ? setPermission("success") : setPermission("error")
      result.getTracks().map(track => track.stop())
      //@ts-ignore
    } catch ({ name, message }) {
      setPermission(message)
    } finally {
      await permissionsQuery()
    }
  }

  const refreshDevice = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audios: Device[] = []
    const videos: Device[] = []
    devices.filter(i => !!i.deviceId).map(device => {
      switch (device.kind) {
        case 'audioinput':
          audios.push(device)
          break;
        case 'videoinput':
          videos.push(device)
          break;
      }
    })

    setDeviceAudio([deviceNone, ...audios])
    setDeviceVideo([deviceNone, deviceScreen, ...videos])
  }

  const init = async () => {
    await requestPermission()
    await refreshDevice()
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      init()
    }
  }, [])

  useEffect(() => {
    navigator.mediaDevices.ondevicechange = () => refreshDevice()
    return () => { navigator.mediaDevices.ondevicechange = () => { } }
  })

  const onChangedDeviceAudio = async (current: string) => {
    // Closed old tracks
    const stream = localStream.stream
    stream.getAudioTracks().map(track => {
      track.stop()
      stream.removeTrack(track)
    })

    const mediaStream = await asyncGetAudioStream(current)

    const videoTracks = localStream.stream.getVideoTracks()
    const audioTracks = mediaStream.getAudioTracks()

    setLocalStream({
      stream: new MediaStream([...audioTracks, ...videoTracks]),
      name: "Me",
    })

    setLocalUserStatus({
      ...localUserStatus,
      audio: current === "none" ? false : true,
    })

    setCurrentDeviceAudio(current)
  }

  const onChangedDeviceVideo = async (current: string) => {
    // Closed old tracks
    const stream = localStream.stream
    stream.getVideoTracks().map(track => {
      track.stop()
      stream.removeTrack(track)
    })

    const mediaStream = await asyncGetVideoStream(current)
    const audioTracks = localStream.stream.getAudioTracks()
    const videoTracks = mediaStream.getVideoTracks()

    setLocalStream({
      stream: new MediaStream([...audioTracks, ...videoTracks]),
      name: "Me",
    })

    setLocalUserStatus({
      ...localUserStatus,
      video: current === "none" ? false : true,
      screen: current === "screen" ? true : false,
    })

    setCurrentDeviceVideo(current)
  }

  return (
    <div className='flex flex-row flex-wrap justify-around p-4 m-4 container'>
      <center className='basis-full m-xl'>
        <label className='m-xl text-white'>
          Your Device Status: <code className={permission === "success" ? "text-green" : "text-red"}>{permission}</code>
        </label>
        {permission === 'success' && false // TODO: I don't test `navigator.mediaDevices.ondevicechange`
          ? <button className='btn-primary' onClick={() => { refreshDevice() }}>refresh</button>
          : null
        }

        <section className='flex flex-row justify-center text-white'>
          <div className='mx-sm'>
            Microphone Permission: <code className={permissionAudio === "granted" ? "text-green" : "text-red"}>{permissionAudio}</code>
          </div>
          <div className='mx-sm'>
            Camera Permission: <code className={permissionVideo === "granted" ? "text-green" : "text-red"}>{permissionVideo}</code>
          </div>
        </section>
      </center>

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
    </div>
  )
}
