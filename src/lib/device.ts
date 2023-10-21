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

async function asyncGetStream(deviceId: string): Promise<MediaStream | null> {
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
  asyncGetStream,
  deviceNone,
  deviceScreen,
}

export type {
  Device
}
