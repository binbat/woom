import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'
import { isWechat } from '../../lib/util'
import SvgProgress from '../svg/progress'

function AudioWave(props: { stream: MediaStream }) {
  const refWave = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (refWave.current && !!props.stream?.getAudioTracks().length) {
      const wavesurfer = WaveSurfer.create({
        container: refWave.current,
        waveColor: 'rgb(200, 100, 0)',
        progressColor: 'rgb(100, 50, 0)',
      })

      const record = wavesurfer.registerPlugin(RecordPlugin.create())
      const { onDestroy, onEnd } = record.renderMicStream(props.stream)

      return () => {
        onDestroy()
        onEnd()
        wavesurfer.destroy()
      }
    }
  }, [refWave.current, props.stream])

  return <div ref={refWave}></div>
}

export default function Player(props: { stream: MediaStream, muted: boolean, audio: boolean, video: boolean, width: string }) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [showAudio, setShowAudio] = useState(false)

  useEffect(() => {
    if (props.stream?.getAudioTracks().length !== 0 && props.stream?.getVideoTracks().length === 0) {
      setShowAudio(true)
    } else {
      setShowAudio(false)
    }

  }, [props.stream])

  useEffect(() => {
    if (refVideo.current) {
      refVideo.current.srcObject = props.stream

      // NOTE: About Autoplay
      // Reference: https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide

      // NOTE:
      // iOS Wechat WebView
      // https://developers.weixin.qq.com/community/develop/doc/0006a61de48ab0165f99e1dcd51c00
      if (isWechat()) refVideo.current.play()
    }
  }, [refVideo, props.stream])

  // NOTE: iOS can't display video
  // https://webkit.org/blog/6784/new-video-policies-for-ios/
  return (
    <center className='flex flex-col justify-center min-h-60' style={{ width: props.width }}>
      {!props.stream.getTracks().length ? <center><SvgProgress/></center> : null}
      {props.video
        ? <video
          className='rounded-xl'
          playsInline={true}
          autoPlay={true}
          controls={false}
          muted={props.muted}
          ref={refVideo}
          style={!!props.stream?.getVideoTracks().length ? { width: props.width } : { height: '0px' }}
        />
        : null
      }
      {!props.video || showAudio
        ? <AudioWave stream={props.stream} />
        : null
      }
    </center>
  )
}
