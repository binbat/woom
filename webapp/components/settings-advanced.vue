<script setup lang="ts">
import { ref } from 'vue'
import SettingItem from './setting-item.vue'
import { meetingId } from '../store/atoms'
import { delStorage } from '../lib/storage'
import { setting } from '../store/setting'

const isReset = ref(false)
</script>

<template>
  <div class="flex flex-col space-y-2">
    <SettingItem label="Local Storage" :tooltips="[
      '1. Local storage only can be reset on the homepage;',
      '2. Single use only;',
      '3. Not used to restore settings.'
    ]">
      <button
        class="bg-blue-400 disabled:bg-gray-400 rounded text-white max-w-[50%] ml-2 py-1 px-2"
        :disabled="isReset || !!meetingId"
        @click="delStorage(); isReset = true"
      >
        Reset
      </button>
    </SettingItem>
    <SettingItem label="Hide Share Screen Button" :tooltips="[
      '1. Defaults to checked on mobile devices;',
      '2. This button is diabled on mobile devices even though it is showed.'
    ]">
      <button
        class="relative flex h-6 w-11 items-center rounded-full transition-colors duration-300"
        :class="setting.screenShareButtonShowed ? 'bg-blue-400' : 'bg-gray-300'"
        @click="setting.screenShareButtonShowed = !setting.screenShareButtonShowed"
      >
        <span
          class="h-4 w-5 transform rounded-full bg-white transition-transform duration-300"
          :class="setting.screenShareButtonShowed ? 'translate-x-5' : 'translate-x-1'"
        />
      </button>
    </SettingItem>
  </div>
</template>
