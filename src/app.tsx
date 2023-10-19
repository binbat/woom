import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import Bar from './bar'
import Uuid from './uuid'
import Card from './card'
import Welcome from './welcome'
import Member from './member'
import User from './user'
import { streamAtom, meAtom, meetingIdAtom } from './atom'

function App() {
  const [me] = useAtom(meAtom)
  const [streams] = useAtom(streamAtom)
  const [meetingId] = useAtom(meetingIdAtom)

  return (
    <>
      {
        !meetingId
          ? <Welcome />
          : <>
            <div>
              <label>meeting Id: </label><code>{meetingId}</code>
              <br />
              <label>Me Id: </label><code>{me}</code>
              <Uuid />
            </div>
            {streams.map(stream => <Card key={stream} stream={stream} >{stream}</Card>)}
            <User />
            <Member />
            <Bar />
          </>
      }

    </>
  )
}

export default App
