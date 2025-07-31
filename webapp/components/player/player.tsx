import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record'
import {
  isWechat,
  isFullscreenSupported,
  isPictureInPictureSupported,
} from '../../lib/util'
import SvgProgress from '../svg/progress'
import { deviceSpeakerAtom, speakerStatusAtom } from '../../store/atom'
import {
  SvgMuted,
  SvgUnmuted,
  SvgFullscreen,
  SvgExitFullscreen,
  SvgPictureInPicture,
  SvgExitPictureInPicture,
  SvgMic,
} from '../svg/player'
import VolumeExtractor from '../use/volumeExtraction'

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

function Mic(props: { stream: MediaStream }) {
  const [volumeValue, setVolumeValue] = useState(0)
  const rest = 100 - volumeValue
  useEffect(() => {
    let done = false
    if (props.stream.getAudioTracks().length) {
      const extractor = new VolumeExtractor(props.stream)
      function updateVolume() {
        const value = extractor.calculateVolume()
        setVolumeValue(value)
        if (!done) requestAnimationFrame(updateVolume)
      }
      updateVolume()
    }
    return(() => {
      done = true
    })
  }, [props.stream])
  return (
    <div
      className="absolute top-0 right-0 rounded-xl p-1 m-2 transition-opacity duration-300"
      style={{
        background: `linear-gradient(to bottom, white ${rest}%, red ${volumeValue}%)`,
        opacity: volumeValue > 3 ? '1' : '0'
      }}
    >
      <SvgMic />
    </div>
  )
}

export default function Player(props: { stream: MediaStream, muted: boolean, audio?: boolean, video?: boolean, width: string, self: boolean }) {
  const refVideo = useRef<HTMLVideoElement>(null)
  const audioTrack = props.stream.getAudioTracks()[0]
  const videoTrack = props.stream.getVideoTracks()[0]
  const [currentDeviceSpeaker] = useAtom(deviceSpeakerAtom)
  const [speakerStatus] = useAtom(speakerStatusAtom)
  const refPlayPromise = useRef<Promise<void>>()
  const refControls = useRef<HTMLDivElement>(null)
  const [showControls, setShowControls] = useState(false)
  const refTimeoutId = useRef<number>()
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreened, setIsFullscreened] = useState(false)
  const [isPictureInPictured, setIsPictureInPictured] = useState(false)
  const hasTracks = props.stream.getTracks().length > 0
  const mediaEnabled = props.audio || props.video
  const showAudio = props.audio && !props.video
  const mediaDisabledTip = `All ${props.self ? 'your' : 'their'} media are disabled`

  const handleMouseMove = () => {
    setShowControls(true)
    if (refTimeoutId.current) clearTimeout(refTimeoutId.current)
    const newTimeout = setTimeout(() => {
      setShowControls(false)
    }, 2000)
    refTimeoutId.current = newTimeout
  }

  const toggleMute = () => isMuted ? setIsMuted(false) : setIsMuted(true)

  const toggleFullscreen = () => {
    const container = refVideo.current!.parentElement!
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
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
    if (isFullscreenSupported) document.addEventListener('fullscreenchange', onFullScreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreenChange)
    }
  }, [])

  useEffect(() => {
    const onEnterPictureInPicture = () => setIsPictureInPictured(true)
    const onLeavePictureInPicture = () => setIsPictureInPictured(false)
    const video = refVideo.current
    if (isPictureInPictureSupported) {
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
    if (audioTrack && props.audio && !props.muted) {
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
    <div className="relative flex flex-col justify-center items-center min-h-60 rounded-xl bg-black m-8" style={{ width: props.width }}>
      {!mediaEnabled ? <p
        className={`text-white transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >{mediaDisabledTip}</p> : null}
      {mediaEnabled && !hasTracks ? <SvgProgress /> : null}
      <video
        className="aspect-ratio-[4/3] w-full h-full object-contain rounded-xl"
        playsInline={true}
        autoPlay={true}
        controls={false}
        muted={true}
        ref={refVideo}
        style={props.stream?.getVideoTracks().length
          ? { display: props.video ? 'inline' : 'none'}
          : { height: '0px' }}
      />
      {showAudio
        ? <div className="w-full"><AudioWave stream={props.stream} /></div>
        : null
      }
      <Mic stream={props.stream} />
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-b-xl px-4 py-3 flex justify-between items-center transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        ref={refControls}
      >
        <button
          className={`rounded-md ${ props.muted ? 'opacity-0 pointer-events-none' : 'disabled:bg-gray-400 disabled:opacity-70'}`}
          onClick={toggleMute}
          disabled={!speakerStatus}
        >
          {isMuted ? <SvgMuted /> : <SvgUnmuted />}
        </button>
        <div
          className="flex items-center space-x-2"
        >
          <button
            className="rounded-md disabled:hidden"
            onClick={toggleFullscreen}
            disabled={!isFullscreenSupported || isPictureInPictured}
          >
            {isFullscreened ? <SvgExitFullscreen /> : <SvgFullscreen />}
          </button>
          <button
            className="rounded-md disabled:hidden"
            onClick={togglePictureInPicture}
            disabled={!isPictureInPictureSupported || !props.video}
          >
            {isPictureInPictured ? <SvgExitPictureInPicture /> : <SvgPictureInPicture />}
          </button>
        </div>
      </div>
    </div>
  )
}
