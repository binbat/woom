export default class WakeLock {
  private lock: WakeLockSentinel | null
  private onRelease: () => void

  constructor(handleRelease?: () => void) {
    this.lock = null
    this.onRelease = handleRelease ?? (() => {})
  }

  private handleVisibilityChange = () => {
    if (this.lock !== null && document.visibilityState === 'visible') {
      this.request()
    }
  }

  public request = async () => {
    if (this.lock == null) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
    }
    try {
      this.lock = await navigator.wakeLock.request('screen')
      this.lock.addEventListener('release', this.onRelease)
    } catch (err) {
      console.error('Failed to request wake lock:', err)
    }
  }

  public release = async () => {
    try {
      await this.lock?.release()
    } catch (err) {
      console.error('Failed to release wake lock:', err)
    } finally {
      this.lock = null
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    }
  }
}
