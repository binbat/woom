import blueWavesUrl from '@/assets/backgrounds/blue-waves.svg?url'
import forestUrl from '@/assets/backgrounds/forest.svg?url'
import libraryUrl from '@/assets/backgrounds/library.svg?url'
import mountainsUrl from '@/assets/backgrounds/mountains.svg?url'
import officeUrl from '@/assets/backgrounds/office.svg?url'
import studioUrl from '@/assets/backgrounds/studio.svg?url'

const virtualBackgrounds = [
  { id: 'studio', name: 'Bright studio', url: studioUrl },
  { id: 'office', name: 'Modern office', url: officeUrl },
  { id: 'library', name: 'Quiet library', url: libraryUrl },
  { id: 'mountains', name: 'Mountain lake', url: mountainsUrl },
  { id: 'forest', name: 'Forest light', url: forestUrl },
  { id: 'blue-waves', name: 'Blue waves', url: blueWavesUrl },
] as const

type VirtualBackgroundId = (typeof virtualBackgrounds)[number]['id']

function isVirtualBackgroundId(value: unknown): value is VirtualBackgroundId {
  return virtualBackgrounds.some(background => background.id === value)
}

function getVirtualBackground(id: VirtualBackgroundId) {
  const background = virtualBackgrounds.find(background => background.id === id)
  if (!background) throw new Error(`Unknown virtual background: ${id}`)
  return background
}

export type { VirtualBackgroundId }
export { getVirtualBackground, isVirtualBackgroundId, virtualBackgrounds }
