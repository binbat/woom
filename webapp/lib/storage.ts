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

function setStorageMeeting(value: string) { localStorage.setItem(MeetingKey, value) }
function setStorageStream(value: string) { localStorage.setItem(StreamKey, value) }
function setStorageToken(value: string) { localStorage.setItem(TokenKey, value) }
function setStorageName(value: string) { localStorage.setItem(NameKey, value) }

function getStorageMeeting() { return localStorage.getItem(MeetingKey) }
function getStorageStream() { return localStorage.getItem(StreamKey) }
function getStorageToken() { return localStorage.getItem(TokenKey) }
function getStorageName() { return localStorage.getItem(NameKey) }

function setStorage(opt: Storage) {
  if (opt.meeting) setStorageMeeting(opt.meeting)
  if (opt.stream) setStorageStream(opt.stream)
  if (opt.token) setStorageToken(opt.token)
  if (opt.name) setStorageName(opt.name)
}

function getStorage(): Storage {
  return {
    meeting: getStorageMeeting(),
    stream: getStorageStream(),
    token: getStorageToken(),
    name: getStorageName(),
  } as Storage
}

export {
  setStorageMeeting,
  setStorageStream,
  setStorageToken,
  setStorageName,

  getStorageMeeting,
  getStorageStream,
  getStorageToken,
  getStorageName,

  setStorage,
  getStorage,
}
