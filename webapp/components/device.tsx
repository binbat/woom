import { useEffect, useState } from 'react'
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

import SvgAudio from './svg/audio'
import SvgVideo from './svg/video'

export default function DeviceBar() {
  const disableDevice = "none"

  const [permissionAudio, setPermissionAudio] = useState("...")
  const [permissionVideo, setPermissionVideo] = useState("...")

  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [localUserStatus, setLocalUserStatus] = useAtom(localUserStatusAtom)

  const [currentDeviceAudio, setCurrentDeviceAudio] = useAtom(currentDeviceAudioAtom)
  const [currentDeviceVideo, setCurrentDeviceVideo] = useAtom(currentDeviceVideoAtom)
  const [currentSelectDeviceAudio, setCurrentSelectDeviceAudio] = useState(disableDevice)
  const [currentSelectDeviceVideo, setCurrentSelectDeviceVideo] = useState(disableDevice)
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

  const updateDeviceList = async () => {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(i => !!i.deviceId)
    const audios: Device[] = devices.filter(i => i.kind === 'audioinput')
    const videos: Device[] = devices.filter(i => i.kind === 'videoinput')

    if (currentDeviceAudio === disableDevice && currentSelectDeviceAudio === disableDevice) {
      let device = audios[0]
      if (device) {
        setCurrentDeviceAudio(device.deviceId)
        setCurrentSelectDeviceAudio(device.deviceId)
      }
    }

    if (currentDeviceVideo === disableDevice && currentSelectDeviceVideo === disableDevice) {
      let device = videos[0]
      if (device) {
        setCurrentDeviceVideo(device.deviceId)
        setCurrentSelectDeviceVideo(device.deviceId)
      }
    }

    setDeviceAudio([...audios])
    setDeviceVideo([...videos, deviceScreen])
  }

  const init = async () => {
    try {
      // NOTE:
      // In some device have problem:
      // - Android Web Browser
      // - Wechat WebView
      await permissionsQuery()
    } catch { }
    await updateDeviceList()
  }

  useEffect(() => {
    init()
  }, [localStream])

  useEffect(() => {
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
    navigator.mediaDevices.addEventListener("devicechange", updateDeviceList)
    return () => { navigator.mediaDevices.removeEventListener("devicechange", updateDeviceList) }
  }, [])

  const toggleEnableAudio = async () => {
    if (currentDeviceAudio === disableDevice) {
      onChangedDeviceAudio(currentSelectDeviceAudio)
    } else {
      onChangedDeviceAudio(disableDevice)
    }
  }

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
      audio: current === disableDevice ? false : true,
    })

    current === disableDevice ? null : setCurrentSelectDeviceAudio(current)

    setCurrentDeviceAudio(current)
  }

  const toggleEnableVideo = async () => {
    if (currentDeviceVideo === disableDevice) {
      onChangedDeviceVideo(currentSelectDeviceVideo)
    } else {
      onChangedDeviceVideo(disableDevice)
    }
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
      video: current === disableDevice ? false : true,
      screen: current === "screen" ? true : false,
    })

    current === disableDevice ? null : setCurrentSelectDeviceVideo(current)

    setCurrentDeviceVideo(current)
  }

  return (
    <div className='flex flex-row flex-wrap justify-around p-xs'>
      <center className='flex flex-row flex-wrap justify-around'>
        <section className='m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
          <button className='rounded-md w-8 h-8' onClick={() => toggleEnableAudio()}>
            <center>
              <SvgAudio />
            </center>
          </button>
          <div className='flex flex-col justify-between w-1 pointer-events-none'>
            {permissionAudio === "granted"
              ? <div></div>
              : <div className='bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full' style={{ position: 'relative', right: '7px' }}></div>
            }
            {currentDeviceAudio === disableDevice
              ? <div className='w-8 h-1 bg-red-500 rounded-full rotate-45'
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
              : <div></div>
            }
          </div>
          <select
            className='w-3.5 h-8 rounded-sm rotate-180'
            value={currentDeviceAudio}
            onChange={e => onChangedDeviceAudio(e.target.value)}
          >
            {deviceAudio.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>
        </section>

        <section className='m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
          <button className='rounded-md w-8 h-8' onClick={() => toggleEnableVideo()}>
            <center>
              <SvgVideo />
            </center>
          </button>
          <div className='flex flex-col justify-between w-1 pointer-events-none'>
            {permissionVideo === "granted"
              ? <div></div>
              : <div className='bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full' style={{ position: 'relative', right: '7px' }}></div>
            }
            {currentDeviceVideo === disableDevice
              ? <div className='w-8 h-1 bg-red-500 rounded-full rotate-45'
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
              : <div></div>
            }
          </div>
          <select
            className='w-3.5 h-8 rounded-sm rotate-180'
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
