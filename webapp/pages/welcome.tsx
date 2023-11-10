import Join from '../components/join'

export default function Welcome() {
  return (
    <div className='flex flex-col justify-around' style={{
      height: '100%'
    }}>
      <center>
        <div>
          <h1 className='flex justify-center text-white text-5xl font-bold'>WOOM</h1>
          <p className='text-white'>A new meeting</p>
        </div >
        <Join />
      </center>
    </div>
  )
}
