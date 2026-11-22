<script setup lang="ts">
import { ref } from 'vue'
import { type VirtualBackgroundId, virtualBackgrounds } from '../lib/background'
import { log } from '../lib/log'
import { setting } from '../store/setting'
import SettingItem from './setting-item.vue'
import useWhipClient from './use/whip'

const props = defineProps<{ streamId?: string }>()
const whip = props.streamId ? useWhipClient(props.streamId) : undefined
const backgroundLoading = ref<VirtualBackgroundId | ''>('')
const backgroundError = ref('')

const videoResolutionOptions = [{ label: '480p (Default)', value: '480' }]
const screenShareResolutionOptions = [
  { label: '720p (Default)', value: '720' },
  { label: '1080p', value: '1080' },
  { label: 'Native', value: 'native' },
]

const onChangeVideoResolution = (resolution: string) => {
  setting.videoResolution = resolution

  // todo: add support of more video resolutions
}
const onChangeScreenShareResolution = (resolution: string) => {
  setting.screenShareResolution = resolution
}

const onSelectBackground = async (id: VirtualBackgroundId) => {
  backgroundLoading.value = id
  backgroundError.value = ''
  try {
    if (whip) await whip.value.setVirtualBackground(id)
    else setting.virtualBackground = id
  } catch (error) {
    backgroundError.value =
      'Unable to change the virtual background. Please try again.'
    log('error', 'virtual_background_change_failed', String(error), {
      backgroundId: id,
    })
  } finally {
    backgroundLoading.value = ''
  }
}
</script>

<template>
  <div class="flex flex-col">
    <SettingItem label="Video Resolution">
      <select
        class="input-control px-3 py-1.5 text-sm"
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
        class="input-control px-3 py-1.5 text-sm"
        :value="setting.screenShareResolution"
        @change="onChangeScreenShareResolution(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in screenShareResolutionOptions" :key="option.label" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingItem>
    <section class="mt-2 border-t border-line px-3 pt-4" aria-labelledby="virtual-background-title">
      <h3 id="virtual-background-title" class="text-sm font-medium text-foreground">Virtual background</h3>
      <p class="mt-1 text-xs leading-5 text-muted">Choose a background, then use the background button in the meeting controls to turn it on or off.</p>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="Virtual background choices" data-testid="virtual-background-options">
        <button
          v-for="background in virtualBackgrounds"
          :key="background.id"
          type="button"
          class="group min-w-0 rounded-xl bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-indigo-400 disabled:cursor-wait disabled:opacity-60"
          :aria-label="`Use ${background.name} virtual background`"
          :aria-pressed="setting.virtualBackground === background.id"
          :data-testid="`virtual-background-${background.id}`"
          :data-selected="setting.virtualBackground === background.id"
          :disabled="backgroundLoading !== ''"
          @click="onSelectBackground(background.id)"
        >
          <span
            class="relative block aspect-video overflow-hidden rounded-lg border-2 bg-control transition-colors"
            :class="setting.virtualBackground === background.id ? 'border-indigo-500 ring-2 ring-indigo-400/30' : 'border-line group-hover:border-indigo-400'"
          >
            <img class="h-full w-full object-cover" :src="background.url" :alt="`${background.name} preview`" width="320" height="180" draggable="false" />
            <span v-if="setting.virtualBackground === background.id" class="absolute right-1.5 bottom-1.5 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">Selected</span>
          </span>
          <span class="mt-1.5 block truncate text-xs text-foreground" :title="background.name">{{ background.name }}</span>
        </button>
      </div>
      <p v-if="backgroundError" class="mt-3 text-xs text-danger" role="alert" data-testid="virtual-background-error">{{ backgroundError }}</p>
    </section>
  </div>
</template>
