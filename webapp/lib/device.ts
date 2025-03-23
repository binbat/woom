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
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId }, video: false })
  }
  return stream
}

async function asyncGetVideoStream(deviceId: string, constraints?: MediaTrackConstraints): Promise<MediaStream> {
  let stream: MediaStream = new MediaStream()
  if (deviceId === 'none') {
    /* empty */
  } else if (deviceId === 'screen') {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: constraints ?? { height: 720 } })
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints ?? { height: 480, deviceId: deviceId } })
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
