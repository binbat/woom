<script setup lang="ts">
import { setting, type Theme } from '../store/setting'
import SettingItem from './setting-item.vue'

const languageOptions = ['English']
const themeOptions: { label: string; value: Theme }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const onChangeLanguage = (language: string) => {
  setting.language = language

  // todo: add support of more languages
}
</script>

<template>
  <div class="flex flex-col">
    <SettingItem label="Theme">
      <select
        v-model="setting.theme"
        class="input-control px-3 py-1.5 text-sm"
        data-testid="theme-select"
      >
        <option v-for="option in themeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingItem>
    <SettingItem label="Language">
      <select
        class="input-control px-3 py-1.5 text-sm"
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
