interface Device {
  deviceId: string,
  label: string,
}

const deviceNone = {
  deviceId: "none",
  label: "none",
}

const deviceScreen = {
  deviceId: "screen",
  label: "screen",
}

async function asyncGetAudioStream(deviceId: string): Promise<MediaStream> {
  let stream: MediaStream = new MediaStream
  if (deviceId !== "none") {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  }
  return stream
}

async function asyncGetVideoStream(deviceId: string): Promise<MediaStream> {
  let stream: MediaStream = new MediaStream
  if (deviceId === "none") {
  } else if (deviceId === "screen") {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { width: 320 } })
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 320 } })
  }
  return stream
}

export {
  asyncGetAudioStream,
  asyncGetVideoStream,
  deviceNone,
  deviceScreen,
}

export type {
  Device
}
