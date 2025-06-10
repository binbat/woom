import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'
import { isWechat } from '../../lib/util'
import SvgProgress from '../svg/progress'
import { deviceSpeakerAtom, speakerStatusAtom } from '../../store/atom'
import {
  SvgMuted,
  SvgUnmuted,
  SvgFullscreen,
  SvgExitFullscreen,
  SvgPictureInPicture,
  SvgExitPictureInPicture,
} from '../svg/player'

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
      const { onDestroy, onEnd } = record.renderMicStream(new MediaStream(props.stream.getAudioTracks()))

      return () => {
        onDestroy()
        onEnd()
        wavesurfer.destroy()
      }
    }
  }, [refWave.current, props.stream])

  return <div ref={refWave}></div>
}

export default function Player(props: { stream: MediaStream, muted: boolean, audio?: boolean, video?: boolean, width: string }) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const [showAudio, setShowAudio] = useState(false)
  const audioTrack = props.stream.getAudioTracks()[0]
  const videoTrack = props.stream.getVideoTracks()[0]
  const [currentDeviceSpeaker] = useAtom(deviceSpeakerAtom)
  const [speakerStatus] = useAtom(speakerStatusAtom)
  const refPlayPromise = useRef<Promise<void> | null>(null)
  const refControls = useRef<HTMLDivElement>(null)
  const [showControls, setShowControls] = useState(false)
  const refTimeoutId = useRef<NodeJS.Timeout | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreened, setIsFullscreened] = useState(false)
  const [isPictureInPictured, setIsPictureInPictured] = useState(false)

  const handleMouseMove = () => {
    setShowControls(true)
    if (refTimeoutId.current) clearTimeout(refTimeoutId.current)
    const newTimeout = setTimeout(() => {
      setShowControls(false)
    }, 2000)
    refTimeoutId.current = newTimeout
  }

  const toggleMute = () => isMuted ? setIsMuted(false) : setIsMuted(true)

  const isFullscreenSupported = () => {
    const container = refVideo.current?.parentElement
    return (
      typeof document.exitFullscreen === 'function' &&
    typeof container?.requestFullscreen === 'function'
    )
  }

  const toggleFullscreen = () => {
    const container = refVideo.current!.parentElement!
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
  }

  const isPictureInPictureSupported = () => {
    const container = refVideo.current!
    return (
      typeof document.exitPictureInPicture === 'function' &&
    typeof container?.requestPictureInPicture === 'function'
    )
  }

  const togglePictureInPicture = () => {
    const container = refVideo.current!
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture()
    } else {
      container.requestPictureInPicture()
    }
  }

  useEffect(() => {
    const onFullScreenChange = () => document.fullscreenElement ? setIsFullscreened(true) : setIsFullscreened(false)
    if (isFullscreenSupported()) document.addEventListener('fullscreenchange', onFullScreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreenChange)
    }
  }, [])

  useEffect(() => {
    const onEnterPictureInPicture = () => setIsPictureInPictured(true)
    const onLeavePictureInPicture = () => setIsPictureInPictured(false)
    const video = refVideo.current
    if (isPictureInPictureSupported()) {
      video?.addEventListener('enterpictureinpicture', onEnterPictureInPicture)
      video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture)
    }
    return () => {
      video?.removeEventListener('enterpictureinpicture', onEnterPictureInPicture)
      video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture)
    }
  }, [])

  useEffect(() => {
    const container = refControls.current?.parentElement
    container?.addEventListener('mousemove', handleMouseMove)
    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  useEffect(() => {
    setIsMuted(!speakerStatus)
  }, [speakerStatus])

  useEffect(() => {
    const video = refVideo.current
    const onVolumeChange = () => video!.muted ? setIsMuted(true) : setIsMuted(false)
    video?.addEventListener('volumechange', onVolumeChange)
    return () => {
      video?.removeEventListener('volumechange', onVolumeChange)
    }
  }, [])

  useEffect(() => {
    if (audioTrack && !videoTrack) {
      setShowAudio(true)
    } else {
      setShowAudio(false)
    }
    if (!props.audio) setIsMuted(true)
    if (audioTrack && props.audio) {
      const el = document.createElement('audio')
      el.srcObject = new MediaStream([audioTrack])

      if (el.setSinkId) {
        el.setSinkId(currentDeviceSpeaker)
      }

      el.muted = !speakerStatus || isMuted
      refVideo.current!.muted = !speakerStatus || isMuted
      refPlayPromise.current = el.play()

      return () => {
        refPlayPromise.current?.finally(() => {
          el.pause()
          el.srcObject = null
          el.remove()
        })
      }
    }
  }, [audioTrack, videoTrack, currentDeviceSpeaker, speakerStatus, isMuted])

  useEffect(() => {
    if (refVideo.current && videoTrack) {
      refVideo.current.srcObject = new MediaStream([videoTrack])

      // NOTE: About Autoplay
      // Reference: https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide

      // NOTE:
      // iOS Wechat WebView
      // https://developers.weixin.qq.com/community/develop/doc/0006a61de48ab0165f99e1dcd51c00
      if (isWechat()) refVideo.current.play()
    }
  }, [refVideo, videoTrack])

  // NOTE: iOS can't display video
  // https://webkit.org/blog/6784/new-video-policies-for-ios/
  return (
    <center className="relative flex flex-col justify-center min-h-60 rounded-xl bg-black m-8" style={{ width: props.width }}>
      {!props.stream.getTracks().length ? <center><SvgProgress /></center> : null}
      <video
        className="aspect-ratio-[4/3] w-full h-full object-contain"
        playsInline={true}
        autoPlay={true}
        controls={false}
        muted={props.muted}
        ref={refVideo}
        style={props.stream?.getVideoTracks().length
          ? { display: props.video ? 'inline' : 'none'}
          : { height: '0px' }}
      />
      {!props.video || showAudio
        ? <AudioWave stream={props.stream} />
        : null
      }
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-b-xl px-4 py-3 flex justify-between items-center transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        ref={refControls}
      >
        <button
          className={`rounded-md ${!props.audio ? 'disabled:opacity-0 pointer-events-none' : 'disabled:bg-gray-400 disabled:opacity-70'}`}
          onClick={toggleMute}
          disabled={!props.audio || !speakerStatus}
        >
          {isMuted ? <SvgMuted /> : <SvgUnmuted />}
        </button>
        <div
          className="flex items-center space-x-2"
        >
          <button
            className="rounded-md disabled:hidden"
            onClick={toggleFullscreen}
            disabled={!isFullscreenSupported() || isPictureInPictured}
          >
            {isFullscreened ? <SvgExitFullscreen /> : <SvgFullscreen />}
          </button>
          <button
            className="rounded-md disabled:hidden"
            onClick={togglePictureInPicture}
            disabled={!isPictureInPictureSupported() || !props.video || showAudio}
          >
            {isPictureInPictured ? <SvgExitPictureInPicture /> : <SvgPictureInPicture />}
          </button>
        </div>
      </div>
    </center>
  )
}
