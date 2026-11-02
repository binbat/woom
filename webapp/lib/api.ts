interface Room {
  roomId: string
  owner: string
  topic: string
  locked: boolean
  presenter: string
  createdAt: number
}

interface Meeting {
  meetingNo: string
  roomId: string
  startedAt: number
  endedAt?: number
  maxConcurrent: number
}

interface Participant {
  userId: string
  name: string
  role: 'owner' | 'member'
  joinAt: number
  leaveAt?: number
}

interface RoomDetail extends Room {
  meeting: Meeting | null
  participants: Participant[]
}

interface JoinResponse {
  meetingNo: string
  userId: string
  role: 'owner' | 'member'
  name: string
}

interface MeetingRecord {
  meetingNo: string
  roomId: string
  startedAt: number
  endedAt: number
  maxConcurrent: number
  participants: Participant[]
  messages: Message[]
}

interface Message {
  id: string
  userId: string
  name: string
  content: string
  ts: number
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState#value
 */
enum StreamState {
  New = 'new',
  Signaled = 'signaled',
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
  Failed = 'failed',
  Closed = 'closed',
}

interface Stream {
  name: string
  state: StreamState
  audio: boolean
  video: boolean
  screen: boolean
}

interface User {
  streamId: string
  token: string
}

/** Snapshot pushed over SSE, same shape for the initial event and updates */
interface RoomSnapshot {
  type: 'snapshot'
  revision: number
  meetingNo: string | null
  streams: Record<string, Stream>
  presenter: string
  locked: boolean
  participants: Participant[]
  messages: Message[]
  muteAllAt: number
}

interface RoomMessageEvent {
  type: 'message'
  revision: number
  message: Message
}

type RoomEvent = RoomSnapshot | RoomMessageEvent

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let token = ''

function setApiToken(str: string) {
  token = str
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function newUser(): Promise<User> {
  return (
    await fetch('/user/', {
      method: 'POST',
    })
  ).json()
}

async function newRoom(): Promise<Room> {
  return (
    await fetch('/room/', {
      headers: authHeaders(),
      method: 'POST',
    })
  ).json()
}

async function getRoom(id: string): Promise<RoomDetail> {
  const res = await fetch(`/room/${id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

async function patchRoom(
  id: string,
  data: Partial<
    Pick<Room, 'topic' | 'locked' | 'presenter'> & { password: string }
  >
): Promise<Room> {
  const res = await fetch(`/room/${id}`, {
    headers: authHeaders(),
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

async function joinMeeting(
  id: string,
  name: string,
  password?: string
): Promise<JoinResponse> {
  const res = await fetch(`/room/${id}/join`, {
    headers: authHeaders(),
    method: 'POST',
    body: JSON.stringify({ name, password }),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

async function leaveMeeting(id: string): Promise<void> {
  await fetch(`/room/${id}/leave`, {
    headers: authHeaders(),
    method: 'POST',
  })
}

/** keepalive variant for page-unload cleanup */
function leaveMeetingKeepalive(id: string) {
  void fetch(`/room/${id}/leave`, {
    headers: authHeaders(),
    method: 'POST',
    keepalive: true,
  }).catch(() => {})
}

async function endMeeting(id: string): Promise<void> {
  const res = await fetch(`/room/${id}/end`, {
    headers: authHeaders(),
    method: 'POST',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
}

async function muteAll(id: string): Promise<void> {
  const res = await fetch(`/room/${id}/mute`, {
    headers: authHeaders(),
    method: 'POST',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
}

async function kickParticipant(id: string, userId: string): Promise<void> {
  const res = await fetch(`/room/${id}/participant/${userId}`, {
    headers: authHeaders(),
    method: 'DELETE',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
}

async function setPresence(id: string, status: Stream): Promise<boolean> {
  try {
    const res = await fetch(`/room/${id}/presence`, {
      headers: authHeaders(),
      method: 'PATCH',
      body: JSON.stringify(status),
    })
    if (!res.ok) console.warn('presence rejected:', res.status)
    return res.ok
  } catch (e) {
    console.warn('presence request failed:', e)
    return false
  }
}

async function getMyRecords(): Promise<MeetingRecord[]> {
  return (
    await fetch('/user/records', {
      headers: authHeaders(),
    })
  ).json()
}

async function sendMessage(id: string, content: string): Promise<Message> {
  const res = await fetch(`/room/${id}/message`, {
    headers: authHeaders(),
    method: 'POST',
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

async function openRoomEvents(id: string): Promise<EventSource> {
  const res = await fetch(`/room/${id}/events/ticket`, {
    headers: authHeaders(),
    method: 'POST',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  const { ticket } = (await res.json()) as { ticket: string; expiresAt: number }
  return new EventSource(
    `/room/${id}/events?ticket=${encodeURIComponent(ticket)}`
  )
}

export type {
  JoinResponse,
  Meeting,
  MeetingRecord,
  Message,
  Participant,
  Room,
  RoomDetail,
  RoomEvent,
  RoomSnapshot,
  Stream,
}
export {
  ApiError,
  endMeeting,
  getMyRecords,
  getRoom,
  joinMeeting,
  kickParticipant,
  leaveMeeting,
  leaveMeetingKeepalive,
  muteAll,
  newRoom,
  newUser,
  openRoomEvents,
  patchRoom,
  StreamState,
  sendMessage,
  setApiToken,
  setPresence,
  token,
}
