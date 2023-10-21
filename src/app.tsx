import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import Bar from './components/bar'
import Uuid from './components/uuid'
import Welcome from './pages/welcome'
import Meeting from './pages/meeting'
import { meAtom, meetingIdAtom } from './store/atom'

function App() {
  const [me] = useAtom(meAtom)
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
            <Meeting meetingId={meetingId} />
            <Bar />
          </>
      }

    </>
  )
}

export default App
