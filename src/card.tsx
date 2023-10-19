import { isValidElement, useEffect, useRef } from 'react'
import WHEPClient from './lib/whep'
import { useAtom } from 'jotai'
import { meAtom, usersAtom } from './atom'

export default function App(props: { stream: string }) {
  const [me] = useAtom(meAtom)
  const [users, setUsers] = useAtom(usersAtom)

  const refVideo = useRef<HTMLVideoElement>(null)
  //const refElement = useRef<HTMLDivElement>(null)
  const startWhep = async () => {
    const resource = props.stream
    if (!resource) {
      alert("input resource")
      return
    }
    const pc = new RTCPeerConnection();
    pc.addTransceiver('video', { 'direction': 'recvonly' })
    pc.addTransceiver('audio', { 'direction': 'recvonly' })
    pc.ontrack = (event) => {
      console.log(event)
      if (event.track.kind == "video") {

        setUsers([...users, {
          name: props.stream,
          stream: event.streams[0]
        }])

        //if (refVideo.current) {
        //  const videoElement = refVideo.current
        //  videoElement.srcObject = event.streams[0]
        //}
        //refVideo.current?.src = event.streams[0]
        //var el = document.createElement(event.track.kind)
        //el.srcObject = event.streams[0]
        //el.autoplay = true
        //el.controls = true
        ////document.getElementById('remoteVideos').appendChild(el)
        //refElement.current?.appendChild(el)
      }
      if (event.track.kind == "audio") {
        //var el = document.createElement(event.track.kind)
        //el.srcObject = event.streams[0]
        //el.autoplay = true
        //el.controls = true
        ////document.getElementById('remoteVideos').appendChild(el)
        //refElement.current?.appendChild(el)
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
  //<div ref={refElement} />
  //return (
  //  <div
  //    bg="blue-400 hover:blue-500 dark:blue-500 dark:hover:blue-600 w-100px"
  //  >
  //    <video autoPlay={true} controls={true} ref={refVideo} />
  //    <br />
  //    {props.stream === me ? "Me" : props.stream}
  //    <br />
  //    <button onClick={startWhep}>start</button>
  //  </div>
  //)
}
