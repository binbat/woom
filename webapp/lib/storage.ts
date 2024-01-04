const MeetingKey = 'meeting'
const StreamKey = 'stream'
const TokenKey = 'token'
const NameKey = 'name'

interface Storage {
  meeting?: string,
  stream?: string,
  token?: string,
  name?: string,
}

function setStorage(opt: Storage) {
  if (opt.meeting) {
    localStorage.setItem(MeetingKey, opt.meeting)
  }
  if (opt.stream) {
    localStorage.setItem(StreamKey, opt.stream)
  }
  if (opt.token) {
    localStorage.setItem(TokenKey, opt.token)
  }
  if (opt.name) {
    localStorage.setItem(NameKey, opt.name)
  }
}

function getStorage(): Storage {
  return {
    meeting: localStorage.getItem(MeetingKey),
    stream: localStorage.getItem(StreamKey),
    token: localStorage.getItem(TokenKey),
    name: localStorage.getItem(NameKey),
  } as Storage
}

export {
  setStorage,
  getStorage,
}
