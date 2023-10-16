import { useState } from 'react'
import { useAtom } from 'jotai'
import { meAtom, meetingIdAtom } from './atom'

export default function App() {
  const [me] = useAtom(meAtom)
  const [_, setMeetingId] = useAtom(meetingIdAtom)
  const [tmpId, setTmpId] = useState<string>("")

  const startMeeting = async () => {
    if (!tmpId) {
      let res = await fetch(location.origin + `/room/?uuid=${me}`, {
        method: "POST"
      })
      setMeetingId(await res.text())
    } else {
      let res = await fetch(location.origin + `/room/${tmpId}?uuid=${me}`, {
        method: "PATCH"
      })
      setMeetingId(tmpId)
    }
  }

  return (
    <div className='flex justify-evenly' bg="green-400 hover:green-500 ">
      <label>Welcome</label>

      <div>
        <label>Your stream id: </label>
        <code>{me}</code>
      </div>

      <div>
        <label>meeting id: </label>
        <input
          value={tmpId}
          onChange={e => setTmpId(e.target.value)}
        />
      </div>

      <button onClick={() => { startMeeting() }}>start meeting</button>
    </div>
  )
}
