<script setup lang="ts">
import SettingItem from './setting-item.vue'
import { setting } from '../store/setting'

const videoResolutionOptions = [
  { label: '480p (Default)', value: '480' },
]
const screenShareResolutionOptions = [
  { label: '720p (Default)', value: '720' },
  { label: '1080p', value: '1080' },
  { label: 'Native', value: 'native' }
]

const onChangeVideoResolution = (resolution: string) => {
  setting.videoResolution = resolution

  // todo: add support of more video resolutions
}
const onChangeScreenShareResolution = (resolution: string) => {
  setting.screenShareResolution = resolution
}
</script>

<template>
  <div class="flex flex-col">
    <SettingItem label="Video Resolution">
      <select
        class="input-dark px-3 py-1.5 text-sm"
        :value="setting.videoResolution"
        @change="onChangeVideoResolution(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in videoResolutionOptions" :key="option.label" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingItem>
    <SettingItem label="Screen Share Resolution" :tooltips="[
      '1. Meaningless for mobile devices;',
      '2. If screen is sharing, any changes on this property will stop sharing.'
    ]">
      <select
        class="input-dark px-3 py-1.5 text-sm"
        :value="setting.screenShareResolution"
        @change="onChangeScreenShareResolution(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in screenShareResolutionOptions" :key="option.label" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingItem>
  </div>
</template>
