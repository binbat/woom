import { useState } from 'react'
import Join from '../components/join'
import Layout from '../components/layout'

export default function App() {
  const [tabJoin, setTabJoin] = useState(false)

  //<Layout />

  return (
    <div className='flex flex-col justify-around' style={{
      height: '100%'
    }}>
      <center>
        <div>
          <h1 className='flex justify-center text-white text-5xl font-bold'>WOOM</h1>
          <p className='text-white'>A new meeting</p>
        </div >
        {tabJoin
          ? <Join />
          : <>
            <button className='btn-primary m-10' onClick={() => setTabJoin(true)}>Join</button>
            <button className='btn-primary m-10' onClick={() => setTabJoin(true)}>New</button>
          </>
        }
      </center>
    </div>
  )
}
