<script setup lang="ts">
import Admin from './pages/admin.vue'
import Meeting from './pages/meeting.vue'
import Welcome from './pages/welcome.vue'
import { adminMode, meetingId } from './store/atoms'

adminMode.value = window.location.pathname.replace(/\/+$/, '') === '/admin'
</script>

<template>
  <div class="min-h-screen">
    <Admin v-if="adminMode" />
    <Meeting v-else-if="meetingId" :meeting-id="meetingId" />
    <Welcome v-else />
  </div>
</template>
