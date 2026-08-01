<script setup lang="ts">
import { ref } from 'vue'
import SvgClose from './svg/close.vue'
import SvgGeneral from './svg/general.vue'
import SvgMedia from './svg/media.vue'
import SvgAdvanced from './svg/advanced.vue'
import SettingGeneral from './settings-general.vue'
import SettingMedia from './settings-media.vue'
import SettingAdvanced from './settings-advanced.vue'

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref('General')
const settingsOptions = [
  { label: 'General', icon: SvgGeneral },
  { label: 'Media', icon: SvgMedia },
  { label: 'Advanced', icon: SvgAdvanced }
]
</script>

<template>
  <div class="fixed inset-0 z-50 flex lg:items-center lg:justify-center bg-black/70 backdrop-blur-sm">
    <div class="flex flex-col w-screen h-screen lg:w-[42rem] lg:h-[30rem] bg-slate-900 lg:border lg:border-white/10 lg:rounded-2xl lg:shadow-2xl text-slate-200 overflow-hidden">
      <div class="relative flex items-center justify-center border-b border-white/10 py-3">
        <h1 class="text-lg font-semibold tracking-wide">Settings</h1>
        <button class="absolute right-3 inline-grid place-items-center w-8 h-8 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors" aria-label="Close settings" @click="emit('close')">
          <SvgClose />
        </button>
      </div>
      <div class="flex flex-1 min-h-0">
        <nav class="w-16 md:w-44 border-r border-white/10 p-2 space-y-1 overflow-y-auto">
          <div
            v-for="{ label, icon: Icon } in settingsOptions"
            :key="label"
            class="flex items-center justify-center md:justify-start gap-2 px-2 py-2 rounded-xl text-sm cursor-pointer transition-colors"
            :class="activeTab === label ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'"
            @click="activeTab = label"
          >
            <component :is="Icon" />
            <p class="hidden md:block">
              {{ label }}
            </p>
          </div>
        </nav>
        <main class="flex-1 p-4 overflow-auto">
          <h2 class="text-base font-semibold text-slate-100 mb-4">{{ activeTab }}</h2>
          <SettingGeneral v-if="activeTab === 'General'" />
          <SettingMedia v-if="activeTab === 'Media'" />
          <SettingAdvanced v-if="activeTab === 'Advanced'" />
        </main>
      </div>
    </div>
  </div>
</template>
