import React, { useRef } from 'react'
import WHIPClient from './lib/whip'
import { useAtom } from 'jotai'
import { meAtom } from './atom'

export default function App() {
  //const [video, setVideo] = useRef<HTMLVideoElement>()
  const [me] = useAtom(meAtom)

  const start = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })
    const pc = new RTCPeerConnection();
    pc.addTransceiver(stream.getVideoTracks()[0], {
      direction: 'sendonly',
      sendEncodings: [
        { rid: 'a', scaleResolutionDownBy: 2.0 },
        { rid: 'b', scaleResolutionDownBy: 1.0, },
        { rid: 'c' }
      ]
    });
    const whip = new WHIPClient();
    const url = location.origin + `/whip/${me}`
    //const token = document.getElementById("token").value;
    const token = "xxx"
    whip.publish(pc, url, token);
  }

  return (
    <div className='flex justify-evenly' bg="green-400 hover:green-500 ">
      <label>Bar</label>
      <button onClick={() => { start() }}>start video</button>
    </div>
  )
}
