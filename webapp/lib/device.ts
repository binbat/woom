import { log } from './log'

interface Device {
  deviceId: string,
  label: string,
}

const deviceNone = {
  deviceId: 'none',
  label: 'none',
}

const deviceScreen = {
  deviceId: 'screen',
  label: 'screen',
}

const deviceSegmenter = {
  deviceId: 'segmenter',
  lable: 'segmenter'
}

async function asyncGetAudioStream(deviceId: string): Promise<MediaStream> {
  let stream: MediaStream = new MediaStream()
  if (deviceId !== 'none') {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId }, video: false })
    } catch (e) {
      log('error', 'get_user_media_failed', String(e), { kind: 'audio', deviceId })
      throw e
    }
  }
  return stream
}

async function asyncGetVideoStream(deviceId: string, constraints?: MediaTrackConstraints): Promise<MediaStream> {
  let stream: MediaStream = new MediaStream()
  try {
    if (deviceId === 'none') {
      /* empty */
    } else if (deviceId === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: constraints ?? { height: 720 } })
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints ?? { height: 480, deviceId: deviceId } })
    }
  } catch (e) {
    log('error', 'get_user_media_failed', String(e), { kind: 'video', deviceId })
    throw e
  }
  return stream
}

export {
  asyncGetAudioStream,
  asyncGetVideoStream,
  deviceNone,
  deviceScreen,
  deviceSegmenter,
}

export type {
  Device
}
