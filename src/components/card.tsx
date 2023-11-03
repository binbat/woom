import { useEffect } from 'react'
import WHEPClient from '../lib/whep'
import { useAtom } from 'jotai'
import { localStreamIdAtom, remoteStreamsAtom } from '../store/atom'

export default function App(props: { stream: string }) {
  const [me] = useAtom(localStreamIdAtom)
  if (!props.stream) return <></>
  if (props.stream === me) return <></>
  const [users, setUsers] = useAtom(remoteStreamsAtom)

  const startWhep = async () => {
    const resource = props.stream
    const pc = new RTCPeerConnection();
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = (event) => {
      if (event.track.kind == "video") {
        setUsers([...users, {
          name: props.stream,
          stream: event.streams[0]
        }])
      }
      if (event.track.kind == "audio") {
      }
    }
    const whep = new WHEPClient();
    const url = location.origin + "/whep/" + resource;
    //const token = document.getElementById("token").value;
    const token = "xxx"
    whep.view(pc, url, token);
  }

  useEffect(() => { startWhep() }, [props.stream])

  return (<></>)
}
