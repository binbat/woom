import { useRef } from 'react'
import { useAtom } from 'jotai'
import { User, localStreamIdAtom } from '../store/atom'

export default function App(props: { user: User }) {
  const [me] = useAtom(localStreamIdAtom)
  const refVideo = useRef<HTMLVideoElement>(null)

  if (refVideo.current) {
    refVideo.current.srcObject = props.user.stream
  }

  return (
    <div>
      {props.user.stream
        ? <video className='rounded-xl' autoPlay={true} controls={false} style={{ width: '640px' }} ref={refVideo} />
        : null
      }
      <br />
      {props.user.name === me ? "Me" : props.user.name}
    </div>
  )
}
