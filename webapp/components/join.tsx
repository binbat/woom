import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import {
  locationAtom,
  meetingIdAtom,
} from '../store/atom'
import { getStorage, setStorage, delStorage, setStorageStream, setStorageMeeting } from '../lib/storage'
import { newRoom, newUser, setApiToken, setRoomId } from '../lib/api'

export default function Join() {
  const [loc, setLoc] = useAtom(locationAtom)
  const [__, setAtomMeetingId] = useAtom(meetingIdAtom)
  const [tmpId, setTmpId] = useState<string>("")

  const getLoginStatus = async () => {
    const user = getStorage()
    if (!user.token || !user.stream) {
      const res = await newUser()
      user.token = res.token,
      user.stream = res.streamId,
      setStorage(user)
    }

    setApiToken(user.token)
    if (user.stream) setStorageStream(user.stream)
  }

  const newMeeting = async () => {
    await getLoginStatus()
    let meetingId = (await newRoom()).roomId
    enterMeeting(meetingId)
  }

  const joinMeeting = async () => {
    await getLoginStatus()
    let meetingId = tmpId
    //await fetch(`/room/${meetingId}`, {
    //  method: "PATCH"
    //})
    enterMeeting(meetingId)
    setRoomId(meetingId)
  }

  const enterMeeting = (meetingId: string) => {
    setStorageMeeting(meetingId)
    setAtomMeetingId(meetingId)
    setLoc(prev => ({ ...prev, pathname: `/${meetingId}` }))
  }

  useEffect(() => {
    const id = loc.pathname?.replace("/", "")
    if (id) {
      setTmpId(id)
    }
  }, [location])

  return (
    <div className='flex flex-col justify-around bg-gray-800/80 p-6 my-4'>
      <center className='flex flex-row flex-wrap justify-center'>
        <button className='btn-primary my-2' disabled={!!tmpId} onClick={() => { newMeeting() }}>New Meeting</button>
        <div className='mx-2 my-2'>
          <input
            className='text-center text-4xl'
            placeholder='Enter Meeting id'
            value={tmpId}
            onChange={e => setTmpId(e.target.value)}
            maxLength={11}
          />
        </div>

        <button className='btn-primary my-2' disabled={!tmpId} onClick={() => { joinMeeting() }}>Join</button>
      </center>
      <center className='flex flex-row flex-wrap justify-center text-white'>
        <p>If have some problems, Please click this:</p>
        <a className='mx-2 text-red-300 underline' onClick={delStorage}>Reset</a>
      </center>
    </div>
  )
}
