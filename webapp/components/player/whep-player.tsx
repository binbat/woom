import { useEffect, useRef } from 'react'
import useWhepClient from '../use/whep'
import { useAtom } from 'jotai'
import Detail from './detail'
import Player from './player'
import { presentationStreamAtom } from '../../store/atom'
import { Stream } from '../../lib/api'

export default function WhepPlayer(props: { streamId: string, userStatus: Stream, width: string }) {
  const refEnabled = useRef(false)
  const { stream, restart, start, connStatus, setRemoteStatus } = useWhepClient(props.streamId)
  const [presentationStream, setPresentationStream] = useAtom(presentationStreamAtom)
  const refPresentationStream = useRef(presentationStream)
  refPresentationStream.current = presentationStream

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
    // remove "presentation stream" when sharing user exits
    // TODO: manage users entering/exiting globally
    return () => {
      const selfStreamName = `${props.userStatus.name}_Presentation`
      if (refPresentationStream.current.name === selfStreamName) {
        setPresentationStream({
          name: '',
          stream: new MediaStream(),
        })
      }
    }
  }, [])

  useEffect(() => {
    setRemoteStatus(props.userStatus)
  }, [props.userStatus])

  useEffect(() => {
    // set/clear "presentation stream" when remote user starts/stops sharing
    const selfStreamName = `${props.userStatus.name}_Presentation`
    if (props.userStatus.screen && refPresentationStream.current.stream !== stream) {
      setPresentationStream({
        name: selfStreamName,
        stream: stream,
      })
    } else if (!props.userStatus.screen && refPresentationStream.current.name === selfStreamName) {
      setPresentationStream({
        name: '',
        stream: new MediaStream(),
      })
    }
  }, [props.userStatus.screen, stream])

  return (
    <center className="relative flex flex-col">
      <Player stream={stream} muted={false} width={props.width} audio={props.userStatus.audio} video={props.userStatus.video && !props.userStatus.screen} self={false} />
      <Detail streamId={props.streamId} connStatus={connStatus} userStatus={props.userStatus} restart={restart} />
    </center>
  )
}
