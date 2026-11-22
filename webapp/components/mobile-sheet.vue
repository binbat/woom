<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

withDefaults(
  defineProps<{
    testId: string
    label: string
    size?: 'auto' | 'members' | 'chat'
  }>(),
  { size: 'auto' }
)

const emit = defineEmits<{
  close: []
}>()

const dialog = ref<HTMLDialogElement>()

onMounted(() => {
  dialog.value?.showModal()
})

onUnmounted(() => {
  dialog.value?.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="fixed inset-x-0 bottom-0 top-auto m-0 flex w-full max-w-none flex-col overflow-hidden rounded-t-3xl border border-line border-b-0 bg-surface p-0 pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl"
      :class="size === 'chat' ? 'h-[85dvh]' : size === 'members' ? 'h-[60dvh]' : 'max-h-[75dvh]'"
      :style="{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 16px)' }"
      :aria-label="label"
      :data-testid="testId"
      @cancel.prevent="emit('close')"
      @click.self="emit('close')"
    >
      <slot />
    </dialog>
  </Teleport>
</template>

<style scoped>
dialog::backdrop {
  background: rgb(0 0 0 / 65%);
  backdrop-filter: blur(2px);
}
</style>
