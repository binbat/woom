import { useAtom } from 'jotai'
import { User, usersAtom } from './atom'
import Player from './player'

export default function App() {
  const [users] = useAtom(usersAtom)

  return (
    <div className='flex flex-wrap justify-evenly'>
      {users.map(user => <Player key={user.name} user={user} />)}
    </div>
  )
}
