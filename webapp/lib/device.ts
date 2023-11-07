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

async function asyncGetAudioStream(deviceId: string): Promise<MediaStream | null> {
  let stream = null
  if (deviceId === "none") {
    stream = null
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  }
  return stream
}

async function asyncGetVideoStream(deviceId: string): Promise<MediaStream | null> {
  let stream = null
  if (deviceId === "none") {
    stream = null
  } else if (deviceId === "screen") {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
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