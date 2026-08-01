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
  <div class="fixed inset-0 z-50 lg:flex lg:justify-center lg:items-center bg-black bg-opacity-80">
    <div class="flex flex-col bg-white w-screen h-screen lg:w-[65%] lg:h-[60%] 2xl:w-[50%] 2xl:h-[60%] lg:rounded-xl">
      <div class="relative flex flex-row justify-center items-center border-b-1 border-gray-200 py-1">
        <h1 class="text-2xl font-semibold text-gray-400">Settings</h1>
        <button class="absolute right-0 bg-transparent px-1 text-gray-400" @click="emit('close')">
          <SvgClose />
        </button>
      </div>
      <div class="flex flex-row flex-grow-1">
        <nav class="w-[20%] border-r p-1 space-y-1 overflow-y-auto">
          <div
            v-for="{ label, icon: Icon } in settingsOptions"
            :key="label"
            class="flex flex-row justify-center md:justify-start text-base cursor-pointer px-2 py-2 rounded space-x-2"
            :class="activeTab === label ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'"
            @click="activeTab = label"
          >
            <component :is="Icon" />
            <p class="hidden md-block">
              {{ label }}
            </p>
          </div>
        </nav>
        <main class="w-[80%] p-1 overflow-auto">
          <h2 class="text-xl text-center font-bold my-4">{{ activeTab }}</h2>
          <SettingGeneral v-if="activeTab === 'General'" />
          <SettingMedia v-if="activeTab === 'Media'" />
          <SettingAdvanced v-if="activeTab === 'Advanced'" />
        </main>
      </div>
    </div>
  </div>
</template>
