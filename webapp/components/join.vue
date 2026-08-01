<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { meetingId } from '../store/atoms'
import { getStorage, setStorage, delStorage, setStorageStream, setStorageMeeting } from '../lib/storage'
import { newRoom, newUser, setApiToken, setRoomId } from '../lib/api'
import SvgSetting from './svg/setting.vue'
import Settings from './settings.vue'

const tmpId = ref<string>('')
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
  setRoomId(id)
}

const joinMeeting = async () => {
  await getLoginStatus()
  enterMeeting(tmpId.value)
  setRoomId(tmpId.value)
}

onMounted(() => {
  const id = window.location.pathname.replace('/', '')
  if (id) {
    tmpId.value = id
  }
})
</script>

<template>
  <div class="flex flex-col justify-around bg-gray-800/80 p-6 my-4">
    <center class="flex flex-row flex-wrap justify-center">
      <button class="btn-primary my-2" data-testid="new-meeting" :disabled="!!tmpId" @click="newMeeting()">New Meeting</button>
      <input
        v-model="tmpId"
        class="text-center text-4xl mx-2 my-2 max-w-full"
        placeholder="Enter Meeting id"
        data-testid="meeting-id-input"
        maxlength="11"
      />
      <button class="btn-primary my-2" data-testid="join-meeting" :disabled="!tmpId" @click="joinMeeting()">Join</button>
      <button class="btn-primary my-2 ml-2" @click="isSetting = true"><SvgSetting /></button>
    </center>
    <center class="flex flex-row flex-wrap justify-center text-white">
      <p>If have some problems, Please click this:</p>
      <a class="mx-2 text-red-300 underline" @click="delStorage">Reset</a>
    </center>
    <Settings v-if="isSetting" @close="isSetting = false" />
  </div>
</template>
