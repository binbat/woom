import { useRef } from 'react'
import { useAtom } from 'jotai'
import { User, meAtom } from './atom'

export default function App(props: { user: User }) {
  const [me] = useAtom(meAtom)
  const refVideo = useRef<HTMLVideoElement>(null)

  if (refVideo.current) {
    refVideo.current.srcObject = props.user.stream
  }

  return (
    <div
      bg="blue-400 hover:blue-500 dark:blue-500 dark:hover:blue-600 w-100px"
    >
      {props.user.stream
        ? <video autoPlay={true} controls={true} ref={refVideo} />
        : null
      }
      <br />
      {props.user.name === me ? "Me" : props.user.name}
    </div>
  )
}
