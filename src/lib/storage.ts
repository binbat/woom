const MeetingIdKey = 'meeting'
const StreamIdKey = 'stream'

function setMeetingId(id: string) {
  const oldId = localStorage.getItem(MeetingIdKey)
  if (id !== oldId) {
    localStorage.setItem(MeetingIdKey, id)
    localStorage.removeItem(StreamIdKey)
  }
}

function setStreamId(id: string) {
  localStorage.setItem(StreamIdKey, id)
}

async function serverGetStreamId(meetingId: string): Promise<string> {
  let res = await fetch(`/room/${meetingId}/stream`, {
    method: "POST"
  })
  return res.text()
}

async function asyncGetStreamId(): Promise<string> {
  const streamId = localStorage.getItem(StreamIdKey)
  if (!!streamId) {
    return streamId
  }

  const meetingId = localStorage.getItem(MeetingIdKey)
  const id = await serverGetStreamId(meetingId)

  setStreamId(id)
  return id
}

export {
  setMeetingId,
  setStreamId,
  asyncGetStreamId,
}
