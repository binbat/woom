<script setup lang="ts">
import copy from 'copy-to-clipboard'
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { StreamState } from '../../lib/api'
import type { UserStatus } from '../../store/atoms'
import SvgClose from '../svg/close.vue'
import SvgTip from '../svg/tip.vue'

const props = defineProps<{
  streamId: string
  connStatus: string
  userStatus: UserStatus
  restart: () => Promise<void>
}>()

const open = ref(false)
const copied = ref(false)
const modal = ref<HTMLDialogElement>()
const trigger = ref<HTMLButtonElement>()
let copyTimeout: number | undefined

const connectionLabel = computed(() => {
  switch (props.connStatus) {
    case StreamState.Connected:
      return 'Connected'
    case StreamState.Failed:
      return 'Failed'
    case StreamState.Disconnected:
      return 'Disconnected'
    case StreamState.Closed:
      return 'Closed'
    case StreamState.Signaled:
      return 'Signaling'
    case StreamState.Connecting:
      return 'Connecting'
    default:
      return 'New'
  }
})
const connectionFailed = computed(() =>
  [StreamState.Failed, StreamState.Disconnected, StreamState.Closed].includes(
    props.connStatus as StreamState
  )
)
const statusDotClass = computed(() => {
  if (props.connStatus === StreamState.Connected) return 'bg-emerald-400'
  return connectionFailed.value ? 'bg-rose-400' : 'bg-amber-400'
})
const statusTextClass = computed(() => {
  if (props.connStatus === StreamState.Connected) return 'text-emerald-300'
  return connectionFailed.value ? 'text-rose-300' : 'text-amber-300'
})

const openDetails = async () => {
  open.value = true
  await nextTick()
  if (modal.value && !modal.value.open) modal.value.showModal()
}
const onClose = async () => {
  open.value = false
  copied.value = false
  await nextTick()
  trigger.value?.focus()
}
const onBackdropClick = (event: MouseEvent) => {
  if (event.target === event.currentTarget) modal.value?.close()
}
const copyStreamId = () => {
  if (!copy(props.streamId)) return
  copied.value = true
  if (copyTimeout) clearTimeout(copyTimeout)
  copyTimeout = window.setTimeout(() => {
    copied.value = false
  }, 1500)
}

onUnmounted(() => {
  if (copyTimeout) clearTimeout(copyTimeout)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-slate-950/70 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur transition-colors hover:bg-slate-800/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
    :aria-label="`View connection details for ${userStatus.name}`"
    aria-haspopup="dialog"
    data-testid="stream-details-toggle"
    @click="openDetails"
  >
    <span
      v-if="connStatus !== StreamState.Connected"
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="statusDotClass"
    />
    <span class="min-w-0 truncate">{{ userStatus.name }}</span>
    <SvgTip class="h-3.5 w-3.5 shrink-0 text-slate-400" />
  </button>

  <Teleport to="body">
    <dialog
      v-if="open"
      ref="modal"
      class="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-black/60 p-0 backdrop-blur-sm"
      aria-labelledby="stream-details-title"
      data-testid="stream-details-overlay"
      @close="onClose"
    >
      <div
        class="flex h-full w-full items-end justify-center sm:items-center sm:p-4"
        data-testid="stream-details-backdrop"
        @click="onBackdropClick"
      >
        <section class="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-900 text-slate-200 shadow-2xl sm:max-w-sm sm:rounded-2xl" data-testid="stream-details-dialog">
          <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div class="min-w-0">
              <h2 id="stream-details-title" class="truncate text-base font-semibold text-slate-100">{{ userStatus.name }}</h2>
              <p class="mt-0.5 text-xs text-slate-400">Connection details</p>
            </div>
            <button
              type="button"
              class="inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-transparent text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close connection details"
              data-testid="stream-details-close"
              @click="modal?.close()"
            >
              <SvgClose />
            </button>
          </header>

          <div class="min-h-0 overflow-y-auto p-4">
            <div class="flex items-center justify-between rounded-xl bg-white/5 px-3 py-3 text-sm" data-testid="stream-connection">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full" :class="statusDotClass" />
                <span>Connection</span>
              </div>
              <span class="font-medium" :class="statusTextClass">{{ connectionLabel }}</span>
            </div>

            <dl class="mt-3 space-y-1 text-sm" data-testid="stream-media-status">
              <div class="flex items-center justify-between rounded-lg px-3 py-2">
                <dt class="text-slate-400">Microphone</dt>
                <dd :class="userStatus.audio ? 'text-slate-200' : 'text-slate-500'">{{ userStatus.audio ? 'On' : 'Off' }}</dd>
              </div>
              <div class="flex items-center justify-between rounded-lg px-3 py-2">
                <dt class="text-slate-400">Camera</dt>
                <dd :class="userStatus.video ? 'text-slate-200' : 'text-slate-500'">{{ userStatus.video ? 'On' : 'Off' }}</dd>
              </div>
              <div class="flex items-center justify-between rounded-lg px-3 py-2">
                <dt class="text-slate-400">Screen sharing</dt>
                <dd :class="userStatus.screen ? 'text-slate-200' : 'text-slate-500'">{{ userStatus.screen ? 'On' : 'Off' }}</dd>
              </div>
            </dl>

            <details class="mt-4 rounded-xl border border-white/10 bg-black/20" data-testid="stream-technical-details">
              <summary class="cursor-pointer list-none rounded-xl px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" data-testid="stream-technical-toggle">Technical details</summary>
              <div class="border-t border-white/10 p-3">
                <p class="text-xs text-slate-500">Stream ID</p>
                <code class="mt-1 block break-all text-xs text-slate-400" data-testid="stream-id">{{ streamId }}</code>
                <button
                  type="button"
                  class="mt-3 w-full rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                  data-testid="stream-id-copy"
                  @click="copyStreamId"
                >
                  {{ copied ? 'Copied' : 'Copy ID' }}
                </button>
              </div>
            </details>
          </div>

          <footer class="shrink-0 border-t border-white/10 p-4">
            <button
              type="button"
              class="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/15"
              data-testid="stream-reconnect"
              @click="restart"
            >
              Reconnect
            </button>
          </footer>
        </section>
      </div>
    </dialog>
  </Teleport>
</template>
