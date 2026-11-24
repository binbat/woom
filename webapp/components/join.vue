<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { newRoom, newUser, setApiToken } from '../lib/api'
import {
  delStorage,
  getStorage,
  setStorage,
  setStorageMeeting,
  setStorageStream,
} from '../lib/storage'
import { adminMode, meetingId } from '../store/atoms'
import Records from './records.vue'
import Settings from './settings.vue'
import SvgSetting from './svg/setting.vue'

const tmpId = ref<string>('')
// room id from the URL path only: the records section must never appear on
// the bare welcome page, not even for an id typed into the input
const pathId = ref<string>('')
const isSetting = ref(false)

const getLoginStatus = async () => {
  const user = getStorage()
  if (!user.token || !user.stream) {
    const res = await newUser()
    user.token = res.token
    user.stream = res.streamId
    setStorage(user)
  }

  setApiToken(user.token)
  if (user.stream) setStorageStream(user.stream)
}

const enterMeeting = (id: string) => {
  setStorageMeeting(id)
  meetingId.value = id
  history.pushState(null, '', `/${id}`)
}

const newMeeting = async () => {
  await getLoginStatus()
  const id = (await newRoom()).roomId
  enterMeeting(id)
}

const joinMeeting = async () => {
  await getLoginStatus()
  enterMeeting(tmpId.value)
}

onMounted(() => {
  // /admin is the console path, never a room id
  if (adminMode.value) return
  const id = window.location.pathname.replace('/', '')
  if (id) {
    tmpId.value = id
    pathId.value = id
  }
})
</script>

<template>
  <div class="panel w-full max-w-2xl p-6 sm:p-8 flex flex-col gap-5">
    <div class="flex flex-wrap items-stretch justify-center gap-3">
      <button class="btn-primary" data-testid="new-meeting" :disabled="!!tmpId" @click="newMeeting()">New Meeting</button>
      <input
        v-model="tmpId"
        class="input-control flex-1 min-w-40 text-center text-xl font-mono tracking-widest"
        placeholder="Enter Meeting id"
        data-testid="meeting-id-input"
        maxlength="11"
      />
      <button class="btn-primary" data-testid="join-meeting" :disabled="!tmpId" @click="joinMeeting()">Join</button>
      <button class="icon-btn" aria-label="Settings" data-testid="settings-toggle" @click="isSetting = true"><SvgSetting /></button>
    </div>
    <p class="text-center text-sm text-muted">
      If have some problems, Please click this:
      <a class="ml-1 text-danger underline underline-offset-2 cursor-pointer" @click="delStorage">Reset</a>
    </p>
    <Settings v-if="isSetting" @close="isSetting = false" />
  </div>
  <Records v-if="pathId" :room-id="pathId" />
</template>
