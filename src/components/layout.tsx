import { useState } from 'react'

export default function App() {
  const [count] = useState(2)
  return (
    <div className='flex flex-row flex-wrap justify-evenly container'>
      {Array(count).fill(0).map((_, i) =>
        <div key={'layout-test-' + i}
          className='text-white bg-red border-2'
        >{i}<video controls={true}></video></div>
      )
      }
    </div>
  )
}

