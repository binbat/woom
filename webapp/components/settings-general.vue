<script setup lang="ts">
import { setting } from '../store/setting'
import SettingItem from './setting-item.vue'

const languageOptions = ['English']

const onChangeLanguage = (language: string) => {
  setting.language = language

  // todo: add support of more languages
}
</script>

<template>
  <div class="flex flex-col">
    <SettingItem label="Language">
      <select
        class="input-dark px-3 py-1.5 text-sm"
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
