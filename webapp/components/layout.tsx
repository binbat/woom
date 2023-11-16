import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import Member from './member'
import WhipPlayer from './player/whip-player'
import WhepPlayer from './player/whep-player'
import DeviceBar from './device'
import { UserStatus, localStreamIdAtom } from '../store/atom'

export default function Layout(props: { meetingId: string }) {
  const [localStreamId] = useAtom(localStreamIdAtom)
  const [remoteUserStatus, setRemoteUserStatus] = useState<{ [_: string]: UserStatus }>({})

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${props.meetingId}`)
    const data = await res.json()
    const r = Object.keys(data)
      .filter(i => i !== localStreamId)
      .filter(i => !!i)
      .reduce((map, i) => {
        map[i] = data[i]
        return map
      }, {} as { [_: string]: UserStatus })
    setRemoteUserStatus(r)
  }

  useEffect(() => {
    const handle = setInterval(refresh, 3000)
    return () => clearInterval(handle)
  }, [])

  return (
    <div className='flex flex-col justify-around' style={{ height: '100vh' }}>

      <center className='text-white'>
        <label>meeting Id: </label><code>{props.meetingId}</code>
        <br />
        <label>Me Id: </label><code>{localStreamId}</code>
      </center>

      <div className='flex flex-row flex-wrap justify-evenly'>
        <WhipPlayer streamId={localStreamId} />
        {Object.keys(remoteUserStatus).map(i => <WhepPlayer key={i} streamId={i} status={remoteUserStatus[i]} />)}
      </div>

      <center>
        <Member />
        <div className='flex justify-evenly bg-gray-800/80'>
          <DeviceBar />
        </div>
      </center>

    </div>
  )
}
