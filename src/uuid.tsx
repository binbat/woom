import { useState } from 'react'
import { useAtom } from 'jotai'
import { streamAtom } from './atom'
import uniq from 'lodash.uniq'

export default function App() {
  const [uuid, setUuid] = useState<string>("")
  const [streams, setStreams] = useAtom(streamAtom)

  const toggleAdd = () => {
    console.log(`add uuid: ${uuid}`)
    setStreams(uniq([...streams, uuid]))
    setUuid("")
  }

  return (
    <div>
      <input
        style={{ width: '80%' }}
        value={uuid}
        onChange={e => setUuid(e.target.value)}
      />
      <button onClick={toggleAdd}>Add</button>
    </div>
  )
}
