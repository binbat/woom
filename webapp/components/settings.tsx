import { useAtom } from 'jotai'
import { useState } from 'react'
import { deviceNone } from '../lib/device'
import {
  languageAtom,
  videoResolutionAtom,
  screenShareResolutionAtom,
  meetingIdAtom,
  settingsEnabledScreenAtom,
} from './../store/atom'

import {
  SvgClose,
  SvgGeneral,
  SvgMedia,
  SvgAdvanced,
  SvgTip,
} from './svg/setting'
import { delStorage } from '../lib/storage'

function SettingGeneral() {
  const [language, setLanguage] = useAtom(languageAtom)
  const languageOptions = ['English']
  const onChangeLanguage = (language: string) => {
    setLanguage(language)

    // todo: add support of more languages
  }
  return (
    <div className="flex flex-row justify-between hover:bg-blue-200 rounded p-3 space-x-1">
      <p className="text-base font-semibold p-1">
        Language
      </p>
      <select
        className="text-base bg-gray-200 rounded p-1"
        value={language}
        onChange={e => onChangeLanguage(e.target.value)}
      >
        {languageOptions.map(option => (
          <option
            key={option}
            value={option}
          >
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

function SettingMedia(props: { isScreenSharing: boolean, onChangedDeviceVideo: (current: string, constraints?: MediaTrackConstraints) => void }) {
  const [videoResolution, setVideoResolution] = useAtom(videoResolutionAtom)
  const [screenShareResolution, setScreenShareResolution] = useAtom(screenShareResolutionAtom)
  const [isTipShowed, setIsTipShowed] = useState(false)
  const videoResolutionOptions = [
    { label: '480p (Default)', value: '480' },
  ]
  const screenShareResolutionOptions = [
    { label: '720p (Default)', value: '720' },
    { label: '1080p', value: '1080' },
    { label: 'Native', value: 'native' }
  ]
  const onChangeVideoResolution = (resolution: string) => {
    setVideoResolution(resolution)

    // todo: add support of more video resolutions
  }
  const onChangeScreenShareResolution = async (resolution: string) => {
    setScreenShareResolution(resolution)
    if (props.isScreenSharing) props.onChangedDeviceVideo(deviceNone.deviceId)
  }
  return (
    <div className="flex flex-col space-y-2">
      <div className="flex flex-row justify-between hover:bg-blue-200 rounded p-3 space-x-1">
        <p className="text-base font-semibold p-1">
          Video Resolution
        </p>
        <select
          className="bg-gray-200 rounded max-w-[50%] ml-2 p-1"
          value={videoResolution}
          onChange={e => onChangeVideoResolution(e.target.value)}
        >
          {videoResolutionOptions.map(option => (
            <option
              key={option.label}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="hover:bg-blue-200 rounded p-3 ">
        <div className="flex flex-row justify-between space-x-1">
          <div className="flex flex-row items-center space-x-1 pr-3">
            <p className="text-base font-semibold p-1">
              Screen Share Resolution
            </p>
            <div
              className={`relative ${
                isTipShowed ? 'text-blue' : 'text-black'
              }`}
              onMouseEnter={() => setIsTipShowed(true)}
              onMouseLeave={() => setIsTipShowed(false)}
            >
              <SvgTip />
              {isTipShowed && (
                <div className="absolute top-full mt-3 z-10 hidden md:block">
                  <div className="absolute -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-black"></div>
                </div>
              )}
            </div>
          </div>
          <select
            className="bg-gray-200 rounded max-w-[50%] ml-2 p-1"
            value={screenShareResolution}
            onChange={e => onChangeScreenShareResolution(e.target.value)}
          >
            {screenShareResolutionOptions.map(option => (
              <option
                key={option.label}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex justify-start items-center px-3">
          {isTipShowed && (
            <div className="flex flex-col items-start absolute top-1 bg-black text-white text-sm px-3 py-1 rounded shadow-lg w-max max-w-[90%]">
              <p>
                1. Meaningless for mobile devices;
              </p>
              <p>
                2. If screen is sharing, any changes on this property will stop sharing.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingAdvanced() {
  const [isTipShowed, setIsTipShowed] = useState(false)
  const [isTipShowed2, setIsTipShowed2] = useState(false)
  const [meetingId] = useAtom(meetingIdAtom)
  const [settingsEnabledScreen, setsettingsEnabledScreen] = useAtom(settingsEnabledScreenAtom)
  const [isReset, setIsReset] = useState(false)

  return (
    <div className="flex flex-col space-y-2">
      <div className="hover:bg-blue-200 rounded p-3">
        <div className="flex flex-row justify-between space-x-1">
          <div className="flex flex-row items-center space-x-1 pr-3">
            <p className="text-base font-semibold p-1">
              Local Storage
            </p>
            <div
              className={`relative ${
                isTipShowed ? 'text-blue' : 'text-black'
              }`}
              onMouseEnter={() => setIsTipShowed(true)}
              onMouseLeave={() => setIsTipShowed(false)}
            >
              <SvgTip />
              {isTipShowed && (
                <div className="absolute top-full mt-3 z-10 hidden md:block">
                  <div className="absolute z-50 -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-black"></div>
                </div>
              )}
            </div>
          </div>
          <button
            className="bg-blue-400 disabled:bg-gray-400 rounded text-white max-w-[50%] ml-2 px-2"
            disabled={isReset || !!meetingId}
            onClick={() => {
              delStorage()
              setIsReset(true)
            }}
          >
            Reset
          </button>
        </div>
        <div className="relative flex justify-start items-center px-3">
          {isTipShowed && (
            <div className="flex flex-col items-start absolute z-50 top-1 bg-black text-white text-sm px-3 py-1 rounded shadow-lg w-max max-w-[90%]">
              <p>
                1. Local storage only can be reset on the homepage.
              </p>
              <p>
                2. Single use only.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="hover:bg-blue-200 rounded p-3">
        <div className="flex flex-row justify-between space-x-1">
          <div className="flex flex-row items-center space-x-1 pr-3">
            <label className="flex flex-row items-center text-base font-semibold p-1 space-x-1">
              <input
                className="form-checkbox h-4 w-4"
                type="checkbox"
                checked={settingsEnabledScreen}
                disabled={!!meetingId}
                onChange={e => setsettingsEnabledScreen(e.target.checked)}
              />
              <p>
                Hide Share Screen Button
              </p>
            </label>
            <div
              className={`relative ${
                isTipShowed2 ? 'text-blue' : 'text-black'
              }`}
              onMouseEnter={() => setIsTipShowed2(true)}
              onMouseLeave={() => setIsTipShowed2(false)}
            >
              <SvgTip />
              {isTipShowed2 && (
                <div className="absolute top-full mt-3 z-10 hidden md:block">
                  <div className="absolute z-50 -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-black"></div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="relative flex justify-start items-center px-3">
          {isTipShowed2 && (
            <div className="flex flex-col items-start absolute z-50 top-1 bg-black text-white text-sm px-3 py-1 rounded shadow-lg w-max max-w-[90%]">
              <p>
                1. Defaults to checked on mobile devices;
              </p>
              <p>
                2. Changable only on the homepage.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Settings(props: { onClose: () => void, onChangedDeviceVideo: (current: string, constraints?: MediaTrackConstraints) => void, isScreenSharing: boolean }) {
  const [activeTab, setActiveTab] = useState('General')
  const settingsOptions = [
    { label: 'General', icon: SvgGeneral },
    { label: 'Media', icon: SvgMedia },
    { label: 'Advanced', icon: SvgAdvanced }
  ]
  return (
    <div className="fixed inset-0 z-50 lg:flex lg:justify-center lg:items-center bg-black bg-opacity-80">
      <div className="flex flex-col bg-white w-screen h-screen lg:w-[65%] lg:h-[60%] 2xl:w-[50%] 2xl:h-[60%] lg:rounded-xl">
        <div className="relative flex flex-row justify-center items-center border-b-1 border-gray-200 py-1">
          <h1 className="text-2xl font-semibold text-gray-400">Settings</h1>
          <button className="absolute right-0 bg-transparent px-1 text-gray-400" onClick={() => props.onClose()}>
            <SvgClose />
          </button>
        </div>
        <div className="flex flex-row flex-grow-1">
          <nav className="w-[20%] border-r p-1 space-y-1 overflow-y-auto">
            {settingsOptions.map(({label, icon: Icon}) => (
              <div
                key={label}
                onClick={() => setActiveTab(label)}
                className={`flex flex-row justify-center md:justify-start text-base cursor-pointer px-2 py-2 rounded space-x-2 ${
                  activeTab === label ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                }`}
              >
                <Icon />
                <p className="hidden md-block">
                  {label}
                </p>
              </div>
            ))}
          </nav>
          <main className="w-[80%] p-1 overflow-auto">
            <h2 className="text-xl text-center font-bold my-4">{activeTab}</h2>
            {activeTab === 'General' && <SettingGeneral />}
            {activeTab === 'Media' && <SettingMedia onChangedDeviceVideo={props.onChangedDeviceVideo} isScreenSharing={props.isScreenSharing}/>}
            {activeTab === 'Advanced' && <SettingAdvanced />}
          </main>
        </div>
      </div>
    </div>
  )
}
