interface Room {
  roomId: string,
  owner: string,
  topic: string,
  locked: boolean,
  presenter: string,
  createdAt: number,
}

interface Meeting {
  meetingNo: string,
  roomId: string,
  startedAt: number,
  endedAt?: number,
  maxConcurrent: number,
}

interface Participant {
  userId: string,
  name: string,
  role: 'owner' | 'member',
  joinAt: number,
  leaveAt?: number,
}

interface RoomDetail extends Room {
  meeting: Meeting | null,
  participants: Participant[],
}

interface JoinResponse {
  meetingNo: string,
  userId: string,
  role: 'owner' | 'member',
  name: string,
}

interface MeetingRecord {
  meetingNo: string,
  roomId: string,
  startedAt: number,
  endedAt: number,
  maxConcurrent: number,
  participants: Participant[],
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
  name: string,
  state: StreamState
  audio: boolean,
  video: boolean,
  screen: boolean,
}

interface User {
  streamId: string,
  token: string,
}

/** Snapshot pushed over SSE, same shape for the initial event and updates */
interface RoomEvent {
  meetingNo: string | null,
  streams: Record<string, Stream>,
  presenter: string,
  locked: boolean,
  participants: Participant[],
}

let token = ''

function setApiToken(str: string) {
  token = str
}

function authHeaders(): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function newUser(): Promise<User> {
  return (await fetch('/user/', {
    method: 'POST',
  })).json()
}

async function newRoom(): Promise<Room> {
  return (await fetch('/room/', {
    headers: authHeaders(),
    method: 'POST',
  })).json()
}

async function getRoom(id: string): Promise<RoomDetail> {
  const res = await fetch(`/room/${id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function patchRoom(id: string, data: Partial<Pick<Room, 'topic' | 'locked' | 'presenter'> & { password: string }>): Promise<Room> {
  const res = await fetch(`/room/${id}`, {
    headers: authHeaders(),
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function joinMeeting(id: string, name: string, password?: string): Promise<JoinResponse> {
  const res = await fetch(`/room/${id}/join`, {
    headers: authHeaders(),
    method: 'POST',
    body: JSON.stringify({ name, password }),
  })
  if (!res.ok) throw new Error(await res.text())
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
  fetch(`/room/${id}/leave`, {
    headers: authHeaders(),
    method: 'POST',
    keepalive: true,
  })
}

async function endMeeting(id: string): Promise<void> {
  const res = await fetch(`/room/${id}/end`, {
    headers: authHeaders(),
    method: 'POST',
  })
  if (!res.ok) throw new Error(await res.text())
}

async function setPresence(id: string, status: Stream): Promise<void> {
  const res = await fetch(`/room/${id}/presence`, {
    headers: authHeaders(),
    method: 'PATCH',
    body: JSON.stringify(status),
  })
  if (!res.ok) console.warn('presence rejected:', res.status, await res.text())
}

async function getMyRecords(): Promise<MeetingRecord[]> {
  return (await fetch('/user/records', {
    headers: authHeaders(),
  })).json()
}

/** room-state stream; EventSource cannot set headers so the token goes in the query */
function openRoomEvents(id: string): EventSource {
  return new EventSource(`/room/${id}/events?token=${encodeURIComponent(token)}`)
}

export {
  setApiToken,
  newUser,

  newRoom,
  getRoom,
  patchRoom,

  joinMeeting,
  leaveMeeting,
  leaveMeetingKeepalive,
  endMeeting,
  setPresence,
  getMyRecords,
  openRoomEvents,

  StreamState,

  token,
}

export type {
  Room,
  RoomDetail,
  Meeting,
  Participant,
  MeetingRecord,
  JoinResponse,
  Stream,
  RoomEvent,
}
