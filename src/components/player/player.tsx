import { useEffect, useRef } from 'react'
import { UserStream } from '../../store/atom'

export default function Player(props: { user: UserStream, muted: boolean }) {
  const refVideo = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (refVideo.current) {
      refVideo.current.srcObject = props.user.stream
    }
  }, [refVideo, props.user.stream]);

  return (
    <div className='flex-col'>
      {props.user.stream
        ? <video className='rounded-xl' autoPlay={true} controls={false} muted={props.muted} style={{ width: '640px' }} ref={refVideo} />
        : null
      }
      <center className='text-white'>
        {props.user.name}
      </center>
    </div>
  )
}
