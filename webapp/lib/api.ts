
interface Room {
  roomId: string,
  locked: false,
  owner: string,
  presenter?: string,
  streams: any,
}


interface Stream {
  name: string,
  audio: boolean,
  video: boolean,
  screen: boolean,
}

async function newRoom(): Promise<Room> {
  return (await fetch(`/room/`, {
    method: "POST",
  })).json()
}

async function getRoom(roomId: string): Promise<Room> {
  return (await fetch(`/room/${roomId}`)).json()
}

async function setRoom(roomId: string, data: any): Promise<Room> {
  return (await fetch(`/room/${roomId}`, {
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(data),
  })).json()
}

async function delRoom(roomId: string): Promise<void> {
  return (await fetch(`/room/${roomId}`, {
    method: "DELETE",
  })).json()
}

async function newStream(roomId: string): Promise<Stream> {
  return (await fetch(`/room/${roomId}/stream`, {
    method: "POST",
  })).json()
}

async function setStream(roomId: string, streamId: string, data: any): Promise<Stream> {
  return (await fetch(`/room/${roomId}/stream/${streamId}`, {
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(data),
  })).json()
}

async function delStream(roomId: string, streamId: string): Promise<void> {
  return (await fetch(`/room/${roomId}/stream/${streamId}`, {
    method: "DELETE",
  })).json()
}

export {
  newRoom,
  getRoom,
  setRoom,
  delRoom,

  newStream,
  setStream,
  delStream,
}
