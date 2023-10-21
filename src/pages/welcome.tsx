import { useState } from 'react'
import { useAtom } from 'jotai'
import { meAtom } from '../store/atom'
import Join from '../components/join'

export default function App() {
  const [me] = useAtom(meAtom)

  return (
    <div className='flex flex-col justify-around' bg="green-400 hover:green-500 max-h-full" style={{ height: '100vh' }}>
      <h1 className='flex justify-center'>WOOM</h1>

      <div className='flex justify-evenly' bg="blue-400 hover:blue-500 ">

        <div>
          <label>Your stream id: </label>
          <code>{me}</code>
        </div>
      </div>
      <Join />
    </div>
  )
}
