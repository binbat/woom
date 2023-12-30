import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import Member from './member'
import Player from './player/player'
import WhipPlayer from './player/whip-player'
import WhepPlayer from './player/whep-player'
import DeviceBar from './device'
import {
  UserStatus,
  enabledPresentationAtom,
  localStreamIdAtom,
  meetingJoinedAtom,
  presentationStreamAtom,
} from '../store/atom'
import copy from 'copy-to-clipboard'
import SvgDone from './svg/done'
import SvgEnd from './svg/end'

export default function Layout(props: { meetingId: string }) {
  const [copyStatus, setCopyStatus] = useState(false)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const [localStreamId] = useAtom(localStreamIdAtom)
  const [remoteUserStatus, setRemoteUserStatus] = useState<{ [_: string]: UserStatus }>({})

  //const [speaker, setSpeaker] = useState<UserStatus | null>(null)
  //const [speakerId, setSpeakerId] = useState<string>("")
  const [enabledPresentation] = useAtom(enabledPresentationAtom)
  const [presentationStream] = useAtom(presentationStreamAtom)

  const refresh = async () => {
    let res = await fetch(location.origin + `/room/${props.meetingId}`)
    const data = (await res.json()).streams
    const r = Object.keys(data)
      .filter(i => i !== localStreamId)
      .filter(i => !!i)
      .reduce((map, i) => {
        map[i] = data[i]
        return map
      }, {} as { [_: string]: UserStatus })
    setRemoteUserStatus(r)
  }

  const callEnd = async () => {
    await fetch(`/room/${props.meetingId}/stream/${localStreamId}`, {
      method: "DELETE"
    })

    setMeetingJoined(false)
  }

  //useEffect(() => {
  //  let shareScreenId = ""
  //  const setShareScreenId = (id: string) => shareScreenId = id
  //  Object.keys(remoteUserStatus).map(i => remoteUserStatus[i].screen && setShareScreenId(i))
  //  if (!shareScreenId) {
  //    setSpeakerId("")
  //    setSpeaker(null)
  //  } else {
  //    setSpeakerId(shareScreenId)
  //    setSpeaker(remoteUserStatus[shareScreenId])
  //  }
  //}, [remoteUserStatus])

  useEffect(() => {
    const handle = setInterval(refresh, 3000)
    return () => clearInterval(handle)
  }, [])

  return (
    <div className='flex flex-col justify-between' style={{ height: '100vh' }}>
      <div></div>

      { enabledPresentation
        ? <Player user={presentationStream} muted={true} width="auto" display="auto" />
        : null
      }

      <div className='flex flex-row flex-wrap justify-evenly'>
        <WhipPlayer streamId={localStreamId} width="320px" />
        {Object.keys(remoteUserStatus).map(i => <WhepPlayer key={i} streamId={i} status={remoteUserStatus[i]} width="320px" />)}
      </div>

      <center>
        <Member />
        <div className='flex justify-evenly bg-gray-800/80'>
          <section className='m-sm p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
            <button className='rounded-md' onClick={() => copy(location.href) && setCopyStatus(true)}>
              <code className='mx-xs'>{props.meetingId}</code>
            </button>
            {copyStatus
              ? <center className='m-1.5 bg-indigo-200 rounded-md'>
                <SvgDone />
              </center>
              : null
            }
          </section>

          <DeviceBar />

          <section className='m-sm p-1 flex flex-row justify-center rounded-md border-1 border-indigo-500'>
            <button className='rounded-md w-12 h-9' onClick={() => callEnd()}>
              <center>
                <SvgEnd />
              </center>
            </button>
          </section>

        </div>
      </center>

    </div>
  )
}
