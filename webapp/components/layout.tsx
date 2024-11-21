import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import Player from './player/player'
import WhipPlayer from './player/whip-player'
import WhepPlayer from './player/whep-player'
import DeviceBar from './device'
import {
  UserStatus,
  enabledPresentationAtom,
  meetingJoinedAtom,
  presentationStreamAtom,
} from '../store/atom'
import copy from 'copy-to-clipboard'
import SvgDone from './svg/done'
import SvgEnd from './svg/end'
import { getRoom, delStream, Stream } from '../lib/api'
import { getStorageStream } from '../lib/storage'

export default function Layout(props: { meetingId: string }) {
  const [copyStatus, setCopyStatus] = useState(false)
  const [_, setMeetingJoined] = useAtom(meetingJoinedAtom)

  const localStreamId = getStorageStream()
  const [remoteUserStatus, setRemoteUserStatus] = useState<Record<string, UserStatus>>({})

  //const [speaker, setSpeaker] = useState<UserStatus | null>(null)
  //const [speakerId, setSpeakerId] = useState<string>("")
  const [enabledPresentation] = useAtom(enabledPresentationAtom)
  const [presentationStream] = useAtom(presentationStreamAtom)

  const refresh = async () => {
    const data = (await getRoom(props.meetingId)).streams
    const r = Object.keys(data)
      .filter(i => i !== localStreamId)
      .filter(i => !!i)
      .reduce((map, i) => {
        map[i] = data[i]
        return map
      }, {} as { [_: string]: Stream })
    setRemoteUserStatus(r)
  }

  const callEnd = async () => {
    delStream(props.meetingId, localStreamId)

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
    <div className="flex flex-col justify-between" style={{ height: '100vh' }}>
      <div></div>

      {enabledPresentation
        ? <Player stream={presentationStream.stream} muted={true} width="auto" />
        : null
      }

      <div className="flex flex-row flex-wrap justify-evenly">
        <WhipPlayer streamId={localStreamId} width="320px" />
        {Object.keys(remoteUserStatus).map(i => <WhepPlayer key={i} streamId={i} userStatus={remoteUserStatus[i]} width="320px" />)}
      </div>

      <center>
        <div className="flex justify-evenly bg-gray-800/80">
          <section className="hidden md:flex md:flex-col md:justify-center">
            <button className="flex flex-row text-rose-400 rounded-md bg-inherit p-2" onClick={() => {
              copy(location.href)
              setCopyStatus(true)
              setTimeout(() => setCopyStatus(false), 3000)
            }}>
              <code className="mx-sm my-1px">{props.meetingId}</code>
              <center className="text-rose-400 rounded-md" style={{ visibility: copyStatus ? 'visible' : 'hidden' }} >
                <SvgDone />
              </center>
            </button>
          </section>

          <DeviceBar streamId={localStreamId} />

          <section className="flex flex-col justify-center">
            <button className="text-white bg-rose-600 hover:bg-rose-700 duration-1000 shadow-xl rounded-3xl w-18 h-10" onClick={() => callEnd()}>
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
