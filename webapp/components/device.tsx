import useWhipClient from './use/whip'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import {
  Device,
  deviceNone,
  deviceScreen,
} from '../lib/device'
import { isScreenShareSupported } from '../lib/util'
import {
  deviceSpeakerAtom,
  speakerStatusAtom,
} from './../store/atom'

import Loading from './svg/loading'
import SvgSpeaker from './svg/speaker'
import SvgAudio from './svg/audio'
import SvgVideo from './svg/video'
import { SvgPresentCancel, SvgPresentToAll } from './svg/present'
import { SvgBackgroundCancel, SvgBackground } from './svg/background'
import { SvgSetting } from './svg/setting'
import Settings from './settings'

import {useSettingStore} from '../store/settingStore'

function toDevice(info: MediaDeviceInfo): Device {
  const deviceId = info.deviceId
  let label = info.label
  if (label.length <= 0) {
    label = `${info.kind} (${deviceId.substring(0, 8)})`
  }
  return { deviceId, label }
}

export default function DeviceBar(props: { streamId: string }) {
  const [permissionAudio, setPermissionAudio] = useState('')
  const [permissionVideo, setPermissionVideo] = useState('')

  const [loadingSpeaker, setLoadingSpeaker] = useState(false)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [loadingVideo, setLoadingVideo] = useState(false)
  const [loadingScreen, setLoadingScreen] = useState(false)
  const [loadingBackground, setLoadingBackground] = useState(false)

  const [currentDeviceSpeaker, setCurrentDeviceSpeaker] = useAtom(deviceSpeakerAtom)
  const [speakerStatus, setSpeakerStatus] = useAtom(speakerStatusAtom)

  const screenShareButtonShowed = useSettingStore(state => state.screenShareButtonShowed)
  const [virtualBackgroundEnabled, setVirtualBackgroundEnabled] = useState(false)

  const {
    userStatus,
    currentDeviceAudio,
    currentDeviceVideo,
    setCurrentDeviceAudio,
    setCurrentDeviceVideo,
    toggleEnableAudio,
    toggleEnableVideo,
    toggleEnableVirtualBackground,
  } = useWhipClient(props.streamId)

  const [deviceSpeaker, setDeviceSpeaker] = useState<Device[]>([deviceNone])
  const [deviceAudio, setDeviceAudio] = useState<Device[]>([deviceNone])
  const [deviceVideo, setDeviceVideo] = useState<Device[]>([deviceNone])

  const [isSetting, setIsSetting] = useState(false)

  const permissionsQuery = async () =>
    (await Promise.all(['camera', 'microphone'].map(
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
      if (status.name === 'audio_capture' || status.name === 'microphone') {
        setPermissionAudio(status.state)
      }
      if (status.name === 'video_capture' || status.name === 'camera') {
        setPermissionVideo(status.state)
      }
    })

  const updateDeviceList = async () => {
    // to obtain non-empty device label, there needs to be an active media stream or persistent permission
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo/label#value
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch { /* empty */ }

      try {
        await navigator.mediaDevices.getUserMedia({ video: true })
      } catch { /* empty */ }
    }

    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(i => !!i.deviceId)

    const speakers = devices.filter(i => i.kind === 'audiooutput').map(toDevice)
    const audios = devices.filter(i => i.kind === 'audioinput').map(toDevice)
    const videos = devices.filter(i => i.kind === 'videoinput').map(toDevice)

    if (currentDeviceSpeaker === deviceNone.deviceId) {
      const device = speakers[0]
      if (device) setCurrentDeviceSpeaker(device.deviceId)
    }

    if (currentDeviceAudio === deviceNone.deviceId) {
      const device = audios[0]
      if (device) await setCurrentDeviceAudio(device.deviceId)
    }

    if (currentDeviceVideo === deviceNone.deviceId) {
      const device = videos[0]
      if (device) await setCurrentDeviceVideo(device.deviceId)
    }

    setDeviceSpeaker([...speakers])
    setDeviceAudio([...audios])
    setDeviceVideo([...videos])
  }

  const init = async () => {
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true, audio: true })).getTracks().map(track => track.stop())
      // NOTE:
      // In some device have problem:
      // - Android Web Browser
      // - Wechat WebView
      await permissionsQuery()
    } catch {
      try {
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().map(track => track.stop())
        await permissionsQuery()
      } catch { /* empty */ }
      try {
        (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().map(track => track.stop())
        await permissionsQuery()
      } catch { /* empty */ }
    }
    await updateDeviceList()
  }

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    // Reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event
    navigator.mediaDevices.addEventListener('devicechange', updateDeviceList)
    return () => { navigator.mediaDevices.removeEventListener('devicechange', updateDeviceList) }
  }, [])

  const onChangedDeviceSpeaker = async (current: string) => {
    setLoadingSpeaker(true)
    setCurrentDeviceSpeaker(current)
    setLoadingSpeaker(false)
  }

  const onChangedDeviceAudio = async (current: string) => {
    setLoadingAudio(true)
    await setCurrentDeviceAudio(current)
    setLoadingAudio(false)
  }

  const onChangedDeviceVideo = async (current: string, constraints?: MediaTrackConstraints) => {
    setLoadingVideo(true)
    await setCurrentDeviceVideo(current, constraints)
    if (userStatus.screen) {
      setVirtualBackgroundEnabled(false)
    }
    setLoadingVideo(false)
  }

  const screenResolutions = [
    { label: '720p (Default)', value: '720' },
    { label: '1080p', value: '1080' },
    { label: 'Native', value: 'native' }
  ]
  const screenShareResolution = useSettingStore(state => state.screenShareResolution)
  const setScreenShareResolution = useSettingStore(state => state.setScreenShareResolution)

  useEffect(() => {
    if (userStatus.screen) {
      onChangedDeviceVideo(deviceNone.deviceId)
    }
  }, [screenShareResolution])

  const toggleEnableScreen = async () => {
    const height = Number.parseInt(screenShareResolution)
    const constraints = Number.isNaN(height) ? {} : { height }
    setLoadingScreen(true)
    await onChangedDeviceVideo(userStatus.screen ? deviceNone.deviceId : deviceScreen.deviceId, constraints)
    setLoadingScreen(false)
  }

  const onChangeScreenShareResolution = async (resolution: string) => {
    setScreenShareResolution(resolution)
    const height = Number.parseInt(resolution)
    const constraints = Number.isNaN(height) ? {} : { height }
    setLoadingScreen(true)
    await onChangedDeviceVideo(deviceScreen.deviceId, constraints)
    setLoadingScreen(false)
  }

  return (
    <div className="flex flex-row flex-wrap justify-around p-xs">
      <center className="flex flex-row flex-wrap justify-around">
        <section className="m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500">
          <button className="text-rose-400 rounded-md w-8 h-8" onClick={async () => {
            setLoadingSpeaker(true)
            setSpeakerStatus((prev) => !prev)
            setLoadingSpeaker(false)
          }}>
            <center>{loadingSpeaker ? <Loading /> : <SvgSpeaker />}</center>
          </button>
          <div className="flex flex-col justify-between w-1 pointer-events-none">
            <div></div>
            {speakerStatus
              ? <div></div>
              : <div className="w-8 h-1 bg-red-500 rounded-full rotate-45"
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
            }
          </div>
          <select
            className="w-3.5 h-8 rounded-sm rotate-180"
            value={currentDeviceSpeaker}
            onChange={e => onChangedDeviceSpeaker(e.target.value)}
          >
            {deviceSpeaker.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>
        </section>

        <section className="m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500">
          <button className="text-rose-400 rounded-md w-8 h-8" onClick={async () => {
            setLoadingAudio(true)
            toggleEnableAudio()
            setLoadingAudio(false)
          }}>
            <center>{loadingAudio ? <Loading /> : <SvgAudio />}</center>
          </button>
          <div className="flex flex-col justify-between w-1 pointer-events-none">
            {permissionAudio === 'granted'
              ? <div></div>
              : <div className="bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full" style={{ position: 'relative', right: '7px' }}></div>
            }
            {userStatus.audio
              ? <div></div>
              : <div className="w-8 h-1 bg-red-500 rounded-full rotate-45"
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
            }
          </div>
          <select
            className="w-3.5 h-8 rounded-sm rotate-180"
            value={currentDeviceAudio}
            onChange={e => onChangedDeviceAudio(e.target.value)}
          >
            {deviceAudio.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>
        </section>

        <section className="m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500">
          <button className="text-rose-400 rounded-md w-8 h-8" onClick={async () => {
            setLoadingVideo(true)
            await toggleEnableVideo()
            if (!userStatus.video && virtualBackgroundEnabled) {
              setVirtualBackgroundEnabled(false)
            }
            setLoadingVideo(false)
          }}>
            <center>{loadingVideo ? <Loading /> : <SvgVideo />}</center>
          </button>
          <div className="flex flex-col justify-between w-1 pointer-events-none">
            {permissionVideo === 'granted'
              ? <div></div>
              : <div className="bg-orange-500 shadow-sm w-1 h-1 p-1 rounded-full" style={{ position: 'relative', right: '7px' }}></div>
            }
            {userStatus.video
              ? <div></div>
              : <div className="w-8 h-1 bg-red-500 rounded-full rotate-45"
                style={{
                  position: 'relative',
                  right: '32px',
                  bottom: '14px',
                }}></div>
            }
          </div>
          <select
            className="w-3.5 h-8 rounded-sm rotate-180"
            value={currentDeviceVideo}
            onChange={e => onChangedDeviceVideo(e.target.value)}
          >
            {deviceVideo.map(device =>
              <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
            )}
          </select>
        </section>

        <section className="m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500">
          <button className="text-rose-400 rounded-md w-8 h-8" disabled={!userStatus.video || userStatus.screen} onClick={async () => {
            setLoadingBackground(true)
            await toggleEnableVirtualBackground()
            setVirtualBackgroundEnabled(s => !s)
            setLoadingBackground(false)
          }}>
            <center>
              {loadingBackground
                ? <Loading />
                : virtualBackgroundEnabled ? <SvgBackgroundCancel /> : <SvgBackground />
              }
            </center>
          </button>
        </section>
      </center>
      {!screenShareButtonShowed && (
        <center>
          <section className="m-1 p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500">
            <button className="text-rose-400 rounded-md w-8 h-8" onClick={() => toggleEnableScreen()} disabled={!isScreenShareSupported}>
              <center>
                {loadingScreen
                  ? <Loading />
                  : userStatus.screen ? <SvgPresentCancel /> : <SvgPresentToAll />
                }
              </center>
            </button>
            <div className="w-1"></div>
            <select
              className="w-3.5 h-8 rounded-sm rotate-180"
              value={screenShareResolution}
              onChange={e => onChangeScreenShareResolution(e.target.value)}
              disabled={!isScreenShareSupported}
            >
              {screenResolutions.map(r =>
                <option key={r.label} value={r.value}>{r.label}</option>
              )}
            </select>
          </section>
        </center>
      )}
      <div className="flex flex-row justify-center m-1 p-1 rounded-md border-1 border-indigo-500">
        <button className="flex justify-center items-center text-rose-400 rounded-md w-8 h-8" onClick={() => setIsSetting(true)}>
          <SvgSetting />
        </button>
      </div>
      {isSetting && <Settings onClose={() => setIsSetting(false)} />}
    </div>
  )
}
