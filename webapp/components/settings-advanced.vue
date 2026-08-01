<script setup lang="ts">
import { computed, ref } from 'vue'
import SettingItem from './setting-item.vue'
import { meetingId, roomInfo, roomParticipants } from '../store/atoms'
import { delStorage, getStorageStream } from '../lib/storage'
import { endMeeting, patchRoom } from '../lib/api'
import { setting } from '../store/setting'

const isReset = ref(false)

const isOwner = computed(() => !!meetingId.value && roomInfo.value.owner === getStorageStream())

const activeParticipants = computed(() => roomParticipants.value.filter(p => !p.leaveAt))

const onToggleLocked = async () => {
  await patchRoom(meetingId.value, { locked: !roomInfo.value.locked })
}

const onChangePresenter = async (userId: string) => {
  await patchRoom(meetingId.value, { presenter: userId })
}

const onEndMeeting = async () => {
  await endMeeting(meetingId.value)
}
</script>

<template>
  <div class="flex flex-col">
    <SettingItem label="Local Storage" :tooltips="[
      '1. Local storage only can be reset on the homepage;',
      '2. Single use only;',
      '3. Not used to restore settings.'
    ]">
      <button
        class="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-medium transition-colors hover:bg-rose-500 disabled:bg-slate-600 disabled:pointer-events-none"
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
        :class="setting.screenShareButtonShowed ? 'bg-indigo-500' : 'bg-slate-600'"
        @click="setting.screenShareButtonShowed = !setting.screenShareButtonShowed"
      >
        <span
          class="h-4 w-5 transform rounded-full bg-white transition-transform duration-300"
          :class="setting.screenShareButtonShowed ? 'translate-x-5' : 'translate-x-1'"
        />
      </button>
    </SettingItem>

    <template v-if="isOwner">
      <div class="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Room Owner
      </div>
      <SettingItem label="Lock Meeting" :tooltips="[
        '1. When locked, nobody except the owner can join;'
      ]">
        <button
          class="relative flex h-6 w-11 items-center rounded-full transition-colors duration-300"
          :class="roomInfo.locked ? 'bg-indigo-500' : 'bg-slate-600'"
          @click="onToggleLocked"
        >
          <span
            class="h-4 w-5 transform rounded-full bg-white transition-transform duration-300"
            :class="roomInfo.locked ? 'translate-x-5' : 'translate-x-1'"
          />
        </button>
      </SettingItem>
      <SettingItem label="Presenter" :tooltips="[
        '1. Only the presenter can share screen;',
        '2. Select Anyone to allow everyone.'
      ]">
        <select
          class="input-dark px-3 py-1.5 text-sm"
          :value="roomInfo.presenter"
          @change="onChangePresenter(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Anyone</option>
          <option v-for="p in activeParticipants" :key="p.userId" :value="p.userId">{{ p.name }}</option>
        </select>
      </SettingItem>
      <SettingItem label="End Meeting" :tooltips="[
        '1. Ends the meeting for everyone and archives the record;'
      ]">
        <button
          class="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-medium transition-colors hover:bg-rose-500"
          @click="onEndMeeting"
        >
          End
        </button>
      </SettingItem>
    </template>
  </div>
</template>
