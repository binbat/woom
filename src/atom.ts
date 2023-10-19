import { atom } from 'jotai'

function guidGenerator() {
  var S4 = function() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
  }
  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4())
}

interface User {
  stream: MediaStream | null,
  name: string
}

const uuid = guidGenerator()

const streamAtom = atom<string[]>([uuid])
const meAtom = atom(uuid)
const meetingIdAtom = atom("")
const usersAtom = atom<User[]>([])

export {
  meAtom,
  streamAtom,
  meetingIdAtom,
  usersAtom,
}

export type {
  User,
}
