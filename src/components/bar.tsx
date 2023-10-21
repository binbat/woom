import { useState } from 'react'
import WHIPClient from '../lib/whip'
import { useAtom } from 'jotai'
import DeviceBar from './device'
import {
  meAtom,
  usersAtom,
  currentDeviceAudioAtom,
  currentDeviceVideoAtom,
} from '../store/atom'

export default function App() {
  return (
    <div className='flex justify-evenly' bg="green-400 hover:green-500 ">
      <label>Bar</label>
      <DeviceBar />
    </div>
  )
}
