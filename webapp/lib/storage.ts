import { newUser } from "./api"

const MeetingIdKey = 'meeting'
const StreamIdKey = 'stream'

function setMeetingId(id: string) {
  const oldId = localStorage.getItem(MeetingIdKey)
  if (id !== oldId) {
    localStorage.setItem(MeetingIdKey, id)
    localStorage.removeItem(StreamIdKey)
    newUser()
  }
}

async function asyncGetStreamId(): Promise<string> {
  const streamId = localStorage.getItem(StreamIdKey)
  return streamId || ""
}

export {
  setMeetingId,
  asyncGetStreamId,
}
