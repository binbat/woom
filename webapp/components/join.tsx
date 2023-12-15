import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import {
  locationAtom,
  meetingIdAtom,
} from '../store/atom'
import { setMeetingId } from '../lib/storage'
import { addSplitSymbol, delSplitSymbol } from '../lib/util'

export default function Join() {
  const [loc, setLoc] = useAtom(locationAtom)

  const [_, setAtomMeetingId] = useAtom(meetingIdAtom)
  const [tmpId, setTmpId] = useState<string>("")

  const newMeeting = async () => {
    let res = await fetch(`/room/`, {
      method: "POST"
    })
    let meetingId = await res.text()
    enterMeeting(meetingId)
  }

  const joinMeeting = async () => {
    let meetingId = tmpId
    await fetch(`/room/${meetingId}`, {
      method: "PATCH"
    })
    enterMeeting(meetingId)
  }

  const enterMeeting = (meetingId: string) => {
    setAtomMeetingId(meetingId)
    setMeetingId(meetingId)
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
            value={addSplitSymbol(tmpId)}
            onChange={e => setTmpId(delSplitSymbol(e.target.value))}
            maxLength={11}
          />
        </div>

        <button className='btn-primary my-2' disabled={!tmpId} onClick={() => { joinMeeting() }}>Join</button>

      </center>

    </div>
  )
}
