import { useEffect, useRef } from 'react'
import { UserStream } from '../../store/atom'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'

export default function Player(props: { user: UserStream, muted: boolean }) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const refWave = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (refWave.current && !!props.user.stream?.getAudioTracks().length) {
      const wavesurfer = WaveSurfer.create({
        container: refWave.current,
        waveColor: 'rgb(200, 100, 0)',
        progressColor: 'rgb(100, 50, 0)',
      })

      const record = wavesurfer.registerPlugin(RecordPlugin.create())
      const { onDestroy, onEnd } = record.renderMicStream(props.user.stream)

      return () => {
        onDestroy()
        onEnd()
        wavesurfer.destroy()
      }
    }
  }, [refWave.current, props.user.stream])

  useEffect(() => {
    if (refVideo.current) {
      refVideo.current.srcObject = props.user.stream
    }
  }, [refVideo, props.user.stream]);

  // NOTE: iOS can't display video
  // https://webkit.org/blog/6784/new-video-policies-for-ios/
  return (
    <div className='flex-col'>
      {props.user.stream
        ? <video className='rounded-xl' playsInline={true} autoPlay={true} controls={false} muted={props.muted} style={{ width: '320px' }} ref={refVideo} />
        : null
      }
      <div className='rounded-xl' ref={refWave}></div>
      <center className='text-white'>
        {props.user.name}
      </center>
    </div>
  )
}
