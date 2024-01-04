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

interface User {
  streamId: string,
  token: string,
}

let token = ""

function setApiToken(str: string) {
  token = str
}

async function newUser(): Promise<User> {
  return (await fetch(`/user/`, {
    method: "POST",
  })).json()
}

async function newRoom(): Promise<Room> {
  return (await fetch(`/room/`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    method: "POST",
  })).json()
}

async function getRoom(roomId: string): Promise<Room> {
  return (await fetch(`/room/${roomId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  })).json()
}

async function setRoom(roomId: string, data: any): Promise<Room> {
  return (await fetch(`/room/${roomId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(data),
  })).json()
}

async function delRoom(roomId: string): Promise<void> {
  return (await fetch(`/room/${roomId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    method: "DELETE",
  })).json()
}

async function newStream(roomId: string): Promise<Stream> {
  return (await fetch(`/room/${roomId}/stream`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    method: "POST",
  })).json()
}

async function setStream(roomId: string, streamId: string, data: any): Promise<Stream> {
  return (await fetch(`/room/${roomId}/stream/${streamId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(data),
  })).json()
}

async function delStream(roomId: string, streamId: string): Promise<void> {
  return (await fetch(`/room/${roomId}/stream/${streamId}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
    method: "DELETE",
  })).json()
}

export {
  setApiToken,
  newUser,

  newRoom,
  getRoom,
  setRoom,
  delRoom,

  newStream,
  setStream,
  delStream,
}
