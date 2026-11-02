<script setup lang="ts">
import Meeting from './pages/meeting.vue'
import Welcome from './pages/welcome.vue'
import { meetingId } from './store/atoms'
</script>

<template>
  <div class="min-h-screen">
    <Meeting v-if="meetingId" :meeting-id="meetingId" />
    <Welcome v-else />
  </div>
</template>
