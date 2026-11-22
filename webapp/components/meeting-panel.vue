<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import MobileSheet from './mobile-sheet.vue'

const props = defineProps<{
  kind: 'chat' | 'members'
}>()

const emit = defineEmits<{
  close: []
}>()

const media = window.matchMedia('(max-width: 767px)')
const compact = ref(media.matches)
const update = () => {
  compact.value = media.matches
}

onMounted(() => {
  media.addEventListener('change', update)
})

onUnmounted(() => {
  media.removeEventListener('change', update)
})
</script>

<template>
  <div v-if="!compact" class="w-80 shrink-0 py-4 pr-4" :data-testid="`${props.kind}-panel`">
    <slot />
  </div>
  <MobileSheet
    v-else
    :test-id="`${props.kind}-panel`"
    :label="props.kind === 'chat' ? 'Chat' : 'Members'"
    :size="props.kind"
    @close="emit('close')"
  >
    <slot />
  </MobileSheet>
</template>
