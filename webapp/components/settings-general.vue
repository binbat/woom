<script setup lang="ts">
import SettingItem from './setting-item.vue'
import { setting } from '../store/setting'

const languageOptions = ['English']

const onChangeLanguage = (language: string) => {
  setting.language = language

  // todo: add support of more languages
}
</script>

<template>
  <div class="flex flex-col space-y-2">
    <SettingItem label="Language">
      <select
        class="bg-gray-200 rounded max-w-[50%] ml-2 p-1"
        :value="setting.language"
        @change="onChangeLanguage(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in languageOptions" :key="option" :value="option">
          {{ option }}
        </option>
      </select>
    </SettingItem>
  </div>
</template>
