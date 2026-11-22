<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SettingAdvanced from './settings-advanced.vue'
import SettingGeneral from './settings-general.vue'
import SettingMedia from './settings-media.vue'
import SvgAdvanced from './svg/advanced.vue'
import SvgClose from './svg/close.vue'
import SvgGeneral from './svg/general.vue'
import SvgMedia from './svg/media.vue'

defineProps<{ streamId?: string }>()

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref('General')
const modal = ref<HTMLDialogElement>()
const settingsOptions = [
  { label: 'General', icon: SvgGeneral },
  { label: 'Media', icon: SvgMedia },
  { label: 'Advanced', icon: SvgAdvanced },
]

onMounted(() => {
  modal.value?.showModal()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      class="fixed inset-0 m-0 h-dvh w-full max-w-none max-h-none overflow-hidden border-0 p-0 bg-black/70 backdrop-blur-sm"
      aria-labelledby="settings-title"
      data-testid="settings-overlay"
      @close="emit('close')"
    >
      <div class="flex h-full w-full lg:items-center lg:justify-center">
        <div class="flex flex-col w-full h-full pb-[env(safe-area-inset-bottom)] lg:w-[42rem] lg:h-[30rem] bg-surface lg:border lg:border-line lg:rounded-2xl lg:shadow-2xl text-foreground overflow-hidden" data-testid="settings-dialog">
          <div class="relative flex items-center justify-center border-b border-line py-3" :style="{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }">
            <h1 id="settings-title" class="text-lg font-semibold tracking-wide">Settings</h1>
            <button class="absolute bottom-2 right-3 inline-grid place-items-center w-11 h-11 rounded-lg bg-transparent text-muted hover:bg-control-hover hover:text-heading transition-colors md:bottom-auto md:w-8 md:h-8" aria-label="Close settings" data-testid="settings-close" @click="emit('close')">
              <SvgClose />
            </button>
          </div>
          <div class="flex flex-1 min-h-0">
            <nav class="w-16 md:w-44 border-r border-line p-2 space-y-1 overflow-y-auto">
              <div
                v-for="{ label, icon: Icon } in settingsOptions"
                :key="label"
                :data-testid="`settings-tab-${label.toLowerCase()}`"
                class="flex items-center justify-center md:justify-start gap-2 px-2 py-2 rounded-xl text-sm cursor-pointer transition-colors"
                :class="activeTab === label ? 'bg-indigo-600 text-white' : 'text-muted hover:bg-control-hover hover:text-heading'"
                @click="activeTab = label"
              >
                <component :is="Icon" />
                <p class="hidden md:block">
                  {{ label }}
                </p>
              </div>
            </nav>
            <main class="flex-1 min-w-0 p-4 overflow-auto" data-testid="settings-content">
              <h2 class="text-base font-semibold text-heading mb-4">{{ activeTab }}</h2>
              <SettingGeneral v-if="activeTab === 'General'" />
              <SettingMedia v-if="activeTab === 'Media'" :stream-id="streamId" />
              <SettingAdvanced v-if="activeTab === 'Advanced'" />
            </main>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
