import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import {
  localStreamAtom,
  peerConnectionAtom,
} from '../../store/atom'
import Player from './player'
import WHIPClient from '../../lib/whip'

export default function WhipPlayer(props: { streamId: string }) {
  const refEnabled = useRef(false)
  const [localStream, setLocalStream] = useAtom(localStreamAtom)
  const [peerConnection] = useAtom(peerConnectionAtom)

  const start = async () => {
    const stream = localStream.stream
    if (stream) {

      //const pc = new RTCPeerConnection();
      const trans = peerConnection.current.addTransceiver(stream.getVideoTracks()[0], {
        direction: 'sendonly',
        //sendEncodings: [
        //  { rid: 'a', scaleResolutionDownBy: 2.0 },
        //  { rid: 'b', scaleResolutionDownBy: 1.0, },
        //  { rid: 'c' }
        //]
      });

      const whip = new WHIPClient();
      const url = location.origin + `/whip/${props.streamId}`
      const token = "xxx"
      await whip.publish(peerConnection.current, url, token);
    }
  }

  useEffect(() => {
    if (!refEnabled.current) {
      refEnabled.current = true
      start()
    }
  }, [])

  return (
    <Player user={localStream} />
  )
}
