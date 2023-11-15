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

  const joinMeeting = async () => {
    let meetingId: string
    if (!tmpId) {
      let res = await fetch(`/room/`, {
        method: "POST"
      })
      meetingId = await res.text()
    } else {
      let res = await fetch(`/room/${tmpId}`, {
        method: "PATCH"
      })
      meetingId = tmpId
    }
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
    <div className='flex flex-col justify-around bg-gray-800 p-6 my-4'>
      <center>

        <div className='m-6'>
          <label className='text-white'>meeting id: </label>
          <input
            className='text-center'
            value={addSplitSymbol(tmpId)}
            onChange={e => setTmpId(delSplitSymbol(e.target.value))}
            maxLength={11}
          />
        </div>

      </center>

      <center>
        <button className='btn-primary' onClick={() => { joinMeeting() }}>Join Meeting</button>
      </center>

    </div>
  )
}
