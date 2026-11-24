/**
 * Room events over a Live777 cable (WebRTC datachannel) instead of SSE.
 *
 * The backend injects every published room event into a per-room Live777
 * "{roomId}-events" stream; this client WHEP-subscribes to that stream and
 * receives the exact SSE wire strings as binary datachannel frames. The
 * WHEP offer must contain m=application, so the datachannel is created
 * before the offer (live777 PR #522, live777 >= 0.11.0).
 *
 * Reconnect semantics mirror connectEvents() in layout.vue: datachannel
 * close or a failed/closed peer connection schedules a reconnect with
 * exponential backoff (500ms base, doubling up to 10s, reset on open),
 * every channel open resyncs meeting state (the cable has no retained
 * initial snapshot like the SSE endpoint sends, so events fired while the
 * channel was connecting are healed by the fresh snapshot the resync
 * triggers), and only HTTP 401/403 from the WHEP POST is terminal. A 404
 * is retryable: live777 reaps publisher-less streams, so the events stream
 * may simply not exist yet (the backend ensures it before forwarding, and
 * the inject worker recreates it on the next event).
 */

import { WHEPClient } from 'whip-whep/whep'
import { type RoomEvent, token } from '../../lib/api'
import { log } from '../../lib/log'

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

interface CableEventsHandlers {
  /** dispatch a parsed room event (same handler as SSE) */
  onEvent: (data: RoomEvent) => void
  /** channel opened (first or later): resync meeting state */
  onReopen: () => void
  /** terminal WHEP signaling failure (HTTP 401/403): leave the meeting */
  onTerminal: () => void
  /** external generation guard: false once the owner tore this session down */
  isCurrent: () => boolean
}

interface CableSession {
  client: WHEPClient
  pc: RTCPeerConnection
  dc: RTCDataChannel
  onStateChange: () => void
  view?: Promise<void>
  cleanup?: Promise<void>
}

/** the vendored WHEP client reports HTTP failures as "Request rejected with status N" */
const isTerminalError = (e: unknown) => {
  const status = Number(/status (\d+)/.exec(String(e))?.[1])
  return [401, 403].includes(status)
}

export default function connectCableEvents(
  meetingId: string,
  eventsStream: string,
  handlers: CableEventsHandlers
): { close: () => void } {
  const { onEvent, onReopen, onTerminal, isCurrent } = handlers
  const decoder = new TextDecoder()
  let session: CableSession | undefined
  let retry: number | undefined
  let reconnectDelay = RECONNECT_BASE_MS
  let closed = false

  const isAlive = (s: CableSession) => !closed && session === s && isCurrent()

  const cleanupSession = (s: CableSession): Promise<void> => {
    if (s.cleanup) return s.cleanup
    s.cleanup = (async () => {
      const { client, pc, dc } = s
      pc.removeEventListener('connectionstatechange', s.onStateChange)
      pc.onconnectionstatechange = null
      pc.onicecandidate = null
      dc.onopen = null
      dc.onclose = null
      dc.onmessage = null
      dc.close()
      pc.close()
      try {
        if (s.view) await s.view.catch(() => {})
        await client.stop()
      } catch {
        // Signaling can fail before an upstream resource exists.
      } finally {
        pc.close()
      }
    })()
    return s.cleanup
  }

  const scheduleReconnect = () => {
    if (retry !== undefined || closed) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    retry = window.setTimeout(() => {
      retry = undefined
      if (!closed && isCurrent()) void connect()
    }, delay)
  }

  const connect = async () => {
    const previous = session
    session = undefined
    window.clearTimeout(retry)
    retry = undefined
    if (previous) await cleanupSession(previous)
    if (closed || !isCurrent()) return

    const pc = new RTCPeerConnection()
    // m=application must be in the WHEP offer: create the channel first
    const dc = pc.createDataChannel('events')
    dc.binaryType = 'arraybuffer'
    const current: CableSession = {
      client: new WHEPClient(),
      pc,
      dc,
      onStateChange: () => {},
    }
    session = current
    current.onStateChange = () => {
      if (!isAlive(current)) return
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        log('warn', 'cable_state', pc.connectionState, { meetingId })
        scheduleReconnect()
      }
    }
    pc.addEventListener('connectionstatechange', current.onStateChange)
    dc.onmessage = e => {
      if (!isAlive(current)) return
      try {
        const data = JSON.parse(
          decoder.decode(e.data as ArrayBuffer)
        ) as RoomEvent
        onEvent(data)
      } catch (error) {
        log('warn', 'cable_event_invalid', String(error), { meetingId })
      }
    }
    dc.onopen = () => {
      if (!isAlive(current)) return
      reconnectDelay = RECONNECT_BASE_MS
      // Resync on every open, including the first: the cable has no
      // retained initial snapshot like SSE sends, so events that fired
      // while the channel was connecting are healed by the fresh snapshot
      // this resync triggers.
      onReopen()
    }
    dc.onclose = () => {
      if (!isAlive(current)) return
      log('warn', 'cable_channel_closed', '', { meetingId })
      scheduleReconnect()
    }
    try {
      current.view = current.client.view(
        pc,
        `${location.origin}/whep/${eventsStream}`,
        token
      )
      await current.view
    } catch (e) {
      if (!isAlive(current)) return
      log('warn', 'cable_view_failed', String(e), { meetingId })
      if (isTerminalError(e)) {
        onTerminal()
        return
      }
      scheduleReconnect()
    }
  }

  void connect()

  return {
    close: () => {
      closed = true
      window.clearTimeout(retry)
      retry = undefined
      const current = session
      session = undefined
      if (current) void cleanupSession(current)
    },
  }
}
