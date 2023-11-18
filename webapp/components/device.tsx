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
      // NOTE:
      // Firefox don't have `camera` and `microphone` in permissions
      // https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query#name
      // https://searchfox.org/mozilla-central/source/dom/webidl/Permissions.webidl#10
      //
      // NOTE:
      // PermissionName
      // https://w3c.github.io/permissions/
      // Reference: https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API
      i => navigator.permissions.query({ name: i as PermissionName })
    ))).map(status => {
      // NOTE:
      // Chrome: audio_capture, video_capture
      // Safari: microphone, camera
      if (status.name === "audio_capture" || "microphone") {
        setPermissionAudio(status.state)
      }
      if (status.name === "video_capture" || "camera") {
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

  const updateDeviceList = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audios: Device[] = []
    const videos: Device[] = []
    devices.filter(i => !!i.deviceId).map(device => {
      switch (device.kind) {
        case 'audioinput':
          audios.push(device)
          break
        case 'videoinput':
          videos.push(device)
          break
      }
    })

    setDeviceAudio([deviceNone, ...audios])
    setDeviceVideo([deviceNone, ...videos, deviceScreen])
  }

  const init = async () => {
    try {
      // NOTE:
      // In some device have problem:
      // - Android Web Browser
      // - Wechat WebView
      await requestPermission()
    } catch { }
    await updateDeviceList()
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      init()
    }
  }, [])

  useEffect(() => {
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
    navigator.mediaDevices.addEventListener("devicechange", updateDeviceList)
    return () => { navigator.mediaDevices.removeEventListener("devicechange", updateDeviceList) }
  }, [])

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
    <div className='flex flex-row flex-wrap justify-around p-xs'>
      <center className='basis-full'>
        <label className='text-white'>
          Your Device Status: <code className={permission === "success" ? "text-green" : "text-red"}>{permission}</code>
        </label>

        <section className='flex flex-row justify-center text-white'>
          <div className='mx-xs'>
            Microphone: <code className={permissionAudio === "granted" ? "text-green" : "text-red"}>{permissionAudio}</code>
          </div>
          <div className='mx-xs'>
            Camera: <code className={permissionVideo === "granted" ? "text-green" : "text-red"}>{permissionVideo}</code>
          </div>
        </section>
      </center>

      <center className='flex flex-row flex-wrap justify-around'>
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
      </center>
    </div>
  )
}
