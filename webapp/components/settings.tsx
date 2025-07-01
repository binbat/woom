import { useAtom } from 'jotai'
import { useState } from 'react'
import { meetingIdAtom } from './../store/atom'

import {
  SvgClose,
  SvgGeneral,
  SvgMedia,
  SvgAdvanced,
  SvgTip,
} from './svg/setting'
import { delStorage } from '../lib/storage'
import { useSettingStore } from '../store/settingStore'

interface SettingsProps {
  onClose: () => void
}

interface SettingItemProps {
  children?: React.ReactNode;
  label: string;
  tooltips?: string[];
}

function SettingItem(props: SettingItemProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  return (
    <div className="hover:bg-blue-200 rounded p-3">
      <div className="flex flex-row justify-between space-x-1 items-center">
        <div className="flex flex-row justify-start items-center space-x-1 pr-3 max-w-[50%]">
          <label className="text-base font-semibold p-1 text-left w-max">
            {props.label}
          </label>
          {props.tooltips && (
            <div
              className={`relative ${
                tooltipVisible ? 'text-blue' : 'text-black'
              }`}
              onMouseEnter={() => setTooltipVisible(true)}
              onMouseLeave={() => setTooltipVisible(false)}
            >
              <SvgTip />
              {tooltipVisible && (
                <div className="absolute top-full mt-3 z-10 hidden md:block">
                  <div className="absolute z-50 -top-2 border-l-8 border-r-8 border-b-8 border-transparent border-b-black"></div>
                </div>
              )}
            </div>
          )}
        </div>
        {props.children}
      </div>
      {props.tooltips && tooltipVisible && (
        <div className="relative flex justify-start items-center px-3">
          <div className="flex flex-col items-start absolute z-50 top-1 bg-black text-white text-sm px-3 py-1 space-y-1 rounded shadow-lg w-max max-w-[90%]">
            {props.tooltips.map((tip, index) => (
              <p
                className="text-left"
                key={index}
              >
                {tip}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SettingGeneral() {
  const language = useSettingStore(state => state.language)
  const setLanguage = useSettingStore(state => state.setLanguage)
  const languageOptions = ['English']
  const onChangeLanguage = (language: string) => {
    setLanguage(language)

    // todo: add support of more languages
  }
  return (
    <div className="flex flex-col space-y-2">
      <SettingItem label="Language">
        <select
          className="bg-gray-200 rounded max-w-[50%] ml-2 p-1"
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
      </SettingItem>
    </div>
  )
}

function SettingMedia() {
  const videoResolution = useSettingStore(state => state.videoResolution)
  const setVideoResolution = useSettingStore(state => state.setVideoResolution)
  const screenShareResolution = useSettingStore(state => state.screenShareResolution)
  const setScreenShareResolution = useSettingStore(state => state.setScreenShareResolution)
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
  }
  return (
    <div className="flex flex-col space-y-2">
      <SettingItem label="Video Resolution">
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
      </SettingItem>
      <SettingItem label="Screen Share Resolution" tooltips={[
        '1. Meaningless for mobile devices;',
        '2. If screen is sharing, any changes on this property will stop sharing.'
      ]}>
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
      </SettingItem>
    </div>
  )
}

function SettingAdvanced() {
  const [meetingId] = useAtom(meetingIdAtom)
  const screenShareButtonShowed = useSettingStore(state => state.screenShareButtonShowed)
  const setScreenShareButtonShowed = useSettingStore(state => state.setScreenShareButtonShowed)
  const [isReset, setIsReset] = useState(false)

  return (
    <div className="flex flex-col space-y-2">
      <SettingItem label="Local Storage" tooltips={[
        '1. Local storage only can be reset on the homepage;',
        '2. Single use only;',
        '3. Not used to restore settings.'
      ]}>
        <button
          className="bg-blue-400 disabled:bg-gray-400 rounded text-white max-w-[50%] ml-2 py-1 px-2"
          disabled={isReset || !!meetingId}
          onClick={() => {
            delStorage()
            setIsReset(true)
          }}
        >
          Reset
        </button>
      </SettingItem>
      <SettingItem label="Hide Share Screen Button" tooltips={[
        '1. Defaults to checked on mobile devices;',
        '2. This button is diabled on mobile devices even though it is showed.'
      ]}>
        <button
          onClick={() => setScreenShareButtonShowed(!screenShareButtonShowed)}
          className={`relative flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${
            screenShareButtonShowed ? 'bg-blue-400' : 'bg-gray-300'
          }`}
        >
          <span
            className={`h-4 w-5 transform rounded-full bg-white transition-transform duration-300 ${
              screenShareButtonShowed ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </SettingItem>
    </div>
  )
}

export default function Settings(props: SettingsProps) {
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
            {activeTab === 'Media' && <SettingMedia />}
            {activeTab === 'Advanced' && <SettingAdvanced />}
          </main>
        </div>
      </div>
    </div>
  )
}
