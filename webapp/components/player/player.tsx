import { useEffect, useRef } from 'react'
import { UserStream } from '../../store/atom'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'
import { isWechat } from '../../lib/util'

export default function Player(props: { user: UserStream, muted: boolean, width: string, display: string }) {
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

      // NOTE: About Autoplay
      // Reference: https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide

      // NOTE:
      // iOS Wechat WebView
      // https://developers.weixin.qq.com/community/develop/doc/0006a61de48ab0165f99e1dcd51c00
      if (isWechat()) refVideo.current.play()
    }
  }, [refVideo, props.user.stream]);

  // NOTE: iOS can't display video
  // https://webkit.org/blog/6784/new-video-policies-for-ios/
  return (
    <center className='flex-col' style={{ width: props.width }}>
      <video
        className='rounded-xl'
        playsInline={true}
        autoPlay={true}
        controls={false}
        muted={props.muted}
        ref={refVideo}
        style={!!props.user.stream?.getVideoTracks().length ? { width: props.width } : { height: '0px' }}
      />
      {props.display === "full"
        ? <div className='rounded-xl' ref={refWave}></div>
        : null
      }
    </center>
  )
}
