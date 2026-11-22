<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Message, sendMessage } from '../lib/api'
import { getStorageStream } from '../lib/storage'
import SvgClose from './svg/close.vue'

const props = defineProps<{
  meetingId: string
  messages: Message[]
}>()

const emit = defineEmits<{
  close: []
}>()

const draft = ref('')
const sendError = ref('')
const listRef = ref<HTMLDivElement>()

const localUserId = getStorageStream()

const send = async () => {
  const content = draft.value.trim()
  if (!content) return
  sendError.value = ''
  try {
    await sendMessage(props.meetingId, content)
    draft.value = ''
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e)
  }
}

// keep the list pinned to the latest message
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight })
  },
  { immediate: true }
)

const formatTime = (secs: number) =>
  new Date(secs * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
</script>

<template>
  <div class="flex flex-col w-full h-full bg-surface border border-line rounded-2xl overflow-hidden" data-testid="chat-dialog">
    <div class="flex items-center justify-between px-4 py-3 border-b border-line">
      <h3 class="text-sm font-semibold text-foreground">Chat</h3>
      <button
        class="inline-grid place-items-center w-8 h-8 rounded-lg bg-transparent text-muted transition-colors hover:bg-control-hover hover:text-heading"
        aria-label="Close chat"
        data-testid="chat-close"
        @click="emit('close')"
      >
        <SvgClose />
      </button>
    </div>

    <div ref="listRef" class="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2" data-testid="chat-list">
      <p v-if="!messages.length" class="text-center text-xs text-subtle mt-4">No messages yet</p>
      <div
        v-for="m in messages"
        :key="m.id"
        class="flex flex-col max-w-[85%]"
        :class="m.userId === localUserId ? 'self-end items-end ml-auto' : 'self-start items-start'"
      >
        <p class="text-[10px] text-subtle px-1">
          {{ m.userId === localUserId ? 'Me' : m.name }} · {{ formatTime(m.ts) }}
        </p>
        <p
          class="mt-0.5 px-3 py-1.5 rounded-2xl text-sm break-words whitespace-pre-wrap"
          :class="m.userId === localUserId ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-control text-foreground rounded-bl-sm'"
          data-testid="chat-message"
        >{{ m.content }}</p>
      </div>
    </div>

    <div class="border-t border-line p-2">
      <p v-if="sendError" class="text-xs text-danger px-1 pb-1">{{ sendError }}</p>
      <div class="flex items-center gap-2">
        <input
          v-model="draft"
          class="input-control min-w-0 flex-1 px-3 py-1.5 text-sm"
          placeholder="Send a message"
          data-testid="chat-input"
          maxlength="500"
          @keydown.enter="send"
        />
        <button class="btn-primary shrink-0 px-3 py-1.5 text-sm" data-testid="chat-send" @click="send">Send</button>
      </div>
    </div>
  </div>
</template>
