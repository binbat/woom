import useWhipClient from "./use/whip"
import { useEffect, useState } from 'react'
import {
  Device,
  deviceNone,
  deviceScreen,
} from '../lib/device'

import Loading from './svg/loading'
import SvgAudio from './svg/audio'
import SvgVideo from './svg/video'
import { SvgPresentCancel, SvgPresentToAll } from './svg/present'

// 1. Converts each device's deviceId and label into a displayable format. If label is empty, uses the device type and deviceId as the display name.
function deviceInfoToOption(info: MediaDeviceInfo) {
  const value = info.deviceId;
  let text = info.label;
  if (text.length <= 0) {
      text = `${info.kind} (${info.deviceId})`;
  }
  return { value, text };
}

// 2. Removes duplicate items based on their value.
function uniqByValue<T extends { value: unknown }>(items: T[]) {
  const map = new Map<unknown, T>();
  for (const item of items) {
      if (!map.has(item.value)) {
          map.set(item.value, item);
      }
  }
  return Array.from(map.values());
}

// 3. Converts items to Device format
const convertToDevice = (items: { value: string; text: string }[], kind: MediaDeviceKind): MediaDeviceInfo[] => {
  return items.map(item => ({
    deviceId: item.value,         // use value as the device ID
    kind,
    label: item.text,             // use text as the label
    groupId: '',

  })as MediaDeviceInfo);
}

export default function DeviceBar(props: { streamId: string }) {

  const [permissionAudio, setPermissionAudio] = useState("")
  const [permissionVideo, setPermissionVideo] = useState("")

  const [loadingAudio, setLoadingAudio] = useState(false)
  const [loadingVideo, setLoadingVideo] = useState(false)
  const [loadingScreen, setLoadingScreen] = useState(false)

  const {
    userStatus,
    currentDeviceAudio,
    currentDeviceVideo,
    setCurrentDeviceAudio,
    setCurrentDeviceVideo,
    toggleEnableAudio,
    toggleEnableVideo,
  } = useWhipClient(props.streamId)

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
      if (status.name === "audio_capture" || status.name === "microphone") {
        setPermissionAudio(status.state)
      }
      if (status.name === "video_capture" || status.name === "camera") {
        setPermissionVideo(status.state)
      }
    })

  const updateDeviceList = async () => {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(i => !!i.deviceId)
    const audios = devices.filter(i => i.kind === 'audioinput').map(deviceInfoToOption)
    const videos = devices.filter(i => i.kind === 'videoinput').map(deviceInfoToOption);

    const uniqueAudios = uniqByValue(audios);
    const uniqueVideos = uniqByValue(videos);

    if (currentDeviceAudio === deviceNone.deviceId) {
      let device = uniqueAudios[0]
      if (device)
        {
          try {
            await setCurrentDeviceAudio(device.value)
          console.log('Audio device set successfully')
        } catch (error) {
          console.error('Failed to set audio device:', error)
        }
      }

    }

    if (currentDeviceVideo === deviceNone.deviceId) {
      let device = uniqueVideos[0]
      if (device) {
        try {
          await setCurrentDeviceVideo(device.value)
        console.log('Video device set successfully')
      } catch (error) {
        console.error('Failed to set video device:', error)
      }
    } else {
      console.log('no video devices:')
      await setCurrentDeviceVideo(deviceNone.deviceId)

    }
    }

    setDeviceAudio(convertToDevice(uniqueAudios,'audioinput'))
    setDeviceVideo(convertToDevice(uniqueVideos,'videoinput'))

  }

  const init = async () => {
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true, audio: true })).getTracks().map(track => track.stop())
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
  }, [])

  useEffect(() => {
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
    navigator.mediaDevices.addEventListener("devicechange", updateDeviceList)
    return () => { navigator.mediaDevices.removeEventListener("devicechange", updateDeviceList) }
  }, [])

  const onChangedDeviceAudio = async (current: string) => {
    setLoadingAudio(true)
    await setCurrentDeviceAudio(current)
    setLoadingAudio(false)
  }

  const onChangedDeviceVideo = async (current: string) => {
    setLoadingVideo(true)
    await setCurrentDeviceVideo(current)
    setLoadingVideo(false)
  }

  const toggleEnableScreen = async () => {
    setLoadingScreen(true)
    await onChangedDeviceVideo(userStatus.screen ? deviceNone.deviceId : deviceScreen.deviceId)
    setLoadingScreen(false)
  }

  return (
    <div className='flex flex-row flex-wrap justify-around p-xs'>
      <center className='flex flex-row flex-wrap justify-around'>
        <section className='m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
          <button className='text-rose-400 rounded-md w-8 h-8' onClick={async () => {
            setLoadingAudio(true)
            toggleEnableAudio()
            setLoadingAudio(false)
          }}>
            <center>{ loadingAudio ? <Loading/> : <SvgAudio/> }</center>
          </button>
          <div className='flex flex-col justify-between w-1 pointer-events-none'>
            {permissionAudio === "granted"
              ? <div></div>
              : <div className='bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full' style={{ position: 'relative', right: '7px' }}></div>
            }
            {userStatus.audio
              ? <div></div>
              : <div className='w-8 h-1 bg-red-500 rounded-full rotate-45'
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
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
          <button className='text-rose-400 rounded-md w-8 h-8' onClick={async () => {
            setLoadingVideo(true)
            await toggleEnableVideo()
            setLoadingVideo(false)
          }}>
            <center>{ loadingVideo ? <Loading/> : <SvgVideo/> }</center>
          </button>
          <div className='flex flex-col justify-between w-1 pointer-events-none'>
            {permissionVideo === "granted"
              ? <div></div>
              : <div className='bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full' style={{ position: 'relative', right: '7px' }}></div>
            }
            {userStatus.video
              ? <div></div>
              : <div className='w-8 h-1 bg-red-500 rounded-full rotate-45'
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
            }
          </div>
          <select
            className='w-3.5 h-8 rounded-sm rotate-180'
            value={currentDeviceVideo}
            onChange={e => onChangedDeviceVideo(e.target.value)}
          >
            {deviceVideo.map(device =>
              <option key={device.label} value={device.label}>{device.label}</option>
            )}
          </select>
        </section>
      </center>
      <center>
        <section className='m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
          <button className='text-rose-400 rounded-md w-8 h-8' onClick={() => toggleEnableScreen()}>
            <center>
              {loadingScreen
                ? <Loading />
                : userStatus.screen ? <SvgPresentCancel /> : <SvgPresentToAll />
              }
            </center>
          </button>
        </section>

      </center>
    </div>
  )
}
